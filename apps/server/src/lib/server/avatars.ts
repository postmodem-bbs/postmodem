// SPDX-License-Identifier: AGPL-3.0-or-later
// Avatars (#131), as phpBB2 had them: uploaded, taken from a link, or picked from the gallery.
// An avatar over the board's size or dimension limits is refused, not resized (phpBB2 did the
// same); its metadata (EXIF with the GPS position, comments) is removed before it is stored.
// A link is downloaded once and kept on the board, so readers never load it from the other
// site (PARITY.md §4). Stored as `upload/<content hash>.<ext>` under uploads/avatars.
import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { dirname, extname } from "node:path";
import {
  avatarMaxBytes,
  avatarMaxHeight,
  avatarMaxWidth,
  type Repositories,
  type Settings,
} from "@postmodem/core";
import { EXTENSIONS, readImageInfo, stripMetadata } from "./images.ts";
import { inside, uploadsDir } from "./uploads.ts";

export type AvatarProblem = "empty" | "large" | "type" | "dimensions" | "fetch" | "address";

export interface AvatarLimits {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
}

export const avatarLimits = (settings: Settings): AvatarLimits => ({
  maxBytes: settings.get(avatarMaxBytes),
  maxWidth: settings.get(avatarMaxWidth),
  maxHeight: settings.get(avatarMaxHeight),
});

/**
 * Checks an image against the limits, strips its metadata and stores it under `folder`:
 * `upload` for members' own, named by content, or `gallery/<category>` for the admin's
 * gallery, named after the uploaded file (its name is the image's description there).
 */
export async function storeAvatar(
  dataDir: string,
  bytes: Uint8Array,
  limits: AvatarLimits,
  folder = "upload",
  fileName?: string,
): Promise<{ avatar: string } | { problem: AvatarProblem }> {
  if (!bytes.length) return { problem: "empty" };
  const info = readImageInfo(bytes);
  if (!info) return { problem: "type" };
  if (info.width > limits.maxWidth || info.height > limits.maxHeight) return { problem: "dimensions" };
  const clean = stripMetadata(bytes, info.type);
  if (!clean) return { problem: "type" };
  // The stored file counts: metadata a camera added doesn't push an avatar over the limit.
  if (clean.length > limits.maxBytes) return { problem: "large" };
  const hash = createHash("sha256").update(clean).digest("hex").slice(0, 32);
  const base = fileName ? safeName(fileName) : "";
  let name = `${folder}/${base || hash}${EXTENSIONS[info.type]}`;
  // A gallery name already taken by another image gets a number.
  for (
    let n = 2;
    base && (await stat(inside(uploadsDir(dataDir), `avatars/${name}`) ?? "").catch(() => null));
    n++
  )
    name = `${folder}/${base}-${n}${EXTENSIONS[info.type]}`;
  const full = inside(uploadsDir(dataDir), `avatars/${name}`);
  if (!full) return { problem: "type" };
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, clean);
  return { avatar: name };
}

/** A file's name without its extension, cut to letters, digits, dashes and underscores. */
const safeName = (file: string) =>
  file
    .replace(/\.[^.]*$/, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * Removes an uploaded avatar's file once no member uses it (the same image uploaded by two
 * members is one file). Gallery images and links stay.
 */
export async function releaseAvatar(dataDir: string, repos: Repositories, avatar: string | null) {
  if (!avatar?.startsWith("upload/") || (await repos.users.countWithAvatar(avatar)) > 0) return;
  const full = inside(uploadsDir(dataDir), `avatars/${avatar}`);
  if (full) await unlink(full).catch(() => {});
}

// ── links ────────────────────────────────────────────────────────────────────

/** Addresses a link may not reach: this machine, private networks, and the like. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      v6 === "::" ||
      v6 === "::1" ||
      /^f[cd]/.test(v6) || // unique local fc00::/7
      /^fe[89ab]/.test(v6) || // link-local fe80::/10
      /^ff/.test(v6) || // multicast
      v6.startsWith("64:ff9b:") // NAT64 can reach IPv4 private addresses
    );
  }
  return true;
}

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

/**
 * Downloads an image from a link, as phpBB2's "upload from a URL" did, with what phpBB2 lacked:
 * http(s) only, no private or local addresses (checked on the address actually connected to,
 * so a name can't switch to one between the check and the request), at most three redirects,
 * a time limit and a size limit.
 */
