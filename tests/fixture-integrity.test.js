import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const manifest = JSON.parse(await readFile(path.join(fixturesDirectory, "manifest.json"), "utf8"));
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes) {
  if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
    return { valid: false, reason: "missing PNG signature", chunks: [] };
  }

  const chunks = [];
  let offset = pngSignature.length;
  let sawIend = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      return { valid: false, reason: "truncated chunk header", chunks };
    }

    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (crcEnd > bytes.length) {
      return { valid: false, reason: "truncated chunk body", chunks };
    }

    const type = bytes.subarray(typeStart, dataStart);
    const data = bytes.subarray(dataStart, dataEnd);
    const storedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([type, data]));

    chunks.push({ type: type.toString("ascii"), data, storedCrc, actualCrc });

    if (storedCrc !== actualCrc) {
      return { valid: false, reason: `invalid CRC in ${type.toString("ascii")}`, chunks };
    }

    offset = crcEnd;

    if (type.toString("ascii") === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIend || offset !== bytes.length) {
    return { valid: false, reason: "missing IEND or trailing bytes", chunks };
  }

  return { valid: true, reason: null, chunks };
}

function chunk(parsed, type) {
  return parsed.chunks.find((item) => item.type === type);
}

function ihdr(parsed) {
  const header = chunk(parsed, "IHDR");
  assert.ok(header, "valid PNG must contain IHDR");
  return {
    width: header.data.readUInt32BE(0),
    height: header.data.readUInt32BE(4),
    bitDepth: header.data[8],
    colorType: header.data[9],
    interlace: header.data[12],
  };
}

function firstFrameRgba(parsed) {
  const header = ihdr(parsed);
  assert.equal(header.bitDepth, 8);
  assert.equal(header.colorType, 6);
  assert.equal(header.interlace, 0);

  const compressed = Buffer.concat(
    parsed.chunks.filter((item) => item.type === "IDAT").map((item) => item.data),
  );
  const raw = inflateSync(compressed);
  const rowLength = header.width * 4;
  assert.equal(raw.length, header.height * (rowLength + 1));

  const rgba = [];
  for (let y = 0; y < header.height; y += 1) {
    const rowStart = y * (rowLength + 1);
    assert.equal(raw[rowStart], 0, "fixture rows must use the no-filter encoding");
    rgba.push(...raw.subarray(rowStart + 1, rowStart + 1 + rowLength));
  }
  return { header, rgba };
}

function exifOrientation(data) {
  assert.equal(data.subarray(0, 2).toString("ascii"), "II");
  assert.equal(data.readUInt16LE(2), 42);
  const ifdOffset = data.readUInt32LE(4);
  const entryCount = data.readUInt16LE(ifdOffset);
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (data.readUInt16LE(entry) === 0x0112) {
      assert.equal(data.readUInt16LE(entry + 2), 3);
      assert.equal(data.readUInt32LE(entry + 4), 1);
      return data.readUInt16LE(entry + 8);
    }
  }
  return null;
}

assert.equal(manifest.fixturePolicy.includes("integrity"), true);
assert.equal(manifest.fixtures.length, 6);

for (const entry of manifest.fixtures) {
  test(`shared fixture: ${entry.name}`, async () => {
    assert.ok(entry.purpose);
    assert.ok(entry.expectedValidity);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);

    const bytes = await readFile(path.join(fixturesDirectory, entry.name));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash, entry.sha256);

    if (entry.expectedValidity === "invalid-as-png-non-png-container") {
      assert.equal(bytes.subarray(0, pngSignature.length).equals(pngSignature), false);
      assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
      return;
    }

    const parsed = inspectPng(bytes);

    if (entry.expectedValidity === "invalid-corrupt-png") {
      assert.equal(parsed.valid, false);
      assert.match(parsed.reason, /CRC|truncated/);
      return;
    }

    assert.equal(parsed.valid, true);
    const header = ihdr(parsed);
    assert.deepEqual(
      { width: header.width, height: header.height },
      entry.dimensions,
    );

    if (entry.expectedValidity === "valid-animated-png") {
      const animation = chunk(parsed, "acTL");
      assert.ok(animation, "APNG fixture must contain acTL");
      assert.equal(animation.data.readUInt32BE(0), entry.frameCount);
      assert.equal(parsed.chunks.filter((item) => item.type === "fcTL").length, entry.frameCount);
      return;
    }

    assert.equal(chunk(parsed, "acTL"), undefined);
    const frame = firstFrameRgba(parsed);
    const hasTransparency = frame.rgba.some((value, index) => index % 4 === 3 && value < 255);
    assert.equal(hasTransparency, entry.hasTransparency);

    if (entry.expectedValidity === "valid-static-png-with-metadata-and-orientation") {
      const comments = parsed.chunks
        .filter((item) => item.type === "tEXt")
        .map((item) => item.data.toString("latin1"));
      assert.ok(comments.some((value) => value === ["Comment", "Known metadata fixture"].join(String.fromCharCode(0))));
      assert.ok(comments.some((value) => value === ["Software", "Offline converter setup"].join(String.fromCharCode(0))));

      const exif = chunk(parsed, "eXIf");
      assert.ok(exif, "metadata fixture must contain eXIf");
      assert.equal(exifOrientation(exif.data), entry.metadata.exifOrientation);
    }
  });
}
