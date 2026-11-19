// SPDX-License-Identifier: AGPL-3.0-or-later
// The package host (M2 slice 3): sets up every installed package, and on each call asks the
// settings which ones are enabled, so `postmodem packages enable …` or the admin panel takes
// effect on a running board within seconds. Package failures are logged, never shown to
// readers: a broken package costs its own contribution, not the page.
import {
  type BoardEvent,
  type BoardEvents,
  type CapabilityDef,
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
  type ProfileName,
  packageRoleGrants,
  type Repositories,
  type Session,
  type Settings,
  type SlotArgs,
  type SlotItem,
  type SlotName,
  type Topic,
  type Viewer,
} from "@postmodem/core";
import { INSTALLED_PACKAGES } from "@postmodem/modules";

export { INSTALLED_PACKAGES };

export interface PackageHost {
  installed: PackageDefinition[];
  loginWait(attempt: LoginAttempt): Promise<number>;
  loginResult(attempt: LoginAttempt, succeeded: boolean): Promise<void>;
  passwordPolicy: PackagePasswordPolicy;
  validateSession(session: Session, ip: string): boolean;
  isEnabled(key: PackageKey): boolean;
  enabled(): PackageKey[];
  emit<E extends BoardEvent>(event: E, payload: BoardEvents[E]): Promise<void>;
  decorateTopics(viewer: Viewer, topics: Topic[]): Promise<Map<Id, Decoration[]>>;
  decorateForums(viewer: Viewer, nodes: Node[]): Promise<Map<Id, Decoration[]>>;
  slot(name: SlotName, args: SlotArgs): Promise<SlotItem[]>;
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
}): Promise<PackageHost> {
  const { installed, settings, log } = opts;
  const enabled = () => enabledPackages(installed, settings.get(enabledPackagesSetting), opts.profile);
  const isEnabled = (key: PackageKey) => enabled().has(key);
  const runtimes = new Map<PackageKey, PackageRuntime>();
  for (const p of installed) {
    try {
      runtimes.set(
        p.key,
        (await p.setup?.({ repos: opts.repos, db: opts.db, settings, log, isEnabled })) ?? {},
      );
    } catch (e) {
      log.error("package failed to start; it stays off", { package: p.key, error: (e as Error).message });
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
    enabled: () => [...enabled()],
    async emit(event, payload) {
      for (const [key, r] of active()) {
        const handler = r.on?.[event] as ((p: typeof payload) => Promise<void> | void) | undefined;
        if (handler) await guarded(key, `event ${event}`, () => handler(payload), undefined);
      }
    },
    decorateTopics: (viewer, topics) => decorate(topics, (r) => r.decorateTopics, viewer),
    decorateForums: (viewer, nodes) => decorate(nodes, (r) => r.decorateForums, viewer),
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
  };
}
