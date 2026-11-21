// SPDX-License-Identifier: AGPL-3.0-or-later
// The package host (M2 slice 3): sets up every installed package, and on each call asks the
// settings which ones are enabled, so `postmodem packages enable …` or the admin panel takes
// effect on a running board within seconds. Package failures are logged, never shown to
// readers: a broken package costs its own contribution, not the page.
import {
  type BoardEvent,
  type BoardEvents,
  type CapabilityDef,
  type ContentHooks,
  type Decoration,
  enabledPackages,
  enabledPackagesSetting,
  type Id,
  type Logger,
  type LoginAttempt,
  type Node,
  type PackageAuth,
  type PackageDefinition,
  type PackageKey,
  type PackagePasswordPolicy,
  type PackageRuntime,
  type PackageSearch,
  type Post,
  type ProfileName,
  packageRoleGrants,
  type RenderReader,
  type Repositories,
  type RequestContext,
  type Session,
  type Settings,
  type SlotArgs,
  type SlotItem,
  type SlotName,
  type Topic,
  type Viewer,
} from "@postmodem/core";
import { INSTALLED_PACKAGES } from "@postmodem/modules";
import type { Platform } from "./platform.ts";

export { INSTALLED_PACKAGES };

export interface PackageHost {
  installed: PackageDefinition[];
  renderTags: ReadonlyMap<string, string>;
  visibleRenderHoles(reader: RenderReader, keys: ReadonlySet<string>): Promise<ReadonlySet<string>>;
  loginWait(attempt: LoginAttempt): Promise<number>;
  loginResult(attempt: LoginAttempt, succeeded: boolean): Promise<void>;
  passwordPolicy: PackagePasswordPolicy;
  validateSession(session: Session, ip: string): boolean;
  isEnabled(key: PackageKey): boolean;
  enabled(): PackageKey[];
  privacyUnavailable(key: PackageKey): boolean;
  emit<E extends BoardEvent>(event: E, payload: BoardEvents[E], request?: RequestContext): Promise<void>;
  exportPersonal(userId: Id): Promise<Record<string, unknown>>;
  erasePersonal(userId: Id, tx: Repositories): Promise<void>;
  personalData(): NonNullable<PackageDefinition["personalData"]>[];
  searchContributions(): readonly (readonly [PackageKey, PackageSearch])[];
  decorateTopics(viewer: Viewer, topics: Topic[]): Promise<Map<Id, Decoration[]>>;
  decorateForums(viewer: Viewer, nodes: Node[]): Promise<Map<Id, Decoration[]>>;
  slot(name: SlotName, args: SlotArgs): Promise<SlotItem[]>;
  /** "post.actions" for a page of posts: per-post slots plus packages' batched ones. */
  postActions(args: Omit<SlotArgs, "post">, posts: Post[]): Promise<Map<Id, SlotItem[]>>;
  /** Every enabled package's housekeeping (scheduler). */
  housekeeping(now: number): Promise<number>;
  /**
   * Every enabled package's content hooks as one (EP-3, EP-5). Policy and filters are
   * security-relevant, so a failing package denies (fails closed); in-transaction hooks abort
   * the command by throwing.
   */
  contentHooks(): ContentHooks;
}

/** What packages add to the permission model, for coreRegistry() and installCorePermissions(). */
export function packagePermissions(installed: PackageDefinition[]) {
  const capabilities: CapabilityDef[] = installed.flatMap((p) => p.capabilities ?? []);
  return { capabilities, roleGrants: packageRoleGrants(installed) };
}

/** Every installed package's migrations, named `<package>/<migration>`. */
export function packageMigrations(installed: PackageDefinition[], dialect: "sqlite" | "pg") {
  return Object.fromEntries(
    installed.flatMap((p) =>
      Object.entries(p.migrations?.(dialect) ?? {}).map(([name, m]) => [`${p.key}/${name}`, m]),
    ),
  );
}

