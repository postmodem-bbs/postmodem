// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test.describe("health", () => {
  test("liveness and readiness", async ({ request }) => {
    expect((await request.get("/healthz")).status()).toBe(200);
    const ready = await request.get("/readyz");
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });
});

test.describe("board index", () => {
  test.use({ locale: "en-US" });

  test("renders with landmarks, title and security headers", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
    await expect(page).toHaveTitle(/Postmodem/);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Welcome to/);
  });

  test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("footer links to the exact running source (AGPL)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Source code" })).toHaveAttribute(
      "href",
      /github\.com\/postmodem-bbs\/postmodem\/tree\//,
    );
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`has no WCAG 2.2 AA violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await expectNoAxeViolations(page);
    });
  }

  test("fits a 320px wide screen without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, locale: "en-US" });

  test("theme and language can be switched with the plain form", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Theme").selectOption("dark");
    await page.getByLabel("Language").selectOption("pl");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Witaj na forum/);
  });
});

test.describe("chosen preferences", () => {
  test("forced dark theme in Polish has no WCAG 2.2 AA violations", async ({ page, context, baseURL }) => {
    // axe needs JavaScript, so this sets the cookies the no-JS form would set.
    await context.addCookies([
      { name: "pm_theme", value: "dark", url: baseURL! },
      { name: "pm_lang", value: "pl", url: baseURL! },
    ]);
    await page.emulateMedia({ colorScheme: "light" }); // the cookie must win over the OS preference
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectNoAxeViolations(page);
  });
});

test.describe("language negotiation", () => {
  test.use({ locale: "pl-PL" });

  test("serves Polish from Accept-Language", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.getByRole("link", { name: "Przejdź do treści" })).toBeAttached();
  });
});
