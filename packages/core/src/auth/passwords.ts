// SPDX-License-Identifier: AGPL-3.0-or-later
// Password hashing (M1 slice 4). New hashes are Argon2id via Node's built-in crypto.argon2
// (no native module), stored as PHC strings so parameters can be raised later. Imported
// phpBB2/Przemo hashes are verified once, then replaced (the caller rehashes on success).
import { argon2, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PasswordScheme } from "../domain/ports.ts";

/** OWASP baseline for Argon2id: 19 MiB, 2 passes, 1 lane (~15 ms here). */
export const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

export const PASSWORD_MIN = 10;
/** Upper bound only to keep hashing cheap for attackers sending megabytes; no other rules. */
export const PASSWORD_MAX = 1024;

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

function argon2id(
  password: string,
  salt: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
) {
  return new Promise<Buffer>((resolve, reject) =>
    argon2("argon2id", { message: password, nonce: salt, ...p }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<{ scheme: PasswordScheme; hash: string }> {
  const salt = randomBytes(16);
  const key = await argon2id(password, salt, ARGON2_PARAMS);
  const { memory: m, passes: t, parallelism: p } = ARGON2_PARAMS;
  return { scheme: "argon2id", hash: `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(key)}` };
}

function parseArgon2(phc: string) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!m) return null;
  const key = Buffer.from(m[5]!, "base64");
  return {
    params: { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: key.length },
    salt: Buffer.from(m[4]!, "base64"),
    key,
  };
}

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const md5 = (s: string | Buffer) => createHash("md5").update(s).digest();

// phpass "portable" hashes ($H$ in Przemo/phpBB3, $P$ in WordPress): iterated MD5.
const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function encode64(input: Buffer, count: number): string {
  let out = "";
  let i = 0;
  do {
    let value = input[i++]!;
    out += ITOA64[value & 0x3f];
    if (i < count) value |= input[i]! << 8;
    out += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i]! << 16;
    out += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    out += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return out;
}
export function phpassHash(password: string, setting: string): string | null {
  if (!/^\$[HP]\$/.test(setting) || setting.length < 12) return null;
  const log2 = ITOA64.indexOf(setting[3]!);
  if (log2 < 7 || log2 > 30) return null;
  const salt = setting.slice(4, 12);
  const pw = Buffer.from(password, "utf8");
  let hash = md5(Buffer.concat([Buffer.from(salt, "latin1"), pw]));
  for (let n = 1 << log2; n > 0; n--) hash = md5(Buffer.concat([hash, pw]));
  return setting.slice(0, 12) + encode64(hash, 16);
}

/**
 * phpBB2 hashed the request value, which PHP's magic quotes (or phpBB2's own addslashes in
 * common.php) had already escaped. Old passwords containing ' " \ were therefore stored with
 * backslashes; try both forms.
 */
const addslashes = (s: string) => s.replace(/[\\'"\0]/g, (c) => (c === "\0" ? "\\0" : `\\${c}`));
const legacyCandidates = (password: string) => [...new Set([password, addslashes(password)])];

export async function verifyPassword(
  password: string,
  scheme: PasswordScheme,
  hash: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (password.length > PASSWORD_MAX) return { ok: false, needsRehash: false };
  switch (scheme) {
    case "argon2id": {
      const parsed = parseArgon2(hash);
      if (!parsed) return { ok: false, needsRehash: false };
      const ok = same(await argon2id(password, parsed.salt, parsed.params), parsed.key);
      const p = parsed.params;
      const weaker =
        p.memory < ARGON2_PARAMS.memory ||
        p.passes < ARGON2_PARAMS.passes ||
        p.tagLength < ARGON2_PARAMS.tagLength;
      return { ok, needsRehash: ok && weaker };
    }
    case "phpbb2-md5": {
      const expected = Buffer.from(hash.toLowerCase(), "utf8");
      const ok = legacyCandidates(password).some((c) => same(Buffer.from(md5(c).toString("hex")), expected));
      return { ok, needsRehash: ok };
    }
    case "phpass": {
      const ok = legacyCandidates(password).some((c) => {
        const h = phpassHash(c, hash);
        return h !== null && same(Buffer.from(h), Buffer.from(hash));
      });
      return { ok, needsRehash: ok };
    }
  }
}

/** Which scheme an imported phpBB2/Przemo `user_password` value uses. */
export function legacyScheme(stored: string): PasswordScheme | null {
  if (/^[0-9a-f]{32}$/i.test(stored)) return "phpbb2-md5";
  if (/^\$[HP]\$[./0-9A-Za-z]{31}$/.test(stored)) return "phpass";
  return null;
}

/** Password policy (NIST 800-63B): length only, no composition rules. */
export function passwordProblem(
  password: string,
  context: string[] = [],
): "too-short" | "too-long" | "same-as-name" | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return "too-short";
  if (password.length > PASSWORD_MAX) return "too-long";
  const lower = password.toLowerCase();
  if (context.some((c) => c && lower === c.toLowerCase())) return "same-as-name";
  return null;
}

/** Hash used to look up opaque tokens (session cookies, e-mail links) without storing them. */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");
export const newToken = () => randomBytes(32).toString("base64url");
