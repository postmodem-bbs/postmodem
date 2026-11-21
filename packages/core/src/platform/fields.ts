// SPDX-License-Identifier: AGPL-3.0-or-later
// Entity fields (PLATFORM-SERVICES §5, M2b slice 10): extra values on users, forums, topics and
// posts, declared by packages, stored in one side table per target, and loaded for a whole
// page in one query per target. Read and write rules are TypeScript in v0; the CEL rules of
// the tier-1 manifest compile to the same shape in M4.
import type { z } from "zod";
import type { Permissions } from "../domain/core-permissions.ts";
import type { FieldStore, FieldTarget } from "../domain/ports.ts";
import type { Id, Node } from "../domain/types.ts";

export const FIELD_TARGETS = ["user", "forum", "topic", "post"] as const;

/** Who is asking, and about which entity (its forum, for per-forum capabilities). */
export interface FieldAccess {
  perms: Permissions;
  entityId: Id;
  /** The forum the entity belongs to (null for users and when it doesn't matter). */
  node: Pick<Node, "id" | "path"> | null;
  /** The entity's owner: the user itself, or the author of a topic or post. */
  ownerId: Id | null;
}

export type FieldRule =
  | "public"
  | "members"
  /** The entity's owner (a user reading their own field, an author their post's). */
  | "self"
  /** Moderators of the entity's forum (moderate.edit there), and admins. */
  | "staff"
  | ((a: FieldAccess) => boolean);

export interface FieldDef<T> {
  /** `<package>.<name>`, e.g. `ip-logging.ip`. */
  key: string;
  target: FieldTarget;
  schema: z.ZodType<T>;
  read: FieldRule;
  write: FieldRule;
  /** Personal data: part of the member's export and removed with their account. */
  personal?: boolean;
}

const KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/;

export function defineField<T>(def: FieldDef<T>): FieldDef<T> {
  if (!KEY.test(def.key)) throw new Error(`invalid field key '${def.key}': expected <package>.<name>`);
  return def;
}

export function allows(rule: FieldRule, a: FieldAccess): boolean {
  if (typeof rule === "function") return rule(a);
  const userId = a.perms.viewer.userId;
  switch (rule) {
    case "public":
      return true;
    case "members":
      return userId !== null;
    case "self":
      return userId !== null && userId === a.ownerId;
    case "staff":
      return a.perms.can("moderate.edit", a.node) || a.perms.can("admin.access", null);
  }
}

export class FieldDeniedError extends Error {}
export class FieldValidationError extends Error {}

export class Fields {
  readonly #defs = new Map<string, FieldDef<unknown>>();
  readonly #store: FieldStore;

  constructor(store: FieldStore, defs: FieldDef<unknown>[] = []) {
    this.#store = store;
    this.register(...defs);
  }

  register(...defs: FieldDef<unknown>[]): this {
    for (const d of defs) {
      if (this.#defs.has(d.key)) throw new Error(`field '${d.key}' is already registered`);
      this.#defs.set(d.key, d);
    }
    return this;
  }

  definitions(target?: FieldTarget): FieldDef<unknown>[] {
    return [...this.#defs.values()].filter((d) => !target || d.target === target);
  }

  /**
   * The fields this reader may see, for every entity of a page in one query. `access` gives
   * each entity's forum and owner. Stored values that no longer validate are left out.
   */
  async load(
    target: FieldTarget,
    entities: { id: Id; node: FieldAccess["node"]; ownerId: Id | null }[],
    perms: Permissions,
    only?: string[],
  ): Promise<Map<Id, Record<string, unknown>>> {
    const defs = this.definitions(target).filter((d) => !only || only.includes(d.key));
    const out = new Map<Id, Record<string, unknown>>();
    if (!defs.length || !entities.length) return out;
    const stored = await this.#store.load(
      target,
      entities.map((e) => e.id),
      defs.map((d) => d.key),
    );
    for (const e of entities) {
      const values = stored.get(e.id);
      if (!values) continue;
      const access: FieldAccess = { perms, entityId: e.id, node: e.node, ownerId: e.ownerId };
      const visible: Record<string, unknown> = {};
      for (const d of defs) {
        if (!(d.key in values) || !allows(d.read, access)) continue;
        const parsed = d.schema.safeParse(values[d.key]);
        if (parsed.success) visible[d.key] = parsed.data;
      }
      if (Object.keys(visible).length) out.set(e.id, visible);
    }
    return out;
  }

  /** Sets (or with `undefined`, clears) a field after checking the write rule and the schema. */
  async set(key: string, access: FieldAccess, value: unknown): Promise<void> {
    const def = this.#defs.get(key);
    if (!def) throw new FieldValidationError(`unknown field '${key}'`);
    if (!allows(def.write, access)) throw new FieldDeniedError(`not allowed to change '${key}'`);
    if (value === undefined) return this.#store.remove(def.target, access.entityId, key);
    const parsed = def.schema.safeParse(value);
    if (!parsed.success)
      throw new FieldValidationError(`${key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    await this.#store.save(def.target, access.entityId, key, parsed.data);
  }

  /** Server-side writes by the package itself (e.g. recording an IP), with no rule to pass. */
  async write(key: string, id: Id, value: unknown): Promise<void> {
    const def = this.#defs.get(key);
    if (!def) throw new FieldValidationError(`unknown field '${key}'`);
    const parsed = def.schema.safeParse(value);
    if (!parsed.success)
      throw new FieldValidationError(`${key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    await this.#store.save(def.target, id, key, parsed.data);
  }

  /** A member's personal user fields, for their data export. */
  async personal(userId: Id): Promise<Record<string, unknown>> {
    const defs = this.definitions("user").filter((d) => d.personal);
    if (!defs.length) return {};
    return (
      (
        await this.#store.load(
          "user",
          [userId],
          defs.map((d) => d.key),
        )
      ).get(userId) ?? {}
    );
  }

  removeEntity(target: FieldTarget, id: Id): Promise<void> {
    return this.#store.removeEntity(target, id);
  }
}