export async function fetchAvatar(
  link: string,
  maxBytes: number,
  opts: { allowPrivate?: boolean } = {},
): Promise<{ bytes: Uint8Array } | { problem: AvatarProblem }> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { problem: "fetch" };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
      return { problem: "fetch" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !opts.allowPrivate && isPrivateAddress(host)) return { problem: "address" };
    let refused = false;
    const lookup = (
      hostname: string,
      options: object,
      done: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ) =>
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return done(err, []);
        const list = addresses as LookupAddress[];
        if (!opts.allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
          refused = true;
          return done(Object.assign(new Error("private address"), { code: "EPRIVATE" }), []);
        }
        done(null, list);
      });
    const response = await new Promise<IncomingMessage | null>((resolve) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          method: "GET",
          lookup,
          timeout: FETCH_TIMEOUT_MS,
          headers: {
            accept: "image/png,image/gif,image/jpeg,image/webp",
            "user-agent": "Postmodem avatar fetch",
          },
        },
        resolve,
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => resolve(null));
      req.end();
    });
    if (!response) return { problem: refused ? "address" : "fetch" };
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status !== 200) {
      response.resume();
      return { problem: "fetch" };
    }
    // Room for metadata the stored copy won't keep, but never an unbounded download.
    const cap = maxBytes * 4;
    const declared = Number(response.headers["content-length"] ?? 0);
    if (declared > cap) {
      response.destroy();
      return { problem: "large" };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const done = await new Promise<"ok" | "large" | "fetch">((resolve) => {
      const timer = setTimeout(() => {
        response.destroy();
        resolve("fetch");
      }, FETCH_TIMEOUT_MS);
      response.on("data", (c: Buffer) => {
        total += c.length;
        if (total > cap) {
          clearTimeout(timer);
          response.destroy();
          resolve("large");
        } else chunks.push(c);
      });
      response.on("end", () => {
        clearTimeout(timer);
        resolve("ok");
      });
      response.on("error", () => {
        clearTimeout(timer);
        resolve("fetch");
      });
    });
    if (done !== "ok") return { problem: done };
    return { bytes: new Uint8Array(Buffer.concat(chunks)) };
  }
  return { problem: "fetch" };
}

// ── gallery ──────────────────────────────────────────────────────────────────

const GALLERY_TYPES = new Set([".png", ".gif", ".jpg", ".jpeg", ".webp"]);

/**
 * The gallery under uploads/avatars/gallery: one folder per category, as in phpBB2, filled by
 * the importer or by the admin. Stored as `gallery/<category>/<file>`.
 */
export async function avatarGallery(dataDir: string): Promise<{ category: string; images: string[] }[]> {
  const root = inside(uploadsDir(dataDir), "avatars/gallery");
  if (!root) return [];
  const out: { category: string; images: string[] }[] = [];
  const categories = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const c of categories.filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = inside(root, c.name);
    if (!dir) continue;
    const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const images = files
      .filter((f) => f.isFile() && GALLERY_TYPES.has(extname(f.name).toLowerCase()))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b));
    if (images.length) out.push({ category: c.name, images });
  }
  return out;
}

/** A gallery choice as stored, if that image exists. */
export async function galleryAvatar(dataDir: string, choice: string): Promise<string | null> {
  const [category, file, ...rest] = choice.split("/");
  if (!category || !file || rest.length || !GALLERY_TYPES.has(extname(file).toLowerCase())) return null;
  const full = inside(uploadsDir(dataDir), `avatars/gallery/${category}/${file}`);
  if (!full) return null;
  const found = await stat(full).catch(() => null);
  return found?.isFile() ? `gallery/${category}/${file}` : null;
}

/**
 * A member's avatar in their data export: where it came from and, for one they uploaded, the
 * image itself, so the export holds their data and not just a link to it.
 */
export async function avatarForExport(dataDir: string, avatar: string | null) {
  if (!avatar) return null;
  if (!avatar.startsWith("upload/"))
    return { source: avatar.startsWith("gallery/") ? "gallery" : "link", value: avatar };
  const full = inside(uploadsDir(dataDir), `avatars/${avatar}`);
  const bytes = full ? await readFile(full).catch(() => null) : null;
  const info = bytes && readImageInfo(new Uint8Array(bytes));
  return {
    source: "upload",
    value: avatar,
    image: bytes && info ? `data:image/${info.type};base64,${bytes.toString("base64")}` : null,
  };
}
