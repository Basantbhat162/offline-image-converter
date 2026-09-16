const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_DECODED_PIXELS = 40_000_000;
const DEFAULT_JPEG_QUALITY = 0.92;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

export class PngValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PngValidationError";
  }
}

function fail(message) {
  throw new PngValidationError(message);
}

function asBytes(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function readUint32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) {
    fail("This file is not a complete PNG.");
  }
  return (
    ((bytes[offset] << 24) >>> 0)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readUint16(dataView, offset, littleEndian) {
  if (offset < 0 || offset + 2 > dataView.byteLength) {
    return null;
  }
  return dataView.getUint16(offset, littleEndian);
}

function readUint32View(dataView, offset, littleEndian) {
  if (offset < 0 || offset + 4 > dataView.byteLength) {
    return null;
  }
  return dataView.getUint32(offset, littleEndian);
}

function chunkType(bytes) {
  return String.fromCharCode(...bytes);
}

function chunkCrc(typeBytes, data) {
  let value = 0xffffffff;
  for (const byte of typeBytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  for (const byte of data) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function encodeChunkType(type) {
  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    bytes[index] = type.charCodeAt(index);
  }
  return bytes;
}

export function readExifOrientation(input) {
  const bytes = asBytes(input);
  if (bytes.length < 8) {
    return 1;
  }

  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!littleEndian && !bigEndian) {
    return 1;
  }

  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readUint16(dataView, 2, littleEndian) !== 42) {
    return 1;
  }

  const ifdOffset = readUint32View(dataView, 4, littleEndian);
  if (ifdOffset === null) {
    return 1;
  }

  const entryCount = readUint16(dataView, ifdOffset, littleEndian);
  if (entryCount === null) {
    return 1;
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = readUint16(dataView, entryOffset, littleEndian);
    const type = readUint16(dataView, entryOffset + 2, littleEndian);
    const count = readUint32View(dataView, entryOffset + 4, littleEndian);

    if (tag === null || type === null || count === null) {
      return 1;
    }

    if (tag !== 0x0112 || type !== 3 || count < 1) {
      continue;
    }

    const valueBytes = count * 2;
    const valueOffset = valueBytes <= 4
      ? entryOffset + 8
      : readUint32View(dataView, entryOffset + 8, littleEndian);

    if (valueOffset === null) {
      return 1;
    }

    const orientation = readUint16(dataView, valueOffset, littleEndian);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }

  return 1;
}

export function getOrientedDimensions(width, height, orientation) {
  return [5, 6, 7, 8].includes(orientation)
    ? { width: height, height: width }
    : { width, height };
}

export function parsePng(input) {
  const bytes = asBytes(input);
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    fail("This file is not a PNG: the PNG signature is missing.");
  }

  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  let sawIend = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      fail("This PNG is truncated before the next chunk.");
    }

    const length = readUint32(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (!Number.isSafeInteger(dataEnd) || crcEnd > bytes.length) {
      fail("This PNG is truncated inside a chunk.");
    }

    const typeBytes = bytes.subarray(typeStart, dataStart);
    const type = chunkType(typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      fail("This PNG contains an invalid chunk type.");
    }

    const data = bytes.subarray(dataStart, dataEnd);
    const storedCrc = readUint32(bytes, dataEnd);
    const actualCrc = chunkCrc(typeBytes, data);

    chunks.push({ type, data, storedCrc, actualCrc });

    if (storedCrc !== actualCrc) {
      fail(`This PNG is corrupt: the ${type} chunk has an invalid CRC.`);
    }

    offset = crcEnd;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIend || offset !== bytes.length) {
    fail("This PNG is missing its IEND chunk or has trailing data.");
  }

  if (chunks[0]?.type !== "IHDR") {
    fail("This PNG is missing its IHDR header.");
  }

  const header = chunks[0].data;
  if (header.length !== 13) {
    fail("This PNG has an invalid IHDR header.");
  }

  const width = readUint32(header, 0);
  const height = readUint32(header, 4);
  const bitDepth = header[8];
  const colorType = header[9];
  const compression = header[10];
  const filter = header[11];
  const interlace = header[12];

  if (width === 0 || height === 0) {
    fail("This PNG has invalid zero-sized dimensions.");
  }
  if (width * height > MAX_DECODED_PIXELS) {
    fail("This PNG is too large to decode safely in the browser.");
  }
  if (compression !== 0 || filter !== 0 || ![0, 2, 3, 4, 6].includes(colorType)) {
    fail("This PNG uses an unsupported image encoding.");
  }

  if (!chunks.some((chunk) => chunk.type === "IDAT")) {
    fail("This PNG contains no image data.");
  }

  const isAnimated = chunks.some((chunk) => chunk.type === "acTL" || chunk.type === "fcTL");
  if (isAnimated) {
    fail("Animated PNG files are not supported in this trial.");
  }

  const exifChunk = chunks.find((chunk) => chunk.type === "eXIf");
  const orientation = exifChunk ? readExifOrientation(exifChunk.data) : 1;
  const hasAlphaChannel = [4, 6].includes(colorType)
    || chunks.some((chunk) => chunk.type === "tRNS");

  return {
    bytes,
    chunks,
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    orientation,
    hasAlphaChannel,
    isAnimated: false,
  };
}

