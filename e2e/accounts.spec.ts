// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts (M1 slice 4) against the seeded demo: demo members sign in with "postmodem-demo".
// Mail tests read the board's e-mails from Mailpit (PM_MAILPIT_URL), as CI provides.
import { expect, type Page, test } from "@playwright/test";
import {
  expectNoAxeViolations,
  guardCsp,
  latestMail,
  linkIn,
  MAILPIT,
  mailCount,
  signIn,
} from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const DEMO_PASSWORD = "postmodem-demo";
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Fills in and submits the registration form. */
async function registerAccount(page: Page, name: string, password = "a long enough passphrase") {
  await page.goto("/register");
  await page.getByLabel("Username").fill(name);
  await page.getByLabel("E-mail address").fill(`${name}@example.org`);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("I have read and accept the board rules").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("We’ve sent a link to your e-mail address");
}

test("register, confirm the e-mail address, see members-only forums, sign out", async ({ page }) => {
  test.skip(!MAILPIT, "needs Mailpit (PM_MAILPIT_URL)");
  const name = unique();
  await page.goto("/");
  await expect(page.locator("main")).not.toContainText("Strefa użytkowników");
  await page.getByRole("link", { name: "Register" }).click();
  await registerAccount(page, name);
  await expect(page.locator(".site-header")).toContainText("Sign in"); // not signed in yet
  await expectNoAxeViolations(page);

  const mail = await latestMail(`${name}@example.org`);
  expect(mail.subject).toBe("Confirm your e-mail address for Postmodem");
  expect(mail.text).toContain(`registered the account “${name}”`);
  await page.goto(linkIn(mail.text, "/verify"));
  await expect(page.getByText(`Confirm the e-mail address of the account “${name}”`)).toBeVisible();
  await page.getByRole("button", { name: "Confirm and sign in" }).click();

  await expect(page.getByRole("status")).toContainText(`Thanks, ${name}! Your e-mail address is confirmed`);
  await expect(page.locator(".site-header")).toContainText(`Signed in as ${name}`);
  await expect(page.getByRole("link", { name: "Strefa użytkowników" })).toBeVisible();
  // Registered users can read the archive guests only see listed.
  await page.getByRole("link", { name: "Archiwum" }).click();
  await expect(page.getByRole("link", { name: "Stare ogłoszenia z 2004 roku" })).toBeVisible();
  // …but the moderators' room stays hidden.
  await page.goto("/");
  await expect(page.locator("main")).not.toContainText("Moderatornia");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".site-header")).toContainText("Sign in");
  await expect(page.locator("main")).not.toContainText("Strefa użytkowników");

  // The link worked once.
  await page.goto(linkIn(mail.text, "/verify"));
  await expect(page.getByRole("alert")).toContainText("This link has expired or has already been used");
});

test("an unconfirmed account can't sign in, but can get a new link", async ({ page }) => {
  test.skip(!MAILPIT, "needs Mailpit (PM_MAILPIT_URL)");
  const name = unique();
  await registerAccount(page, name);
  const first = await latestMail(`${name}@example.org`);

  await signIn(page, name, "a long enough passphrase");
  await expect(page.getByRole("alert")).toContainText("Your e-mail address isn’t confirmed yet");
  await page.getByRole("button", { name: "Send a new link" }).click();
  await expect(page.getByRole("status")).toContainText("we’ve sent a new link");
  const second = await latestMail(`${name}@example.org`, { after: first.id });

  await page.goto(linkIn(first.text, "/verify")); // superseded by the new one
  await expect(page.getByRole("alert")).toContainText("expired or has already been used");
  await page.goto(linkIn(second.text, "/verify"));
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.locator(".site-header")).toContainText(`Signed in as ${name}`);
});

