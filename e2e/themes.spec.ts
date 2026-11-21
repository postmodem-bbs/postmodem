// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, type Page, test } from "@playwright/test";
import { guardCsp, latestMail, linkIn, MAILPIT, open, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const boardTheme = process.env.PM_BOARD_THEME ?? "classic";
const adminPassword = process.env.PM_ADMIN_PASSWORD;

async function expectTheme(page: Page, theme: string) {
  await expect(page.locator("html")).toHaveAttribute("data-board-theme", theme);
  await expect(page.locator(`link[href="/theme/${theme}.css"]`)).toHaveCount(1);
}

async function chooseTheme(page: Page, theme: string) {
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
  await page.getByRole("button", { name: "OK", exact: true }).click();
}

test("guests inherit the board theme and can reset a device choice", async ({
  page,
  browser,
  baseURL,
  ignoreHTTPSErrors,
}) => {
  const response = await page.goto("/");
  expect(response?.headers().vary?.toLowerCase().split(/,\s*/)).toContain("cookie");
  await expectTheme(page, boardTheme);
  await expect(page.locator("html")).toHaveCSS("color-scheme", process.env.PM_COLOR_SCHEME ?? "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");

  const override = boardTheme === "terminal" ? "modern" : "terminal";
  await chooseTheme(page, override);
  await expectTheme(page, override);
  const clean = await browser.newPage({ baseURL, ignoreHTTPSErrors });
  try {
    await open(clean, "/");
    await expectTheme(clean, boardTheme);
  } finally {
    await clean.close();
  }
  await chooseTheme(page, "board");
  await expectTheme(page, boardTheme);
});

test("a member's theme follows their account and can reset to the board default", async ({
  page,
  browser,
  baseURL,
  ignoreHTTPSErrors,
}) => {
  test.skip(!MAILPIT, "needs Mailpit (PM_MAILPIT_URL)");
  const username = `theme${crypto.randomUUID().slice(0, 8)}`;
  const email = `${username}@example.org`;
  const password = "a long enough passphrase";
  await open(page, "/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("E-mail address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("I have read and accept the board rules").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await open(page, linkIn((await latestMail(email)).text, "/verify"));
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.locator(".site-header")).toContainText(`Signed in as ${username}`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".site-header")).toContainText("Sign in");
  const guestTheme = boardTheme === "classic" ? "modern" : "classic";
  await chooseTheme(page, guestTheme);
  await expectTheme(page, guestTheme);

  await signIn(page, username, password);
  const override = boardTheme === "terminal" ? "modern" : "terminal";
  await chooseTheme(page, override);
  await expectTheme(page, override);
  const clean = await browser.newPage({ baseURL, ignoreHTTPSErrors });
  try {
    await signIn(clean, username, password);
    await expectTheme(clean, override);
  } finally {
    await clean.close();
  }
  await chooseTheme(page, "board");
  await expectTheme(page, boardTheme);
});

test("admin changes the board default", async ({ page, browser, baseURL, ignoreHTTPSErrors }) => {
  test.skip(!process.env.PM_TEST_THEME_SETTING || !adminPassword, "run by itself against an isolated board");
  await signIn(page, "Admin", adminPassword!);
  await open(page, "/admin/settings");
  const setting = page.getByLabel("Default theme");
  const original = await setting.inputValue();
  const next = original === "modern" ? "terminal" : "modern";
  const guest = await browser.newPage({ baseURL, ignoreHTTPSErrors });
  try {
    await setting.selectOption(next);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await open(guest, "/");
    await expectTheme(guest, next);
  } finally {
    await setting.selectOption(original);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await guest.close();
  }
});
