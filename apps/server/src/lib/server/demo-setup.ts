// SPDX-License-Identifier: AGPL-3.0-or-later
// `postmodem demo` and POSTMODEM_DEMO (#162): an empty board becomes the demo in one step.
// The demo content (seedDemo), one shared password for every demo account (Admin included)
// and the settings that make a demo pleasant to click through. The sign-in page then offers
// the accounts (core.demo.enabled).
import {
  defaultLocale,
  demoBoard,
  floodSeconds,
  hashPassword,
  newMemberPosts,
  postsPerHour,
  type Repositories,
  type SettingDef,
  type Settings,
  searchesPerMinute,
  verifyEmailOnRegistration,
} from "@postmodem/core";
import type { AppContext } from "./bootstrap.ts";
import { DEMO_PASSWORD, type SeedResult, seedDemo } from "./demo.ts";
import { rebuildSearch, searchPlan } from "./search.ts";

/** Who you can be on the demo board, in the order the sign-in page offers them. */
export const DEMO_ACCOUNTS = [
  { username: "Admin", role: "admin" },
  { username: "Ola", role: "moderator" },
  { username: "Łukasz Żółć", role: "member" },
  { username: "retro_fan", role: "member" },
] as const;
export type DemoRole = (typeof DEMO_ACCOUNTS)[number]["role"];

const set =
  <T>(def: SettingDef<T>, value: T) =>
  (settings: Settings) =>
    settings.set(def, value);

/** Settings for clicking through a demo: no e-mail round trips, no waiting between posts. */
const DEMO_SETTINGS = [
  set(demoBoard, true),
  set(verifyEmailOnRegistration, false),
  set(floodSeconds, 0),
  set(postsPerHour, 0),
  set(newMemberPosts, 0),
  set(searchesPerMinute, 0),
];

export type DemoSetup =
  | { outcome: "created"; seed: SeedResult }
  | { outcome: "refreshed" }
  | { outcome: "not-a-demo" };

/**
 * A board is a demo if `postmodem demo` set it up, or `seed-demo` filled it (its audit entry).
 * Anything else is someone's real board, which this never touches.
 */
export async function isDemoBoard(ctx: Pick<AppContext, "db" | "settings">): Promise<boolean> {
  if (ctx.settings.get(demoBoard)) return true;
  return (await ctx.db.repos.audit.recent(10_000)).some((e) => e.action === "demo.seeded");
}

/**
 * Seeds an empty board as the demo, or on an existing demo board puts the passwords and the
 * demo settings back (the way to recover forgotten demo passwords). Refuses any other board.
 */
export async function setupDemo(
  ctx: Pick<AppContext, "db" | "settings" | "packages" | "externalSearch">,
  now = Date.now(),
): Promise<DemoSetup> {
  const { repos } = ctx.db;
  let result: DemoSetup;
  if (!(await repos.nodes.tree()).length) {
    const seed = await seedDemo(repos, now, ctx.settings.get(defaultLocale));
    await rebuildSearch(repos, undefined, searchPlan(ctx.packages.searchContributions()));
    await ctx.externalSearch?.rebuild();
    result = { outcome: "created", seed };
  } else if (await isDemoBoard(ctx)) result = { outcome: "refreshed" };
  else return { outcome: "not-a-demo" };

  await setDemoPasswords(repos);
  for (const apply of DEMO_SETTINGS) await apply(ctx.settings);
  return result;
}

async function setDemoPasswords(repos: Repositories) {
  const { scheme, hash } = await hashPassword(DEMO_PASSWORD);
  for (const { username } of DEMO_ACCOUNTS) {
    const user = await repos.users.byUsername(username);
    if (!user) continue;
    await repos.credentials.set(user.id, scheme, hash);
    if (user.status !== "active") await repos.users.update(user.id, { status: "active" });
  }
}

/** The accounts as `postmodem demo` prints them. */
export function demoAccountsTable(publicUrl: string): string {
  const width = Math.max(...DEMO_ACCOUNTS.map((a) => a.username.length));
  return [
    `Demo board: ${publicUrl}`,
    `Every account's password: ${DEMO_PASSWORD}`,
    ...DEMO_ACCOUNTS.map((a) => `  ${a.username.padEnd(width)}  ${a.role}`),
    "The sign-in page offers each account with one click.",
  ].join("\n");
}