test("password reset by e-mail signs in with the new password and ends other sessions", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!MAILPIT, "needs Mailpit (PM_MAILPIT_URL)");
  const name = unique();
  const email = `${name}@example.org`;
  await registerAccount(page, name, "the original passphrase");
  await page.goto(linkIn((await latestMail(email)).text, "/verify"));
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.locator(".site-header")).toContainText(`Signed in as ${name}`);

  // A second browser asks for the reset.
  const second = await browser.newContext({
    baseURL,
    locale: "en-US",
    ignoreHTTPSErrors: process.env.PM_IGNORE_HTTPS_ERRORS === "1",
  });
  const other = await second.newPage();
  await other.goto("/login.php");
  await other.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(other).toHaveURL(/\/reset$/);
  const before = await latestMail(email);
  await other.getByLabel("E-mail address", { exact: true }).fill(email);
  await other.getByRole("button", { name: "Send the link" }).click();
  await expect(other.getByRole("status")).toHaveText(/If an account uses that address, we’ve sent it a link/);
  const mail = await latestMail(email, { after: before.id });
  expect(mail.subject).toBe("Reset your password on Postmodem");

  await other.goto(linkIn(mail.text, "/reset"));
  await other.getByLabel("New password").fill("short");
  await other.getByRole("button", { name: "Save and sign in" }).click();
  await expect(other.getByLabel("New password")).toHaveAccessibleDescription(
    /must be at least 10 characters long/,
  );
  await expectNoAxeViolations(other);
  await other.getByLabel("New password").fill("a completely new passphrase");
  await other.getByRole("button", { name: "Save and sign in" }).click();
  await expect(other.getByRole("status")).toContainText("Your password has been changed");
  await expect(other.locator(".site-header")).toContainText(`Signed in as ${name}`);
  await second.close();

  // The first browser was signed out by the reset.
  await page.reload();
  await expect(page.locator(".site-header")).toContainText("Sign in");
  await signIn(page, name, "the original passphrase");
  await expect(page.getByRole("alert")).toHaveText("That username or password is not right.");
  await page.getByLabel("Password").fill("a completely new passphrase");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".site-header")).toContainText(`Signed in as ${name}`);
});

test("asking for a reset reveals nothing about which addresses have accounts", async ({ page }) => {
  test.skip(!MAILPIT, "needs Mailpit (PM_MAILPIT_URL)");
  const nobody = `${unique()}@example.org`;
  await page.goto("/profile.php?mode=sendpassword"); // phpBB2's URL
  await expect(page).toHaveURL(/\/reset$/);
  await page.getByLabel("E-mail address").fill(nobody);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toHaveText(/If an account uses that address, we’ve sent it a link/);
  await page.waitForTimeout(1500); // give the worker time to (not) send anything
  expect(await mailCount(nobody)).toBe(0);
  await page.goto("/reset?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByRole("alert")).toContainText("This link has expired or has already been used");
});

test("registration explains every problem accessibly", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Username").fill("0la"); // looks like the demo's Ola
  await page.getByLabel("E-mail address").fill("not-an-address");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("alert")).toHaveText("Please correct the fields marked below.");
  await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Username")).toHaveAccessibleDescription(/already taken/);
  await expect(page.getByLabel("E-mail address")).toHaveAccessibleDescription(/doesn’t look like an e-mail/);
  await expect(page.getByLabel("Password")).toHaveAccessibleDescription(/at least 10 characters long/);
  await expect(page.getByText("You need to accept the rules to register.")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveValue("0la"); // input is kept
  await expectNoAxeViolations(page);

  await page.getByLabel("Username").fill("Administrator");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Username")).toHaveAccessibleDescription(/reserved/);
});

test("a group member signs in, sees the hidden sub-forum, and the cookie is locked down", async ({
  page,
  context,
}) => {
  await signIn(page, "ola", DEMO_PASSWORD); // case-insensitive
  await expect(page.locator(".site-header")).toContainText("Signed in as Ola");
  const cookie = (await context.cookies()).find((c) => c.name.endsWith("pm_session"));
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });

  await page.getByRole("link", { name: "Hydepark", exact: true }).click();
  await page.getByRole("link", { name: "Moderatornia" }).first().click();
  await expect(page.getByRole("link", { name: "Zgłoszenia do przejrzenia" })).toBeVisible();
  await expectNoAxeViolations(page);

  // Signing out everywhere ends this session too.
  await page.goto("/login.php");
  await page.getByRole("button", { name: "Sign out on all devices" }).click();
  await expect(page.locator(".site-header")).toContainText("Sign in");
});

test("sign-in returns to the page it started from, by e-mail address too", async ({ page }) => {
  await page.goto("/viewtopic.php?t=1");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/redirect=%2Fviewtopic\.php%3Ft%3D1/);
  // Demo users have no e-mail; sign in by name, then check the redirect target.
  await page.getByLabel("Username or e-mail address").fill("retro_fan");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/viewtopic\.php\?t=1$/);
});

