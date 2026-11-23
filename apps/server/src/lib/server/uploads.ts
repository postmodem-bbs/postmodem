// SPDX-License-Identifier: AGPL-3.0-or-later
// Files people and the importer put on the board, under <dataDir>/uploads: smilies/, ranks/
// and avatars/ for now (attachments come with their package, M3). Paths always come from our own
// database or the import report, and are still checked here: nothing outside the directory
// is ever read or written.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

/** The image type of a file, from its first bytes: the name and the browser's type are not trusted. */
export function sniffImage(bytes: Uint8Array): ".png" | ".gif" | ".jpg" | ".webp" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return ".png";
  if (ascii(0, 4) === "GIF8") return ".gif";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return ".webp";
  return null;
}

export type UploadProblem = "empty" | "large" | "type";

/**
 * Stores an uploaded image under `<uploads>/<dir>/upload/`, named by its content, so the same
 * image uploaded twice is one file. Returns the path relative to `<dir>`.
 */
export async function saveUploadedImage(
  uploads: string,
  dir: string,
  file: File,
  maxBytes: number,
): Promise<{ path: string } | { problem: UploadProblem }> {
  if (file.size === 0) return { problem: "empty" };
  if (file.size > maxBytes) return { problem: "large" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return { problem: "type" };
  const name = `upload/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}${ext}`;
  const full = inside(uploads, `${dir}/${name}`);
  if (!full) return { problem: "type" };
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return { path: name };
}
