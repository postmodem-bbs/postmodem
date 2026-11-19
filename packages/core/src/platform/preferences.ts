// SPDX-License-Identifier: AGPL-3.0-or-later
// Preferences (PLATFORM-SERVICES §4, M2b slice 10): per-reader choices declared by the core
// and by packages. Members' values are stored server-side, so they follow them to every
// device; guests' go into one small cookie when the preference allows it. Values that no
// longer validate (a package changed its schema) fall back to the default.
import type { z } from "zod";
import type { Id } from "../domain/types.ts";

export interface PreferenceDef<T> {
  /** `<package>.<name>`, e.g. `core.colorScheme`. */
  key: string;
  schema: z.ZodType<T>;
  default: T;
  /** Where a guest's choice lives: one shared cookie (small scalars only), or nowhere. */
  guest: "cookie" | "none";
}

const KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/;

export function definePreference<T>(def: PreferenceDef<T>): PreferenceDef<T> {
  if (!KEY.test(def.key)) throw new Error(`invalid preference key '${def.key}': expected <package>.<name>`);
  if (!def.schema.safeParse(def.default).success)
    throw new Error(`default for preference '${def.key}' does not match its schema`);
  if (def.guest === "cookie" && !["string", "number", "boolean"].includes(typeof def.default))
    throw new Error(`preference '${def.key}': only scalar values can be kept in the guest cookie`);
  return def;
}

/** Port: members' stored values (implemented in @postmodem/db). */
export interface PreferenceStore {
  load(userId: Id): Promise<Record<string, unknown>>;
  save(userId: Id, key: string, value: unknown): Promise<void>;
  /** Back to the default: the stored value goes. */
  remove(userId: Id, key: string): Promise<void>;
  deleteAll(userId: Id): Promise<void>;
}

/** The guest cookie: every guest-visible preference in one JSON object, at most 2 KB. */
export const PREFERENCE_COOKIE = "pm_prefs";
export const PREFERENCE_COOKIE_MAX = 2048;

export function parsePreferenceCookie(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.length > PREFERENCE_COOKIE_MAX) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** One reader's preferences for one request. */
export interface PreferenceView {
  get<T>(def: PreferenceDef<T>): T;
  /** Only values the reader actually chose (for export). */
  chosen(): Record<string, unknown>;
}

export class PreferenceValidationError extends Error {}

export class Preferences {
  readonly #defs = new Map<string, PreferenceDef<unknown>>();
  readonly #store: PreferenceStore;

  constructor(store: PreferenceStore, defs: PreferenceDef<unknown>[] = []) {
    this.#store = store;
    this.register(...defs);
  }

  register(...defs: PreferenceDef<unknown>[]): this {
    for (const d of defs) {
      if (this.#defs.has(d.key)) throw new Error(`preference '${d.key}' is already registered`);
      this.#defs.set(d.key, d);
    }
    return this;
  }

  definition(key: string): PreferenceDef<unknown> | undefined {
    return this.#defs.get(key);
  }

  all(): PreferenceDef<unknown>[] {
    return [...this.#defs.values()];
  }

  /**
   * A guest's cookie, or a member's stored values over it: what a member chose for their
   * account wins, and the device's own choice (the cookie) fills in the rest, so signing in
   * never switches the language or colours the reader already picked on this device.
   */
  async forReader(userId: Id | null, cookie: string | undefined): Promise<PreferenceView> {
    const values = new Map<string, unknown>();
    const take = (raw: Record<string, unknown>, guestOnly: boolean) => {
      for (const [key, value] of Object.entries(raw)) {
        const def = this.#defs.get(key);
        if (!def || (guestOnly && def.guest !== "cookie")) continue;
        const parsed = def.schema.safeParse(value);
        if (parsed.success) values.set(key, parsed.data);
      }
    };
    take(parsePreferenceCookie(cookie), true);
    if (userId !== null) take(await this.#store.load(userId), false);
    return {
      get: <T>(def: PreferenceDef<T>) => (values.has(def.key) ? values.get(def.key) : def.default) as T,
      chosen: () => Object.fromEntries(values),
    };
  }

  /**
   * Validates and stores a member's choice, or returns the guest's new cookie value (null when
   * the preference isn't kept for guests). Choosing the default removes the stored value.
   */
  async set(
    userId: Id | null,
    key: string,
    value: unknown,
    currentCookie?: string,
  ): Promise<{ cookie: string | null }> {
    const def = this.#defs.get(key);
    if (!def) throw new PreferenceValidationError(`unknown preference '${key}'`);
    const parsed = def.schema.safeParse(value);
    if (!parsed.success)
      throw new PreferenceValidationError(`${key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const isDefault = JSON.stringify(parsed.data) === JSON.stringify(def.default);
    if (userId !== null) {
      if (isDefault) await this.#store.remove(userId, key);
      else await this.#store.save(userId, key, parsed.data);
      return { cookie: null };
    }
    if (def.guest !== "cookie") return { cookie: null };
    const next = parsePreferenceCookie(currentCookie);
    if (isDefault) delete next[key];
    else next[key] = parsed.data;
    const json = JSON.stringify(next);
    if (json.length > PREFERENCE_COOKIE_MAX)
      throw new PreferenceValidationError("too many preferences for a guest");
    return { cookie: json };
  }
}
