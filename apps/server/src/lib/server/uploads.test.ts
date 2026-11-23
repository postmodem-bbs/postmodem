// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyLegacyFiles, inside, saveUploadedImage, serveUpload, sniffImage } from "./uploads.ts";

const GIF = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");

describe("uploads", () => {
  it("keeps every path inside its directory", () => {
    expect(inside("/data/uploads", "smilies/a.gif")).toBe("/data/uploads/smilies/a.gif");
    for (const bad of ["../secrets/secret_key", "smilies/../../x", "/etc/passwd", "a\\b", "", "x\0"])
      expect(inside("/data/uploads", bad), bad).toBeNull();
  });

  it("copies the old board's images, listing missing ones and refusing anything else", async () => {
    const old = mkdtempSync(join(tmpdir(), "pm-old-"));
    const uploads = mkdtempSync(join(tmpdir(), "pm-up-"));
    mkdirSync(join(old, "images/smiles"), { recursive: true });
    writeFileSync(join(old, "images/smiles/icon_smile.gif"), GIF);
    writeFileSync(join(old, "config.php"), "<?php $dbpasswd = 'x';");
    const result = await copyLegacyFiles(old, uploads, [
      { from: "images/smiles/icon_smile.gif", to: "smilies/icon_smile.gif" },
      { from: "images/smiles/gone.gif", to: "smilies/gone.gif" },
      { from: "config.php", to: "smilies/config.php" },
      { from: "../outside.gif", to: "smilies/outside.gif" },
    ]);
    expect(result).toEqual({
      copied: 1,
      missing: ["images/smiles/gone.gif"],
      refused: ["config.php", "../outside.gif"],
    });
    expect(readFileSync(join(uploads, "smilies/icon_smile.gif"))).toEqual(GIF);

    const res = await serveUpload(uploads, "smilies/icon_smile.gif");
    expect(res?.headers.get("content-type")).toBe("image/gif");
    expect(res?.headers.get("content-security-policy")).toContain("sandbox");
    expect(await serveUpload(uploads, "smilies/gone.gif")).toBeNull();
    expect(await serveUpload(uploads, "../pm-old/config.php")).toBeNull();
  });
});

describe("uploaded images (#130)", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const GIF = new TextEncoder().encode("GIF89a........");

  it("recognises images by their first bytes, not their name", () => {
    expect(sniffImage(PNG)).toBe(".png");
    expect(sniffImage(GIF)).toBe(".gif");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(".jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(".webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("stores an image under a name taken from its content, and refuses others", async () => {
    const uploads = mkdtempSync(join(tmpdir(), "pm-upload-"));
    const saved = await saveUploadedImage(uploads, "ranks", new File([PNG], "star.gif"), 1024);
    expect(saved).toEqual({ path: expect.stringMatching(/^upload\/[0-9a-f]{32}\.png$/) });
    const path = "path" in saved ? saved.path : "";
    expect(readFileSync(join(uploads, "ranks", path))).toEqual(Buffer.from(PNG));
    expect(await saveUploadedImage(uploads, "ranks", new File([PNG], "a.png"), 4)).toEqual({
      problem: "large",
    });
    expect(await saveUploadedImage(uploads, "ranks", new File([], "a.png"), 1024)).toEqual({
      problem: "empty",
    });
    expect(
      await saveUploadedImage(uploads, "ranks", new File(["<svg/>"], "a.png", { type: "image/png" }), 1024),
    ).toEqual({ problem: "type" });
  });
});