export async function createPackageHost(opts: {
  installed: PackageDefinition[];
  repos: Repositories;
  db: unknown;
  settings: Settings;
  profile: ProfileName;
  log: Logger;
  platform: Platform;
}): Promise<PackageHost> {
  const { installed, settings, log } = opts;
  const enabled = () => enabledPackages(installed, settings.get(enabledPackagesSetting), opts.profile);
  const runtimes = new Map<PackageKey, PackageRuntime>();
  const isEnabled = (key: PackageKey) => runtimes.has(key) && enabled().has(key);
  const privateTopicStates = new Map<PackageKey, Set<string>>();
  for (const p of installed) {
    try {
      const states = new Set(p.privateTopicStates);
      if ([...states].some((state) => !state.startsWith(`${p.key}:`)))
        throw new Error("private topic states must use the package namespace");
      privateTopicStates.set(p.key, states);
      const runtime =
        (await p.setup?.({
          repos: opts.repos,
          db: opts.db,
          settings,
          log,
          isEnabled: (key) => enabled().has(key),
          fields: opts.platform.fields,
          collections: opts.platform.collections,
          channels: opts.platform.channels,
          counters: opts.platform.counters,
        })) ?? {};
      if (p.personalData && (!runtime.privacy?.export || !runtime.privacy.erase))
        throw new Error("personal data requires export and erasure handlers");
      if (p.personalData?.retentionDays !== undefined && !runtime.housekeeping)
        throw new Error("personal data retention requires a housekeeping handler");
      runtimes.set(p.key, runtime);
    } catch (e) {
      log.error("package failed to start; it stays off", { package: p.key, error: (e as Error).message });
    }
  }
  const privacyUnavailable = (key: PackageKey) => !runtimes.get(key)?.privacy;
  const manifests = new Map(installed.map((pkg) => [pkg.key, pkg]));
  function* privacyHandlers() {
    for (const pkg of installed) {
      const privacy = runtimes.get(pkg.key)?.privacy;
      if (pkg.personalData && privacyUnavailable(pkg.key))
        throw new Error(`Privacy handlers unavailable for package ${pkg.key}`);
      if (privacy) yield [pkg.key, privacy] as const;
    }
  }

  const renderTags = new Map<string, string>();
  const holes = new Map<
    string,
    { owner: PackageKey; reveal: NonNullable<PackageRuntime["renderHoles"]>[number]["reveal"] }
  >();
  for (const [owner, runtime] of runtimes) {
    for (const hole of runtime.renderHoles ?? []) {
      if (!hole.key.startsWith(`${owner}:`) || holes.has(hole.key) || renderTags.has(hole.tag)) {
        log.error("invalid or duplicate package render hole", { package: owner, key: hole.key });
        continue;
      }
      renderTags.set(hole.tag, hole.key);
      holes.set(hole.key, { owner, reveal: hole.reveal });
    }
  }
  const active = () => {
    const on = enabled();
    return [...runtimes].filter(([key]) => on.has(key));
  };
  const guarded = async <T>(
    key: PackageKey,
    what: string,
    fn: () => Promise<T> | T,
    fallback: T,
  ): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      log.error(`package ${what} failed`, { package: key, error: (e as Error).message });
      return fallback;
    }
  };
  const decorate = async <T>(
    items: T[],
    pick: (r: PackageRuntime) => ((v: Viewer, items: T[]) => Promise<Map<Id, Decoration>>) | undefined,
    viewer: Viewer,
  ) => {
    const out = new Map<Id, Decoration[]>();
    for (const [key, r] of active()) {
      const fn = pick(r);
      if (!fn) continue;
      const got = await guarded(
        key,
        "decoration",
        () => fn.call(r, viewer, items),
        new Map<Id, Decoration>(),
      );
      for (const [id, d] of got) out.set(id, [...(out.get(id) ?? []), d]);
    }
    return out;
  };
  function runAuthCheck<T>(key: PackageKey, check: keyof PackageAuth, run: () => T, deny: T): T {
    try {
      return run();
    } catch {
      log.error("package auth check failed", { package: key, check });
      return deny;
    }
  }
  return {
    installed,
    privacyUnavailable,
    async loginWait(attempt) {
      let wait = 0;
      for (const [key, { auth }] of active()) {
        const check = auth?.beforeLogin;
        if (!check) continue;
        const delay = await guarded(key, "login check", () => check(attempt), 1000);
        if (Number.isFinite(delay)) wait = Math.max(wait, delay);
      }
      return wait;
    },
    async loginResult(attempt, succeeded) {
      for (const [key, { auth }] of active()) {
        const hook = succeeded ? auth?.afterLoginSuccess : auth?.afterLoginFailure;
        if (hook) await guarded(key, "login result", () => hook(attempt), undefined);
      }
    },
    passwordPolicy(password, user) {
      for (const [key, { auth }] of active()) {
        const check = auth?.passwordPolicy;
        if (!check) continue;
        const problem = runAuthCheck(
          key,
          "passwordPolicy",
          () => check(password, user),
          "policy-unavailable",
        );
        if (problem) return problem;
      }
    },
    validateSession(session, ip) {
      for (const [key, { auth }] of active()) {
        const check = auth?.validateSession;
        if (check && !runAuthCheck(key, "validateSession", () => check(session, ip), false)) return false;
      }
      return true;
    },
    isEnabled,
    enabled: () => [...enabled()].filter((key) => runtimes.has(key)),
    async exportPersonal(userId) {
      const entries = [];
      for (const [key, privacy] of privacyHandlers()) entries.push([key, await privacy.export(userId)]);
      return Object.fromEntries(entries);
    },
    async erasePersonal(userId, tx) {
      for (const [, privacy] of privacyHandlers()) await privacy.erase(userId, tx);
    },
    renderTags,
    async visibleRenderHoles(reader, keys) {
      const on = enabled();
      const visible = new Set<string>();
      await Promise.all(
        [...keys].map(async (key) => {
          const hole = holes.get(key);
          if (
            hole &&
            on.has(hole.owner) &&
            (await guarded(hole.owner, "render hole", () => hole.reveal(reader), false))
          )
            visible.add(key);
        }),
      );
      return visible;
    },
    searchContributions: () =>
      active().flatMap(([key, runtime]) => (runtime.search ? [[key, runtime.search] as const] : [])),
    async emit(event, payload, request) {
      for (const [key, r] of active()) {
        const handler = r.on?.[event] as
          | ((p: typeof payload, context?: RequestContext) => Promise<void> | void)
          | undefined;
        if (!handler) continue;
        const reads = manifests.get(key)?.personalData?.reads ?? [];
        const context = request && {
          via: request.via,
          locale: request.locale,
          timezone: request.timezone,
        };
        if (context) for (const field of reads) Object.assign(context, { [field]: request[field] });
        await guarded(key, `event ${event}`, () => handler(payload, context), undefined);
      }
    },
    personalData() {
      return [...runtimes.keys()].flatMap((key) => {
        const data = manifests.get(key)?.personalData;
        return data ? [data] : [];
      });
    },
    decorateTopics: (viewer, topics) => decorate(topics, (r) => r.decorateTopics, viewer),
    decorateForums: (viewer, nodes) => decorate(nodes, (r) => r.decorateForums, viewer),
    async postActions(args, posts) {
      const out = new Map<Id, SlotItem[]>(posts.map((p) => [p.id, []]));
      for (const [key, r] of active()) {
        const one = r.slots?.["post.actions"];
        if (one)
          for (const post of posts)
            out
              .get(post.id)!
              .push(
                ...(await guarded(key, "slot post.actions", () => one({ ...args, post }), [] as SlotItem[])),
              );
        if (r.postActions) {
          const batch = await guarded(
            key,
            "post actions",
            () => r.postActions!(args, posts),
            new Map<Id, SlotItem[]>(),
          );
          for (const [id, items] of batch) out.get(id)?.push(...items);
        }
      }
      return out;
    },
    async housekeeping(now) {
      let removed = 0;
      const on = enabled();
      for (const [key, r] of runtimes) {
        const prune = r.housekeeping;
        if (prune && (on.has(key) || manifests.get(key)?.personalData))
          removed += await guarded(key, "housekeeping", () => prune(now), 0);
      }
      return removed;
    },
    contentHooks() {
      const withHooks = active().flatMap(([key, r]) => (r.content ? [[key, r.content] as const] : []));
      if (!withHooks.length) return {};
      return {
        policy(q) {
          for (const [key, h] of withHooks) {
            if (!h.policy) continue;
            try {
              const vote = h.policy(q);
              if (vote !== "abstain") return vote;
            } catch (e) {
              log.error("package policy failed; denying", { package: key, error: (e as Error).message });
              return { deny: { package: "core", code: "package-error" } };
            }
          }
          return "abstain";
        },
        async beforeUpdate(e) {
          let draft = e.draft;
          for (const [key, h] of withHooks) {
            if (!h.beforeUpdate) continue;
            try {
              const r = await h.beforeUpdate({ ...e, draft });
              if ("veto" in r) return r;
              draft = r.draft;
            } catch (err) {
              log.error("package filter failed; refusing", { package: key, error: (err as Error).message });
              return { veto: { package: "core", code: "package-error" } };
            }
          }
          return { draft };
        },
        async beforeDelete(e, tx) {
          for (const [key, hooks] of withHooks) {
            const redirect = await hooks.beforeDelete?.(e, tx);
            if (!redirect) continue;
            if (!privateTopicStates.get(key)?.has(redirect.visibility)) {
              log.error("package delete redirect used an unregistered state", { package: key });
              throw new Error("invalid package delete redirect");
            }
            return redirect;
          }
        },
        async postUpdated(e, tx) {
          for (const [, h] of withHooks) await h.postUpdated?.(e, tx);
        },
      };
    },
    async slot(name, args) {
      const items: SlotItem[] = [];
      for (const [key, r] of active()) {
        const fn = r.slots?.[name];
        if (fn) items.push(...(await guarded(key, `slot ${name}`, () => fn(args), [] as SlotItem[])));
      }
      return items;
    },
  };
}

/** The package hooks for one request: decorations and slots for this viewer. */
export function forRequest(locals: App.Locals) {
  const { packages } = locals.ctx;
  const viewer = locals.perms.viewer;
  return {
    decorate: {
      topics: (topics: Topic[]) => packages.decorateTopics(viewer, topics),
      forums: (nodes: Node[]) => packages.decorateForums(viewer, nodes),
    },
    slot: (name: SlotName, args: Omit<SlotArgs, "viewer" | "perms" | "user"> = {}) =>
      packages.slot(name, { viewer, perms: locals.perms, user: locals.user, ...args }),
    postActions: (args: Omit<SlotArgs, "viewer" | "perms" | "user" | "post">, posts: Post[]) =>
      packages.postActions({ viewer, perms: locals.perms, user: locals.user, ...args }, posts),
  };
}
