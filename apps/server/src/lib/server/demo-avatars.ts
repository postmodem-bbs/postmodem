// SPDX-License-Identifier: AGPL-3.0-or-later
// Avatars for the demo board (#163), drawn at seed time so the repository carries no binary
// images: a symmetric 5×5 pattern in one colour, as a PNG, the same for the same seed.
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const GRID = 5;

/** A `size`×`size` PNG (a multiple of 5 works best) whose pattern and colour come from `seed`. */
export function demoAvatarPng(seed: string, size = 80): Uint8Array {
  const hash = createHash("sha256").update(seed).digest();
  const hue = (hash[0]! / 255) * 360;
  const [r, g, b] = hslToRgb(hue, 0.55, 0.45);
  const on = (x: number, y: number) => {
    const col = x < 3 ? x : GRID - 1 - x; // mirrored left to right
    return (hash[1 + y * 3 + col]! & 1) === 1;
  };
  const cell = size / GRID;
  // One filter byte (0, none) per scanline, then RGB pixels.
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) {
      const lit = on(Math.min(GRID - 1, Math.floor(x / cell)), Math.min(GRID - 1, Math.floor(y / cell)));
      raw.set(lit ? [r, g, b] : [240, 240, 240], row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
