// SPDX-License-Identifier: AGPL-3.0-or-later
// Typed, namespaced board settings (DESIGN.md §5.2). Packages declare their own;
// values are validated on write and fall back to declared defaults.
import type { z } from "zod";

export interface SettingDef<T> {
  /** Namespaced key, e.g. `core.board.name`. The namespace is the owning package id. */
  key: string;
  schema: z.ZodType<T>;
  default: T;
  scope?: "board" | "node";
}

export function defineSetting<T>(def: SettingDef<T>): SettingDef<T> {
  if (!/^[a-z][a-z0-9-]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(def.key)) {
    throw new Error(`invalid setting key '${def.key}': expected <package>.<group>.<name>`);
  }
  const ok = def.schema.safeParse(def.default);
  if (!ok.success) throw new Error(`default for '${def.key}' does not match its schema`);
  return def;
}

/** Port: where setting values are persisted (implemented in @postmodem/db). */
export interface SettingsStore {
  loadAll(): Promise<Map<string, unknown>>;
  save(key: string, value: unknown): Promise<void>;
}

export class SettingsRegistry {
  readonly #defs = new Map<string, SettingDef<unknown>>();
  register(...defs: SettingDef<unknown>[]): this {
    for (const d of defs) {
      if (this.#defs.has(d.key)) throw new Error(`setting '${d.key}' is already registered`);
      this.#defs.set(d.key, d);
    }
    return this;
  }
  get(key: string): SettingDef<unknown> | undefined {
    return this.#defs.get(key);
  }
  all(): SettingDef<unknown>[] {
    return [...this.#defs.values()];
  }
}

export class SettingValidationError extends Error {}

export class Settings {
  readonly #values = new Map<string, unknown>();
  readonly #registry: SettingsRegistry;
  readonly #store: SettingsStore;

  constructor(registry: SettingsRegistry, store: SettingsStore) {
    this.#registry = registry;
    this.#store = store;
  }

  /** Load persisted values; values that no longer validate fall back to the default. */
  async init(): Promise<string[]> {
    const problems: string[] = [];
    const next = new Map<string, unknown>();
    for (const [key, value] of await this.#store.loadAll()) {
      const def = this.#registry.get(key);
      if (!def) continue; // owned by a package that isn't installed: keep in DB, ignore here
      const parsed = def.schema.safeParse(value);
      if (parsed.success) next.set(key, parsed.data);
      else problems.push(`stored value for '${key}' is invalid; using the default`);
    }
    // Swapped in one go, so a reload never shows readers a half-loaded mix of defaults.
    this.#values.clear();
    for (const [k, v] of next) this.#values.set(k, v);
    return problems;
  }

  /** Re-reads every value (another process, e.g. the CLI or a replica, may have changed one). */
  reload(): Promise<string[]> {
    return this.init();
  }

  /** The registered definition for a key (CLI `settings set`). */
  definition(key: string): SettingDef<unknown> | undefined {
    return this.#registry.get(key);
  }

  /** Every registered key with its current value. */
  entries(): [string, unknown][] {
    return this.#registry.all().map((d) => [d.key, this.get(d)]);
  }

  get<T>(def: SettingDef<T>): T {
    return (this.#values.has(def.key) ? this.#values.get(def.key) : def.default) as T;
  }

  async set<T>(def: SettingDef<T>, value: unknown): Promise<T> {
    if (!this.#registry.get(def.key)) throw new Error(`setting '${def.key}' is not registered`);
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) {
      throw new SettingValidationError(`${def.key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    await this.#store.save(def.key, parsed.data);
    this.#values.set(def.key, parsed.data);
    return parsed.data;
  }
}
