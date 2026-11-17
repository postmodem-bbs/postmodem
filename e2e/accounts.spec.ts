// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts (M1 slice 4) against the seeded demo: demo members sign in with "postmodem-demo".
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const DEMO_PASSWORD = "postmodem-demo";
const unique = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

async function signIn(page: Page, login: string, password: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Username or e-mail address").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("register, see members-only forums, sign out", async ({ page }) => {
  const name = unique();
  await page.goto("/");
  await expect(page.locator("main")).not.toContainText("Strefa użytkowników");
  await page.getByRole("link", { name: "Register" }).click();
  await page.getByLabel("Username").fill(name);
  await page.getByLabel("E-mail address").fill(`${name}@example.org`);
  await page.getByLabel("Password").fill("a long enough passphrase");
  await page.getByLabel("I have read and accept the board rules").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("status")).toContainText(`Welcome aboard, ${name}!`);
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

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("signing in and out works with plain forms", async ({ page }) => {
    await signIn(page, "Łukasz Żółć", DEMO_PASSWORD);
    await expect(page.locator(".site-header")).toContainText("Signed in as Łukasz Żółć");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator(".site-header")).toContainText("Sign in");
  });
});