export function createOutputFileName(fileName) {
  const baseName = String(fileName || "").split(/[\\/]/).pop() || "converted";
  const extensionIndex = baseName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
  return `${stem || "converted"}.jpg`;
}

function getImageDimensions(image) {
  return {
    width: image.width || image.naturalWidth,
    height: image.height || image.naturalHeight,
  };
}

export function createOrientationNeutralPng(parsed) {
  // Browser decoders may apply eXIf before drawImage, so remove it from the
  // transient decode copy while keeping the parsed orientation for the canvas.
  const chunks = parsed.chunks.filter((chunk) => chunk.type !== "eXIf");
  if (chunks.length === parsed.chunks.length) {
    return parsed.bytes;
  }

  const byteLength = PNG_SIGNATURE.length
    + chunks.reduce((total, chunk) => total + 12 + chunk.data.length, 0);
  const bytes = new Uint8Array(byteLength);
  bytes.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;

  for (const chunk of chunks) {
    const typeBytes = encodeChunkType(chunk.type);
    writeUint32(bytes, offset, chunk.data.length);
    offset += 4;
    bytes.set(typeBytes, offset);
    offset += typeBytes.length;
    bytes.set(chunk.data, offset);
    offset += chunk.data.length;
    writeUint32(bytes, offset, chunkCrc(typeBytes, chunk.data));
    offset += 4;
  }

  return bytes;
}

export function drawOrientedImage(image, orientation, withWhiteBackground) {
  const source = getImageDimensions(image);
  const output = getOrientedDimensions(source.width, source.height, orientation);
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;

  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) {
    throw new Error("The browser could not create a drawing surface.");
  }

  if (withWhiteBackground) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, source.width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, source.width, source.height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, source.height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, source.height, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, source.height, source.width);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, source.width);
      break;
    default:
      break;
  }

  context.drawImage(image, 0, 0, source.width, source.height);
  return canvas;
}

function canvasHasTransparency(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("The browser could not inspect the decoded image.");
  }

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) {
      return true;
    }
  }
  return false;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

