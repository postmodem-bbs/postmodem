// SPDX-License-Identifier: AGPL-3.0-or-later
// Progressive delays for repeated failures (sign-in per account and per IP, registration per
// IP). No lockouts: an attacker can't lock a real user out, they only get slowed down. In
// memory, per process; stack mode with several web replicas gets a DB-backed store with the
// job queue (slice 4b). Full lockout policy is the login-security module (M3).
export interface ThrottlePolicy {
  /** Failures allowed before any delay. */
  free: number;
  /** First delay; doubles with every further failure. */
  baseMs: number;
  maxMs: number;
  /** Failures older than this are forgotten. */
  windowMs: number;
}

export const LOGIN_POLICY: ThrottlePolicy = {
  free: 5,
  baseMs: 1_000,
  maxMs: 5 * 60_000,
  windowMs: 15 * 60_000,
};
// Per IP is a coarse guard (NAT, schools); per account is the one that matters.
export const LOGIN_IP_POLICY: ThrottlePolicy = {
  free: 50,
  baseMs: 1_000,
  maxMs: 5 * 60_000,
  windowMs: 15 * 60_000,
};
export const REGISTER_POLICY: ThrottlePolicy = {
  free: 10,
  baseMs: 60_000,
  maxMs: 60 * 60_000,
  windowMs: 60 * 60_000,
};

interface Entry {
  failures: number;
  last: number;
}

export class Throttle {
  readonly #entries = new Map<string, Entry>();
  readonly policy: ThrottlePolicy;
  readonly maxKeys: number;
  constructor(policy: ThrottlePolicy, maxKeys = 100_000) {
    this.policy = policy;
    this.maxKeys = maxKeys;
  }

  /** Milliseconds until the next attempt is allowed (0 = go ahead). */
  wait(key: string, now: number): number {
    const e = this.#entries.get(key);
    if (!e || now - e.last > this.policy.windowMs) return 0;
    const over = e.failures - this.policy.free;
    if (over < 0) return 0;
    const delay = Math.min(this.policy.baseMs * 2 ** over, this.policy.maxMs);
    return Math.max(0, e.last + delay - now);
  }

  fail(key: string, now: number): void {
    const e = this.#entries.get(key);
    const fresh = !e || now - e.last > this.policy.windowMs;
    this.#entries.delete(key); // re-insert so Map order tracks recency
    this.#entries.set(key, { failures: fresh ? 1 : e.failures + 1, last: now });
    if (this.#entries.size > this.maxKeys) this.#entries.delete(this.#entries.keys().next().value!);
  }

  reset(key: string): void {
    this.#entries.delete(key);
  }
}
