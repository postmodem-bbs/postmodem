// SPDX-License-Identifier: AGPL-3.0-or-later
// Files people and the importer put on the board, under <dataDir>/uploads: smilies/ and
// avatars/ for now (attachments come with their package, M3). Paths always come from our own
// database or the import report, and are still checked here: nothing outside the directory
// is ever read or written.
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";

export const uploadsDir = (dataDir: string) => join(dataDir, "uploads");

/** Raster images only: an SVG could carry script if anyone ever opened it directly. */
const TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** `rel` resolved inside `root`, or null if it would leave it or isn't a plain relative path. */
export function inside(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || rel.includes("\\")) return null;
  const base = resolve(root);
  const full = resolve(base, rel);
  return full.startsWith(base + sep) ? full : null;
}

/** Copies the import report's files from the old board's directory. Missing files are listed. */
export async function copyLegacyFiles(
  oldRoot: string,
  uploads: string,
  files: { from: string; to: string }[],
): Promise<{ copied: number; missing: string[]; refused: string[] }> {
  const out = { copied: 0, missing: [] as string[], refused: [] as string[] };
  for (const f of files) {
    const from = inside(oldRoot, f.from);
    const to = inside(uploads, f.to);
    if (!from || !to || !TYPES[extname(to).toLowerCase()]) {
      out.refused.push(f.from);
      continue;
    }
    try {
      if (!(await stat(from)).isFile()) throw new Error("not a file");
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      out.copied++;
    } catch {
      out.missing.push(f.from);
    }
  }
  return out;
}

/** An uploaded image as an HTTP response, or null (404) if there is no such image. */
export async function serveUpload(uploads: string, rel: string): Promise<Response | null> {
  const full = inside(uploads, rel);
  const type = full && TYPES[extname(full).toLowerCase()];
  if (!full || !type) return null;
  try {
    const body = await readFile(full);
    return new Response(body, {
      headers: {
        "content-type": type,
        "content-length": String(body.length),
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return null;
  }
}
