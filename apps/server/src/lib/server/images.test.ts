// SPDX-License-Identifier: AGPL-3.0-or-later
// Image headers and metadata stripping (#131). The fixtures were made with Pillow: each carries
// planted metadata containing the word "secret" (EXIF with a GPS position, PNG text, a GIF
// comment, WebP EXIF).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readImageInfo, stripMetadata } from "./images.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures/images", name)));
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

const FIXTURES = [
  ["exif-600x400.jpg", "jpeg", 600, 400],
  ["text-64x48.png", "png", 64, 48],
  ["anim-32x32.gif", "gif", 32, 32],
  ["exif-80x60.webp", "webp", 80, 60],
] as const;

describe("readImageInfo", () => {
  it.each(FIXTURES)("reads %s as %s, %i × %i", (name, type, width, height) => {
    expect(readImageInfo(fixture(name))).toEqual({ type, width, height });
  });

  it("refuses anything else, whatever it claims to be", () => {
    expect(readImageInfo(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(readImageInfo(new TextEncoder().encode("GIF89a"))).toBeNull(); // too short
    expect(readImageInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // JPEG with no frame
    expect(readImageInfo(fixture("exif-600x400.jpg").subarray(0, 40))).toBeNull(); // cut short
  });
});

describe("stripMetadata", () => {
  it.each(FIXTURES)("removes the metadata from %s and keeps the image", (name, type, width, height) => {
    const original = fixture(name);
    expect(text(original).toLowerCase()).toContain("secret");
    const stripped = stripMetadata(original, type)!;
    expect(stripped).not.toBeNull();
    expect(text(stripped).toLowerCase()).not.toContain("secret");
    expect(stripped.length).toBeLessThan(original.length);
    expect(readImageInfo(stripped)).toEqual({ type, width, height });
  });

  it("keeps what is needed to show the image", () => {
    // JPEG: everything from the start of the scan on is unchanged.
    const jpeg = fixture("exif-600x400.jpg");
    const sos = (b: Uint8Array) => text(b).indexOf("\xff\xda");
    const strippedJpeg = stripMetadata(jpeg, "jpeg")!;
    expect(text(strippedJpeg).slice(sos(strippedJpeg))).toBe(text(jpeg).slice(sos(jpeg)));
    // PNG: the image data chunk is unchanged.
    const png = fixture("text-64x48.png");
    const idat = (b: Uint8Array) => text(b).slice(text(b).indexOf("IDAT") - 4, text(b).indexOf("IEND"));
    expect(idat(stripMetadata(png, "png")!)).toBe(idat(png));
    // GIF: both frames and the loop count stay.
    const gif = stripMetadata(fixture("anim-32x32.gif"), "gif")!;
    expect(text(gif)).toContain("NETSCAPE2.0");
    expect(text(gif).endsWith(";")).toBe(true);
    // WebP: the RIFF size matches the file.
    const webp = stripMetadata(fixture("exif-80x60.webp"), "webp")!;
    expect(new DataView(webp.buffer).getUint32(4, true)).toBe(webp.length - 8);
  });

  it("refuses a file cut short", () => {
    for (const [name, type] of FIXTURES) {
      const b = fixture(name);
      expect(stripMetadata(b.subarray(0, Math.floor(b.length / 2)), type)).toBeNull();
    }
  });
});
