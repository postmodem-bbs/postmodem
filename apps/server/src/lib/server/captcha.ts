// SPDX-License-Identifier: AGPL-3.0-or-later
// The built-in CAPTCHA provider (M2 slice 7, decision 1 of M2.md): a self-hosted proof of
// work in the ALTCHA style. No images, no third-party requests, nothing to see or hear, so
// it works for blind users too. The server picks a secret number n, sends sha256(salt + n)
// and an HMAC-signed, expiring challenge; the browser tries numbers until the hash matches
// (about a second). Without JavaScript the form passes if it was sent at least
// NO_JS_WAIT_MS after the challenge was issued: a bot can wait too, but it pays in time.
// Each solved challenge is accepted once (remembered in the throttle table until it expires).
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { ThrottleRepository } from "@postmodem/core";

/** Numbers the browser may have to try: ~25,000 on average, under a second on a phone. */
export const POW_MAX = 50_000;
export const CHALLENGE_TTL_MS = 20 * 60_000;
export const NO_JS_WAIT_MS = 5_000;

export interface Challenge {
  algorithm: "SHA-256";
  salt: string;
  challenge: string;
  max: number;
  /** Signed: issued-at and expiry, so the server needs no state until the answer arrives. */
  issued: number;
  expires: number;
  signature: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sign = (secret: string, c: Omit<Challenge, "signature">) =>
  createHmac("sha256", secret)
    .update(`${c.algorithm}|${c.salt}|${c.challenge}|${c.max}|${c.issued}|${c.expires}`)
    .digest("hex");

export function issueChallenge(secret: string, now = Date.now()): Challenge {
  const salt = randomBytes(12).toString("hex");
  const n = randomInt(0, POW_MAX);
  const c = {
    algorithm: "SHA-256" as const,
    salt,
    challenge: sha256(`${salt}${n}`),
    max: POW_MAX,
    issued: now,
    expires: now + CHALLENGE_TTL_MS,
  };
  return { ...c, signature: sign(secret, c) };
}

/** The answer the browser sends back in a hidden field: the challenge plus its number, or none. */
export function encodeAnswer(c: Challenge, number: number | null): string {
  return Buffer.from(JSON.stringify({ ...c, number })).toString("base64url");
}

export type CaptchaResult = "ok" | "missing" | "invalid" | "expired" | "too-fast" | "reused";

export async function verifyAnswer(
  secret: string,
  raw: string | null,
  used: ThrottleRepository,
  now = Date.now(),
): Promise<CaptchaResult> {
  if (!raw) return "missing";
  let a: Challenge & { number: number | null };
  try {
    a = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return "invalid";
  }
  const { signature, number, ...c } = a;
  const expected = sign(secret, c);
  if (
    typeof signature !== "string" ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return "invalid";
  if (now > c.expires) return "expired";
  if (number === null || number === undefined) {
    if (now - c.issued < NO_JS_WAIT_MS) return "too-fast";
  } else if (
    !Number.isInteger(number) ||
    number < 0 ||
    number > c.max ||
    sha256(`${c.salt}${number}`) !== c.challenge
  )
    return "invalid";
  // One use per challenge.
  const key = `captcha:${c.salt}`;
  if (await used.get(key)) return "reused";
  await used.put(key, 1, now);
  return "ok";
}
