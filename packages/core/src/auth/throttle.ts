// SPDX-License-Identifier: AGPL-3.0-or-later
// Progressive delays for repeated failures (sign-in per account and per IP, registration and
// e-mail sending per IP and address). No lockouts: an attacker can't lock a real user out,
// they only get slowed down. Counts live in a store shared by every replica (the database in
// production). Full lockout policy is the login-security module (M3).
import type { ThrottleRepository } from "../domain/ports.ts";

export interface ThrottlePolicy {
  /** Failures allowed before any delay. */
  free: number;
  /** First delay; doubles with every further failure. */
  baseMs: number;
  maxMs: number;
  /** Failures older than this are forgotten. */
  windowMs: number;
}

const MINUTE = 60_000;
/**
 * Posts and replies per member: a volume guard on top of the flood interval. Every post
 * counts; after `free` in the window, each further one waits longer.
 */
export const POSTING_POLICY: ThrottlePolicy = {
  free: 30,
  baseMs: 30_000,
  maxMs: 15 * MINUTE,
  windowMs: 60 * MINUTE,
};
/** Searches per IP (phpBB2's search_flood_interval, gentler): 30 a minute, then waits. */
export const SEARCH_POLICY: ThrottlePolicy = {
  free: 30,
  baseMs: 2_000,
  maxMs: MINUTE,
  windowMs: MINUTE,
};
export const LOGIN_POLICY: ThrottlePolicy = {
  free: 5,
  baseMs: 1_000,
  maxMs: 5 * MINUTE,
  windowMs: 15 * MINUTE,
};
// Per IP is a coarse guard (NAT, schools); per account is the one that matters.
export const LOGIN_IP_POLICY: ThrottlePolicy = {
  free: 50,
  baseMs: 1_000,
  maxMs: 5 * MINUTE,
  windowMs: 15 * MINUTE,
};
export const REGISTER_POLICY: ThrottlePolicy = {
  free: 10,
  baseMs: MINUTE,
  maxMs: 60 * MINUTE,
  windowMs: 60 * MINUTE,
};
/** E-mails a visitor can trigger (reset links, verification resends): per address and per IP. */
export const MAIL_POLICY: ThrottlePolicy = {
  free: 3,
  baseMs: 5 * MINUTE,
  maxMs: 60 * MINUTE,
  windowMs: 60 * MINUTE,
};
export const MAIL_IP_POLICY: ThrottlePolicy = {
  free: 20,
  baseMs: MINUTE,
  maxMs: 60 * MINUTE,
  windowMs: 60 * MINUTE,
};

export type ThrottleStore = Omit<ThrottleRepository, "purge">;

export class Throttle {
  readonly policy: ThrottlePolicy;
  readonly #store: ThrottleStore;
  readonly #prefix: string;
  /** `prefix` namespaces keys, so several throttles can share one store. */
  constructor(policy: ThrottlePolicy, store: ThrottleStore, prefix: string) {
    this.policy = policy;
    this.#store = store;
    this.#prefix = `${prefix}:`;
  }

  /** Milliseconds until the next attempt is allowed (0 = go ahead). */
  async wait(key: string, now: number): Promise<number> {
    const e = await this.#store.get(this.#prefix + key);
    if (!e || now - e.last > this.policy.windowMs) return 0;
    const over = e.failures - this.policy.free;
    if (over < 0) return 0;
    const delay = Math.min(this.policy.baseMs * 2 ** over, this.policy.maxMs);
    return Math.max(0, e.last + delay - now);
  }

  async fail(key: string, now: number): Promise<void> {
    const e = await this.#store.get(this.#prefix + key);
    const fresh = !e || now - e.last > this.policy.windowMs;
    await this.#store.put(this.#prefix + key, fresh ? 1 : e.failures + 1, now);
  }

  async reset(key: string): Promise<void> {
    await this.#store.remove(this.#prefix + key);
  }
}

/** In-memory store (tests, tools), bounded in size. */
export class MemoryThrottleStore implements ThrottleStore {
  readonly #entries = new Map<string, { failures: number; last: number }>();
  readonly #maxKeys: number;
  constructor(maxKeys = 100_000) {
    this.#maxKeys = maxKeys;
  }
  async get(key: string) {
    return this.#entries.get(key);
  }
  async put(key: string, failures: number, last: number) {
    this.#entries.delete(key); // re-insert so Map order tracks recency
    this.#entries.set(key, { failures, last });
    if (this.#entries.size > this.#maxKeys) this.#entries.delete(this.#entries.keys().next().value!);
  }
  async remove(key: string) {
    this.#entries.delete(key);
  }
}
