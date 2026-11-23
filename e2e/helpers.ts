// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared by every spec: axe with WCAG 2.2 AA tags, and a guard that fails any test whose page
// logged a Content Security Policy violation.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/**
 * Opens a URL and waits until SvelteKit's client has started on it (#120). `page.goto` returns
 * at the `load` event, but the client starts later and calls `history.replaceState` on the
 * page's own URL. WebKit reports that as a navigation, so a `goto` made before it is
 * "interrupted by another navigation" to the page just opened. A page reached through a
 * redirect is the usual case. The client's first replaceState stores `sveltekit:metadata` in
 * `history.state`, so that is what this waits for. Pages with JavaScript only.
 */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => history.state?.["sveltekit:metadata"] !== undefined);
}

export function guardCsp() {
  test.beforeEach(async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    (page as Page & { cspViolations: string[] }).cspViolations = violations;
  });
  test.afterEach(async ({ page }) => {
    expect((page as Page & { cspViolations?: string[] }).cspViolations ?? []).toEqual([]);
  });
}

/**
 * The board's profile (POSTMODEM_PROFILE). CI runs the suite on an `essentials` board and on a
 * `vanilla` one; tests of a package's own behaviour skip themselves on `vanilla`.
 */
export const PROFILE = process.env.PM_PROFILE ?? "essentials";
export const ESSENTIALS = PROFILE !== "vanilla";

/** Mailpit's HTTP API (CI and the dev stack). Mail-dependent tests need it. */
export const MAILPIT = process.env.PM_MAILPIT_URL;

/** Waits for the newest e-mail to `to` (optionally newer than `after`), and returns its text. */
export async function latestMail(to: string, opts: { after?: string; timeoutMs?: number } = {}) {
  if (!MAILPIT) throw new Error("PM_MAILPIT_URL is not set");
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    const id = messages[0]?.ID;
    if (id && id !== opts.after) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Subject: string;
        Text: string;
      };
      return { id, subject: msg.Subject, text: msg.Text };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no e-mail to ${to} arrived`);
}

/** The first link in an e-mail that points at `path` on any host, as a path + query. */
export function linkIn(text: string, path: string, tokenParam = "token"): string {
  const m = new RegExp(
    `https?://[^\\s/]+(${path.replace(/[.?]/g, "\\$&")}\\?${tokenParam}=[A-Za-z0-9_-]+)`,
  ).exec(text);
  if (!m) throw new Error(`no ${path} link in:\n${text}`);
  return m[1]!;
}

/** Counts e-mails to an address (to prove that nothing was sent). */
export async function mailCount(to: string): Promise<number> {
  if (!MAILPIT) throw new Error("PM_MAILPIT_URL is not set");
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await res.json()) as { messages_count: number }).messages_count;
}

/**
 * Signs in through the header link and the plain form (works with and without JavaScript).
 * Returns once the board has answered: it left the sign-in page (signed in, cookie set) or it
 * shows an error. Without the wait, a caller's next `goto` can cut the request off before the
 * session cookie arrives (WebKit does, #84).
 */
export async function signIn(page: Page, login: string, password: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Username or e-mail address").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(async () => {
    const left = !new URL(page.url()).pathname.startsWith("/login");
    expect(left || (await page.getByRole("alert").count()) > 0, "sign-in answered").toBe(true);
  }).toPass();
}

/**
 * Opens the sign-in page of a demo board (#162). `postmodem demo` turns demo mode on while the
 * board runs, so this waits until the board has read the setting (SETTINGS_REFRESH_MS).
 */
export async function openDemoSignIn(page: Page) {
  await expect(async () => {
    await page.goto("/login.php");
    await expect(page.getByRole("heading", { name: "Demo board" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** How often every board process re-reads settings (SETTINGS_REFRESH_MS, apps/server bootstrap.ts). */
const SETTINGS_REFRESH_MS = 5_000;

/**
 * Turns a package on from /admin/packages, where an administrator's `page` already is. The
 * stack board runs two web processes behind its proxy, and the one that didn't take the save
 * keeps the old package list until it next reads settings. So after a change this waits out
 * that refresh, and the test's next request finds the package on whichever process answers.
 */
export async function enablePackage(page: Page, name: RegExp) {
  const box = page.getByRole("checkbox", { name });
  if (await box.isChecked()) return;
  await box.check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.waitForTimeout(SETTINGS_REFRESH_MS + 1_000);
}