test("wrong passwords get one message, then progressive delays", async ({ page }) => {
  const name = unique(); // no such account: same answer as a wrong password
  await signIn(page, name, "wrong password 1");
  await expect(page.getByRole("alert")).toHaveText("That username or password is not right.");
  await expect(page.getByLabel("Username or e-mail address")).toHaveValue(name);
  await expectNoAxeViolations(page);
  for (let i = 2; i <= 6; i++) {
    await page.getByLabel("Password").fill(`wrong password ${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("alert")).toContainText("Too many attempts.");
});

test("cross-site form posts are refused", async ({ request, baseURL }) => {
  const res = await request.post("/login.php?/login", {
    headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
    data: "login=Ola&password=postmodem-demo",
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
  expect(baseURL).toBeTruthy();
});

test("phpBB2's registration URL still works", async ({ page }) => {
  await page.goto("/profile.php?mode=register");
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Register");
});

test("signed-in members show up as online, and see their members-only topics on profiles", async ({
  page,
}) => {
  await signIn(page, "Łukasz Żółć", DEMO_PASSWORD);
  await page.goto("/");
  await expect(page.locator(".stats .online").getByRole("link", { name: "Łukasz Żółć" })).toBeVisible();
  await page.goto("/profile.php?mode=viewprofile&u=2");
  const recent = page.locator(".panel.recent");
  await expect(recent.getByRole("link", { name: "Tajny zlot użytkowników" })).toBeVisible();
});

test("a member downloads their data and deletes their account", async ({ page }) => {
  test.skip(!MAILPIT, "needs Mailpit (PM_MAILPIT_URL)");
  const name = unique();
  await registerAccount(page, name);
  await page.goto(linkIn((await latestMail(`${name}@example.org`)).text, "/verify"));
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.locator(".site-header")).toContainText(`Signed in as ${name}`);

  const reason = `Report from ${name}`;
  await page.goto("/viewforum.php?f=5");
  await page.getByRole("link", { name: "Najlepsza gra na Amigę?" }).click();
  await page.locator("article.post").first().getByRole("link", { name: "Report" }).click();
  await page.getByLabel("What's wrong with this post?").fill(reason);
  await page.getByRole("button", { name: "Send to the moderators" }).click();
  await expect(page.getByRole("status")).toContainText("the moderators have your report");

  await page.goto("/account");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download my data (JSON)" }).click();
  const file = await (await download).path();
  const data = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  expect(data.account).toMatchObject({ username: name, email: `${name}@example.org` });
  expect(data.packages.reports).toEqual([expect.objectContaining({ reason, status: "open" })]);
  expect(JSON.stringify(data)).not.toMatch(/argon2|hash/i);

  const del = page.locator("form[action='?/delete']");
  await del.getByLabel("Current password").fill("wrong password here");
  await del.getByLabel("Yes, delete my account for good").check();
  await del.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.locator("#delete-password-error")).toHaveText("That's not your current password.");
  await page
    .locator("form[action='?/delete']")
    .getByLabel("Current password")
    .fill("a long enough passphrase");
  await page.locator("form[action='?/delete']").getByLabel("Yes, delete my account for good").check();
  await page.locator("form[action='?/delete']").getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Your account has been deleted. Thank you for having been here.",
  );
  await expect(page.locator(".site-header")).toContainText("Sign in");
  await signIn(page, name, "a long enough passphrase");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("the privacy notice is linked from every page and from registration", async ({ page }) => {
  await page.goto("/");
  await page.locator(".site-footer").getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
  await expect(page.locator(".privacy")).toContainText("No tracking, no advertising");
  await expectNoAxeViolations(page);
  await page.goto("/register");
  await expect(page.getByRole("link", { name: "Privacy" }).first()).toHaveAttribute("href", "/privacy");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("signing in and out works with plain forms", async ({ page }) => {
    await signIn(page, "Łukasz Żółć", DEMO_PASSWORD);
    await expect(page.locator(".site-header")).toContainText("Signed in as Łukasz Żółć");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator(".site-header")).toContainText("Sign in");
  });

  test("confirm a new e-mail address while signed in", async ({ page }) => {
    test.skip(!MAILPIT, "needs Mailpit (PM_MAILPIT_URL)");
    const next = `${unique()}@example.org`;
    await signIn(page, "retro_fan", DEMO_PASSWORD);
    await page.goto("/account");

    const form = page.locator('form[action="?/email"]');
    await form.getByLabel("New e-mail address").fill(next);
    await form.getByLabel("Current password").fill(DEMO_PASSWORD);
    await form.getByRole("button", { name: "Send confirmation link" }).click();
    await expect(form.getByRole("status")).toContainText("We sent a confirmation link");
    await expect(page.locator("main")).not.toContainText(next);

    const link = linkIn((await latestMail(next)).text, "/account", "email-token");
    await page.goto(link);
    await expect(page.getByText(`Change your account e-mail address to ${next}?`)).toBeVisible();
    await page.getByRole("button", { name: "Confirm e-mail change" }).click();
    await expect(page.getByRole("status")).toHaveText("Your e-mail address was changed.");
    await expect(page.locator("main")).toContainText(next);
    await page.goto(link);
    await expect(page.getByRole("alert")).toContainText("expired or has already been used");
  });
});
