// SPDX-License-Identifier: AGPL-3.0-or-later
// Images people upload (#131), without an image library: the type and the dimensions come from
// the file's own header, and metadata (EXIF with its GPS position, XMP, IPTC, comments) is
// removed without touching the pixels. phpBB2 refused avatars over the size limits instead of
// resizing them, and so does Postmodem. A file whose header can't be read is refused.

export type ImageType = "png" | "gif" | "jpeg" | "webp";

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
}

export const EXTENSIONS: Record<ImageType, string> = {
  png: ".png",
  gif: ".gif",
  jpeg: ".jpg",
  webp: ".webp",
};

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u32le = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image's type and size, or null if this isn't a PNG, GIF, JPEG or WebP we can read. */
export function readImageInfo(b: Uint8Array): ImageInfo | null {
  const valid = (type: ImageType, width: number, height: number) =>
    width > 0 && height > 0 ? { type, width, height } : null;
  if (b.length >= 24 && PNG_SIGNATURE.every((v, i) => b[i] === v) && ascii(b, 12, 16) === "IHDR")
    return valid("png", u32be(b, 16), u32be(b, 20));
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a"))
    return valid("gif", u16le(b, 6), u16le(b, 8));
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegInfo(b);
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return webpInfo(b);
  return null;
}

/** JPEG: the first start-of-frame marker holds the size. */
function jpegInfo(b: Uint8Array): ImageInfo | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or scan before a frame
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) return null;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) return null;
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return width > 0 && height > 0 ? { type: "jpeg", width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

/** WebP: the first chunk is VP8 (lossy), VP8L (lossless) or VP8X (extended), each with the size. */
function webpInfo(b: Uint8Array): ImageInfo | null {
  const chunk = ascii(b, 12, 16);
  const d = 20; // the chunk's data
  if (chunk === "VP8X") return { type: "webp", width: u24le(b, d + 4) + 1, height: u24le(b, d + 7) + 1 };
  if (chunk === "VP8L") {
    if (b[d] !== 0x2f) return null;
    const bits = u32le(b, d + 1);
    return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
    const width = u16le(b, d + 6) & 0x3fff;
    const height = u16le(b, d + 8) & 0x3fff;
    return width > 0 && height > 0 ? { type: "webp", width, height } : null;
  }
  return null;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * The same image without metadata, or null if the file is malformed. Pixels and what is needed
 * to show them (colour profiles, animation, transparency) stay as they were.
 */
export function stripMetadata(b: Uint8Array, type: ImageType): Uint8Array | null {
  switch (type) {
    case "jpeg":
      return stripJpeg(b);
    case "png":
      return stripPng(b);
    case "gif":
      return stripGif(b);
    case "webp":
      return stripWebp(b);
  }
}

/** JPEG: drops APP1 (EXIF, XMP), APP3–APP13 (IPTC and others) and comments; keeps JFIF, ICC, Adobe. */
function stripJpeg(b: Uint8Array): Uint8Array | null {
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      // Start of scan: the compressed image runs to the end-of-image marker, which can't occur
      // inside it (0xFF is always followed by 0x00 or a restart marker there). Anything after
      // it, where some phones append their own data, is dropped; no end marker, no image.
      for (let j = i + 2; j + 1 < b.length; j++)
        if (b[j] === 0xff && b[j + 1] === 0xd9) {
          keep.push(b.subarray(i, j + 2));
          return concat(keep);
        }
      return null;
    }
    if (marker === 0xd9) return null;
    const length = u16be(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) return null;
    const segment = b.subarray(i, i + 2 + length);
    const drop = marker === 0xfe || marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed);
    if (!drop) keep.push(segment);
    i += 2 + length;
  }
  return null;
}

/** PNG: drops text chunks, EXIF and the modification time; every other chunk is kept. */
function stripPng(b: Uint8Array): Uint8Array | null {
  const DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const length = u32be(b, i);
    const name = ascii(b, i + 4, i + 8);
    const end = i + 12 + length;
    if (end > b.length) return null;
    if (!DROP.has(name)) keep.push(b.subarray(i, end));
    i = end;
    if (name === "IEND") return concat(keep);
  }
  return null;
}

/** GIF: drops comment and XMP blocks; frames, palettes and the loop count stay. */
function stripGif(b: Uint8Array): Uint8Array | null {
  const flags = b[10]!;
  let i = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  const keep: Uint8Array[] = [b.subarray(0, i)];
  /** The end of a run of data sub-blocks starting at `at`, or -1. */
  const subBlocks = (at: number) => {
    while (at < b.length) {
      const size = b[at]!;
      at += 1 + size;
      if (size === 0) return at;
    }
    return -1;
  };
  while (i < b.length) {
    const kind = b[i]!;
    if (kind === 0x3b) {
      keep.push(b.subarray(i, i + 1));
      return concat(keep);
    }
    if (kind === 0x2c) {
      // Image descriptor, its own palette, the LZW code size, then the data.
      const local = b[i + 9]!;
      const start = i;
      i += 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0) + 1;
      const end = subBlocks(i);
      if (end < 0) return null;
      keep.push(b.subarray(start, end));
      i = end;
      continue;
    }
    if (kind !== 0x21) return null;
    const label = b[i + 1]!;
    const end = subBlocks(i + 2);
    if (end < 0) return null;
    const app = label === 0xff ? ascii(b, i + 3, i + 3 + 11) : "";
    if (label !== 0xfe && app !== "XMP DataXMP") keep.push(b.subarray(i, end));
    i = end;
  }
  return null;
}

/** WebP: drops the EXIF and XMP chunks and clears their flags in the VP8X header. */
function stripWebp(b: Uint8Array): Uint8Array | null {
  const keep: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const name = ascii(b, i, i + 4);
    const size = u32le(b, i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > b.length + (size % 2)) return null;
    const chunk = b.slice(i, Math.min(end, b.length));
    if (name === "VP8X") chunk[8] = chunk[8]! & ~0x0c; // the EXIF (0x08) and XMP (0x04) flags
    if (name !== "EXIF" && name !== "XMP ") keep.push(chunk);
    i = end;
  }
  if (i < b.length || !keep.length) return null;
  const body = concat(keep);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return concat([header, body]);
}
