// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyLegacyFiles, inside, serveUpload } from "./uploads.ts";

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