export async function decodeBlob(blob) {
  if (typeof window !== "undefined" && typeof window.createImageBitmap === "function") {
    try {
      return await window.createImageBitmap(blob, { imageOrientation: "none" });
    } catch {
      // Fall through to an HTMLImageElement for browsers without this option.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("The browser could not decode the image.")), { once: true });
      image.src = url;
    });
    if (typeof image.decode === "function") {
      await image.decode();
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeDecodedImage(image) {
  if (typeof image?.close === "function") {
    image.close();
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initializeApp() {
  const elements = {
    appShell: document.querySelector(".app-shell"),
    status: document.querySelector("#app-status"),
    error: document.querySelector("#app-error"),
    dropZone: document.querySelector("#drop-zone"),
    chooseFile: document.querySelector("#choose-file"),
    fileInput: document.querySelector("#file-input"),
    sourcePanel: document.querySelector("#source-panel"),
    sourceName: document.querySelector("#source-name"),
    sourceSize: document.querySelector("#source-size"),
    sourceDimensions: document.querySelector("#source-dimensions"),
    sourcePreview: document.querySelector("#source-preview"),
    transparencyWarning: document.querySelector("#transparency-warning"),
    quality: document.querySelector("#quality"),
    qualityValue: document.querySelector("#quality-value"),
    convertButton: document.querySelector("#convert-button"),
    resetButton: document.querySelector("#reset-button"),
    resultPanel: document.querySelector("#result-panel"),
    resultPreview: document.querySelector("#result-preview"),
    resultDetails: document.querySelector("#result-details"),
    downloadLink: document.querySelector("#download-link"),
  };

  if (Object.values(elements).some((element) => !element)) {
    return;
  }

  const state = {
    source: null,
    sourcePreviewUrl: null,
    resultUrl: null,
    busy: false,
    operation: 0,
  };

  function setStatus(message, kind = "neutral") {
    elements.status.textContent = message;
    elements.status.dataset.state = kind;
  }

  function clearError() {
    elements.error.hidden = true;
    elements.error.textContent = "";
  }

  function showError(error) {
    const message = error instanceof Error ? error.message : "The file could not be converted.";
    elements.error.textContent = message;
    elements.error.hidden = false;
    setStatus("The file could not be used.", "error");
  }

  function clearResult() {
    if (state.resultUrl) {
      URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = null;
    }
    elements.resultPreview.removeAttribute("src");
    elements.resultDetails.textContent = "";
    elements.downloadLink.hidden = true;
    elements.downloadLink.removeAttribute("href");
    elements.downloadLink.removeAttribute("download");
    elements.resultPanel.hidden = true;
  }

  function clearSource() {
    if (state.sourcePreviewUrl) {
      URL.revokeObjectURL(state.sourcePreviewUrl);
      state.sourcePreviewUrl = null;
    }
    state.source = null;
    elements.sourcePreview.removeAttribute("src");
    elements.sourceName.textContent = "";
    elements.sourceSize.textContent = "—";
    elements.sourceDimensions.textContent = "—";
    elements.transparencyWarning.hidden = true;
    elements.sourcePanel.hidden = true;
  }

  function updateQualityLabel() {
    elements.qualityValue.textContent = `${Math.round(Number(elements.quality.value) * 100)}%`;
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    elements.appShell.setAttribute("aria-busy", String(isBusy));
    elements.convertButton.disabled = isBusy;
    elements.resetButton.disabled = isBusy;
    elements.chooseFile.disabled = isBusy;
  }

  async function handleFile(file) {
    if (!file || state.busy) {
      return;
    }

    const operation = ++state.operation;
    clearResult();
    clearError();
    setBusy(true);
    setStatus(`Checking ${file.name || "the selected file"}…`, "working");

    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error("This file is larger than the 50 MB safety limit.");
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (operation !== state.operation) {
        return;
      }

      const parsed = parsePng(bytes);
      const orientationNeutralPng = createOrientationNeutralPng(parsed);
      const decoded = await decodeBlob(new Blob([orientationNeutralPng], { type: "image/png" }));
      try {
        if (operation !== state.operation) {
          return;
        }

        const decodedDimensions = getImageDimensions(decoded);
        if (!decodedDimensions.width || !decodedDimensions.height) {
          throw new Error("The browser could not read the PNG dimensions.");
        }
        if (decodedDimensions.width * decodedDimensions.height > MAX_DECODED_PIXELS) {
          throw new Error("This PNG has too many pixels to decode safely in the browser.");
        }

        const sourceCanvas = drawOrientedImage(decoded, parsed.orientation, false);
        const hasTransparency = canvasHasTransparency(sourceCanvas);
        const sourcePreviewBlob = await canvasToBlob(sourceCanvas, "image/png");
        if (!sourcePreviewBlob) {
          throw new Error("The browser could not prepare the source preview.");
        }

        if (operation !== state.operation) {
          return;
        }

        const sourcePreviewUrl = URL.createObjectURL(sourcePreviewBlob);
        if (state.sourcePreviewUrl) {
          URL.revokeObjectURL(state.sourcePreviewUrl);
        }
        state.sourcePreviewUrl = sourcePreviewUrl;
        state.source = {
          file,
          parsed,
          canvas: sourceCanvas,
          hasTransparency,
        };

        elements.sourceName.textContent = file.name || "selected.png";
        elements.sourceSize.textContent = formatBytes(file.size);
        const displayDimensions = getOrientedDimensions(
          decodedDimensions.width,
          decodedDimensions.height,
          parsed.orientation,
        );
        elements.sourceDimensions.textContent = `${displayDimensions.width} × ${displayDimensions.height} px`;
        elements.sourcePreview.src = sourcePreviewUrl;
        elements.sourcePreview.alt = `Correctly oriented preview of ${file.name || "the selected PNG"}`;
        elements.transparencyWarning.hidden = !hasTransparency;
        elements.sourcePanel.hidden = false;
        setStatus(
          hasTransparency
            ? "PNG ready. Review the transparency warning before converting."
            : "PNG ready. Choose a quality, then convert.",
          "ready",
        );
      } finally {
        closeDecodedImage(decoded);
      }
    } catch (error) {
      if (operation === state.operation) {
        showError(error);
      }
    } finally {
      if (operation === state.operation) {
        setBusy(false);
      }
    }
  }

  async function convertToJpeg() {
    if (!state.source || state.busy) {
      return;
    }

    const operation = ++state.operation;
    clearResult();
    clearError();
    setBusy(true);
    setStatus("Converting inside the browser…", "working");

    try {
      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = state.source.canvas.width;
      outputCanvas.height = state.source.canvas.height;
      const context = outputCanvas.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error("The browser could not create the JPEG surface.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      context.drawImage(state.source.canvas, 0, 0);

      const quality = Number(elements.quality.value);
      const jpegBlob = await canvasToBlob(outputCanvas, "image/jpeg", quality);
      if (!jpegBlob || jpegBlob.type !== "image/jpeg") {
        throw new Error("The browser did not produce a JPEG file.");
      }

      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      if (!isJpegBytes(jpegBytes)) {
        throw new Error("The conversion did not produce genuine JPEG data.");
      }

      const decodedResult = await decodeBlob(jpegBlob);
      try {
        const resultDimensions = getImageDimensions(decodedResult);
        if (
          resultDimensions.width !== outputCanvas.width
          || resultDimensions.height !== outputCanvas.height
        ) {
          throw new Error("The JPEG result dimensions do not match the preview.");
        }

        if (operation !== state.operation) {
          return;
        }

        const resultUrl = URL.createObjectURL(jpegBlob);
        state.resultUrl = resultUrl;
        elements.resultPreview.src = resultUrl;
        elements.resultDetails.textContent =
          `${outputCanvas.width} × ${outputCanvas.height} px · ${formatBytes(jpegBlob.size)} · ${Math.round(quality * 100)}% quality`;
        elements.downloadLink.href = resultUrl;
        elements.downloadLink.download = createOutputFileName(state.source.file.name);
        elements.downloadLink.hidden = false;
        elements.resultPanel.hidden = false;
        setStatus("JPEG ready. Download it when you’re ready.", "ready");
      } finally {
        closeDecodedImage(decodedResult);
      }
    } catch (error) {
      if (operation === state.operation) {
        showError(error);
      }
    } finally {
      if (operation === state.operation) {
        setBusy(false);
      }
    }
  }

  function reset() {
    state.operation += 1;
    clearResult();
    clearSource();
    clearError();
    elements.fileInput.value = "";
    setBusy(false);
    setStatus("Ready for a PNG.");
  }

  elements.quality.addEventListener("input", updateQualityLabel);
  elements.chooseFile.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", (event) => handleFile(event.target.files?.[0]));

  elements.dropZone.addEventListener("click", () => elements.fileInput.click());
  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.fileInput.click();
    }
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  }

  elements.dropZone.addEventListener("drop", (event) => {
    handleFile(event.dataTransfer?.files?.[0]);
  });
  elements.convertButton.addEventListener("click", convertToJpeg);
  elements.resetButton.addEventListener("click", reset);

  elements.quality.value = String(DEFAULT_JPEG_QUALITY);
  updateQualityLabel();
  elements.downloadLink.addEventListener("click", () => {
    setStatus("JPEG download started.", "ready");
  });
}

export function isJpegBytes(input) {
  const bytes = asBytes(input);
  return bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9;
}

if (typeof document !== "undefined") {
  initializeApp();
}
