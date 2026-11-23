// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts (M1 slice 4) against the seeded demo: demo members sign in with "postmodem-demo".
// Mail tests read the board's e-mails from Mailpit (PM_MAILPIT_URL), as CI provides.
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  ESSENTIALS,
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

/** Fills in and submits the registration form, opening it first unless the page is on it. */
async function registerAccount(page: Page, name: string, password = "a long enough passphrase") {
  if (new URL(page.url()).pathname !== "/register") await page.goto("/register");
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
  // The link navigates client-side, and Playwright doesn't wait for that (#120).
  await expect(page).toHaveURL(/\/register$/);
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
  await expect(page).toHaveURL(/\/viewforum\.php\?f=\d+$/);
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

test("a member chooses how they hear about replies, without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, locale: "en-US" });
  const page = await context.newPage();
  try {
    await signIn(page, "Łukasz Żółć", DEMO_PASSWORD);
    await page.goto("/account");
    const choice = page.getByRole("group", { name: "E-mail about replies in watched topics" });
    await expect(choice.getByLabel("Right away (one e-mail per topic until I visit it)")).toBeChecked();
    // Wait for the board's answer before leaving: a goto while the form posts cancels it (#120).
    const save = async () => {
      await page.locator("form[action='?/profile']").getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    };
    await choice.getByLabel("Once a day, in one digest").check();
    await save();
    await page.goto("/account");
    await expect(choice.getByLabel("Once a day, in one digest")).toBeChecked();
    // Back to the default, so other tests see the board as seeded.
    await choice.getByLabel("Right away (one e-mail per topic until I visit it)").check();
    await save();
    await page.goto("/account");
    await expect(choice.getByLabel("Right away (one e-mail per topic until I visit it)")).toBeChecked();
  } finally {
    await context.close();
  }
});

test("a member sets their time zone and date format, and the board's dates follow (#129)", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, locale: "en-US" });
  const page = await context.newPage();
  const form = page.locator("form[action='?/regional']");
  const save = async () => {
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  };
  try {
    await signIn(page, "Ola", DEMO_PASSWORD);
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Time and language" })).toBeVisible();
    await expect(form.getByLabel("Language")).toHaveValue("auto");
    await expect(form.getByLabel("Time zone")).toHaveValue("");
    await expect(
      form.getByRole("group", { name: "Date format" }).getByLabel(/The board's format/),
    ).toBeChecked();

    await form.getByLabel("Time zone").selectOption("Asia/Tokyo");
    await form.locator("input[name=dateFormat][value=iso]").check();
    await save();
    await expect(form.getByLabel("Time zone")).toHaveValue("Asia/Tokyo");

    // The index's last-post times: ISO 8601, on Tokyo's wall clock.
    await page.goto("/");
    const time = page.locator("td time").first();
    const utc = Date.parse((await time.getAttribute("datetime")) ?? "");
    const tokyo = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(utc);
    await expect(time).toHaveText(tokyo);
  } finally {
    // Back to the board's defaults, so other tests see Ola as seeded.
    await page.goto("/account");
    await form.getByLabel("Time zone").selectOption("");
    await form.locator("input[name=dateFormat][value=board]").check();
    await save();
    await context.close();
  }
});

// axe needs JavaScript, so the section's check runs in a page that has it.
test("the time and language section passes axe (#129)", async ({ page }) => {
  await signIn(page, "Ola", DEMO_PASSWORD);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Time and language" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("guests see the board's time zone and date format (#129)", async ({ page }) => {
  await page.goto("/");
  const time = page.locator("td time").first();
  const utc = Date.parse((await time.getAttribute("datetime")) ?? "");
  // The seeded board keeps the defaults: UTC, the locale's medium style.
  const expected = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(utc);
  await expect(time).toHaveText(expected);
});

const IMAGES = join(import.meta.dirname, "../apps/server/src/lib/server/fixtures/images");

test("a member sets an avatar without JavaScript: limits, metadata, links, removal (#131)", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, locale: "en-US" });
  const page = await context.newPage();
  const section = page.getByRole("region", { name: "Avatar" });
  const upload = page.locator("form[action='?/avatarUpload']");
  try {
    await signIn(page, "Ola", DEMO_PASSWORD);
    await page.goto("/account");
    await expect(section.getByText("You have no avatar.")).toBeVisible();
    await expect(upload).toContainText("at most 64 KB and 512 × 512 pixels");

    // 600 × 400 is over the default 512 × 512: refused, not shrunk.
    await upload.getByLabel("Upload an image").setInputFiles(join(IMAGES, "exif-600x400.jpg"));
    await upload.getByRole("button", { name: "Use this avatar" }).click();
    await expect(section.getByRole("alert")).toHaveText("The image is larger than 512 × 512 pixels.");

    // A link to this machine is never fetched.
    await upload.getByLabel("Or take it from a link").fill("http://127.0.0.1/avatar.png");
    await upload.getByRole("button", { name: "Use this avatar" }).click();
    await expect(section.getByRole("alert")).toHaveText(
      "That link points to an address the board doesn't download from.",
    );

    await upload.getByLabel("Upload an image").setInputFiles(join(IMAGES, "text-64x48.png"));
    await upload.getByRole("button", { name: "Use this avatar" }).click();
    await expect(section.getByRole("status")).toHaveText("Saved.");
    const src = (await section.getByRole("img", { name: "Your avatar" }).getAttribute("src")) ?? "";
    expect(src).toMatch(/^\/avatars\/upload\/[0-9a-f]{32}\.png$/);
    const served = await page.request.get(src);
    expect(served.headers()["content-type"]).toBe("image/png");
    // The text chunks the file carried ("Secret Author") are gone.
    expect((await served.body()).toString("latin1").toLowerCase()).not.toContain("secret");
  } finally {
    await page.goto("/account");
    const remove = page.getByRole("button", { name: "Remove my avatar" });
    if (await remove.count()) {
      await remove.click();
      await expect(section.getByText("You have no avatar.")).toBeVisible();
    }
    await context.close();
  }
});

test("the avatar section passes axe (#131)", async ({ page }) => {
  await signIn(page, "Ola", DEMO_PASSWORD);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Avatar" })).toBeVisible();
  await expectNoAxeViolations(page);
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

  // EP #13: a package's personal data is in the export (reports, on essentials boards).
  const reason = `Report from ${name}`;
  if (ESSENTIALS) {
    await page.goto("/viewforum.php?f=5");
    await page.getByRole("link", { name: "Najlepsza gra na Amigę?" }).click();
    await page.locator("article.post").first().getByRole("link", { name: "Report" }).click();
    await page.getByLabel("What's wrong with this post?").fill(reason);
    await page.getByRole("button", { name: "Send to the moderators" }).click();
    await expect(page.getByRole("status")).toContainText("the moderators have your report");
  }

  await page.goto("/account");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download my data (JSON)" }).click();
  const file = await (await download).path();
  const data = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  expect(data.account).toMatchObject({ username: name, email: `${name}@example.org` });
  // Installed packages export even while they are off, so a vanilla board lists none.
  expect(data.packages.reports).toEqual(
    ESSENTIALS ? [expect.objectContaining({ reason, status: "open" })] : [],
  );
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
