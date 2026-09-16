import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createOutputFileName,
  createOrientationNeutralPng,
  decodeBlob,
  drawOrientedImage,
  getOrientedDimensions,
  isJpegBytes,
  parsePng,
  readExifOrientation,
} from "../app.js";

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function fixture(name) {
  return new Uint8Array(await readFile(path.join(fixturesDirectory, name)));
}

test("accepts valid static PNGs and reports decoded source metadata", async () => {
  const opaque = parsePng(await fixture("opaque.png"));
  const transparent = parsePng(await fixture("transparent.png"));

  assert.deepEqual(
    {
      width: opaque.width,
      height: opaque.height,
      isAnimated: opaque.isAnimated,
      hasAlphaChannel: opaque.hasAlphaChannel,
    },
    {
      width: 4,
      height: 4,
      isAnimated: false,
      hasAlphaChannel: true,
    },
  );
  assert.equal(transparent.isAnimated, false);
  assert.equal(transparent.hasAlphaChannel, true);
});

test("rejects corrupt, falsely labelled and animated PNG inputs", async () => {
  await assert.rejects(
    async () => parsePng(await fixture("corrupt.png")),
    /invalid CRC/i,
  );
  await assert.rejects(
    async () => parsePng(await fixture("renamed-jpeg.png")),
    /PNG signature/i,
  );
  await assert.rejects(
    async () => parsePng(await fixture("animated.png")),
    /animated/i,
  );
});

test("reads PNG EXIF orientation and computes normalized dimensions", async () => {
  const parsed = parsePng(await fixture("metadata-orientation.png"));
  const exif = parsed.chunks.find((chunk) => chunk.type === "eXIf");

  assert.ok(exif);
  assert.equal(readExifOrientation(exif.data), 6);
  assert.deepEqual(getOrientedDimensions(4, 4, 6), { width: 4, height: 4 });
  assert.deepEqual(getOrientedDimensions(3, 5, 6), { width: 5, height: 3 });
});

test("removes EXIF from the decoder copy without changing the source fixture", async () => {
  const original = await fixture("metadata-orientation.png");
  const parsed = parsePng(original);
  const neutral = createOrientationNeutralPng(parsed);
  const reparsed = parsePng(neutral);

  assert.equal(parsed.orientation, 6);
  assert.equal(reparsed.orientation, 1);
  assert.equal(reparsed.chunks.some((chunk) => chunk.type === "eXIf"), false);
  assert.deepEqual(
    reparsed.chunks.map((chunk) => chunk.type),
    ["IHDR", "tEXt", "tEXt", "IDAT", "IEND"],
  );
  assert.deepEqual(
    reparsed.chunks.map((chunk) => [chunk.type, Array.from(chunk.data)]),
    parsed.chunks
      .filter((chunk) => chunk.type !== "eXIf")
      .map((chunk) => [chunk.type, Array.from(chunk.data)]),
  );
  assert.equal(parsePng(original).orientation, 6);
});

test("uses the source base name with a JPEG extension", () => {
  assert.equal(createOutputFileName("holiday.png"), "holiday.jpg");
  assert.equal(createOutputFileName("holiday.PNG"), "holiday.jpg");
  assert.equal(createOutputFileName("holiday"), "holiday.jpg");
});

test("distinguishes JPEG container bytes from PNG bytes", () => {
  assert.equal(isJpegBytes(new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9])), true);
  assert.equal(isJpegBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd9])), false);
});

test("uses the HTMLImageElement fallback when image bitmap options are unavailable", async () => {
  const previousWindow = globalThis.window;
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  const previousUrl = globalThis.URL;
  let decodedImage;

  class FakeImage {
    constructor() {
      decodedImage = this;
      this.width = 3;
      this.height = 5;
      this.listeners = new Map();
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    set src(value) {
      this.srcValue = value;
      queueMicrotask(() => this.listeners.get("load")?.());
    }

    async decode() {}
  }

  globalThis.window = {
    async createImageBitmap() {
      throw new Error("imageOrientation: none is unsupported");
    },
  };
  globalThis.Image = FakeImage;
  globalThis.URL = {
    createObjectURL() {
      return "blob:test";
    },
    revokeObjectURL() {},
  };
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            transform() {},
            drawImage() {},
          };
        },
      };
    },
  };

  try {
    const image = await decodeBlob(new Blob(["png"]));
    const canvas = drawOrientedImage(image, 6, false);

    assert.equal(image, decodedImage);
    assert.deepEqual(
      { width: canvas.width, height: canvas.height },
      { width: 5, height: 3 },
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    globalThis.URL = previousUrl;
  }
});
