// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs against a board seeded with `postmodem seed-demo` (CI does this before the suite).
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp } from "./helpers.ts";

guardCsp();

async function openHydepark(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Hydepark", exact: true }).click();
  await expect(page).toHaveURL(/\/viewforum\.php\?f=\d+$/);
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

  test("renders categories, forums, sub-forums, stats and security headers", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Board index");
    await expect(page.getByRole("heading", { level: 2, name: "Ogólne" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Gry retro" })).toBeVisible(); // Przemo sub-forum
    await expect(page.getByText(/Our users have written \d+ posts in \d+ topics/)).toBeVisible();
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

  test("keeps phpBB2's index.php?c= links working", async ({ page }) => {
    await page.goto("/index.php");
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("browsing", () => {
  test.use({ locale: "en-US" });

  test("forum lists stickies first and paginates 25 topics per page", async ({ page }) => {
    await openHydepark(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hydepark");
    await expect(page.getByRole("navigation", { name: "You are here" })).toContainText("Ogólne");
    const firstRow = page.locator("table.topics tbody tr").first();
    await expect(firstRow).toContainText("Sticky");
    await expect(page.locator("table.topics tbody tr")).toHaveCount(25);
    await page.getByRole("link", { name: "Next" }).first().click();
    await expect(page).toHaveURL(/start=25/);
    await expect(page.getByRole("link", { name: "Wasze pierwsze komputery" })).toBeVisible();
  });

  test("a topic shows rendered posts with authors and pages them", async ({ page }) => {
    await openHydepark(page);
    await page.getByRole("link", { name: "Next" }).first().click();
    await page.getByRole("link", { name: "Wasze pierwsze komputery" }).click();
    await expect(page.locator("article.post")).toHaveCount(15);
    await expect(page.getByText("Page 1 of 3").first()).toBeVisible();
    await expect(page.locator("article.post").first()).toContainText("Commodore 64");
    await expect(page.locator("article.post strong", { hasText: "Commodore 64" }).first()).toBeVisible();
  });

  test("a ?p= permalink opens the right page at the post", async ({ page }) => {
    await openHydepark(page);
    await page.getByRole("link", { name: "Next" }).first().click();
    await page.getByRole("link", { name: "Wasze pierwsze komputery" }).click();
    await page.getByRole("link", { name: "Next" }).first().click();
    await expect(page).toHaveURL(/start=15/);
    const permalink = await page
      .locator("article.post")
      .first()
      .getByRole("link", { name: "Link to this post" })
      .getAttribute("href");
    await page.goto("/");
    await page.goto(permalink!);
    await expect(page).toHaveURL(/viewtopic\.php\?t=\d+&start=15#p\d+$/);
  });

  test("the showcase post renders BBCode safely and keeps hidden content out", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Witamy na forum Postmodem!" }).click();
    const post = page.locator("article.post").first();
    await expect(post.locator("strong", { hasText: "Postmodem" })).toBeVisible();
    await expect(post.locator("blockquote cite")).toHaveText("Przemo");
    await expect(post.locator("pre code")).toContainText("[b]bez[/b]");
    await expect(post.getByRole("img", { name: ":-D" })).toBeVisible();
    await expect(post).toContainText("This content is hidden.");
    await expect(post).not.toContainText("ten jest ukryty");
    await expect(post.getByRole("link", { name: "www.example.org" })).toHaveAttribute(
      "rel",
      "ugc nofollow noopener",
    );
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`index, forum and topic have no WCAG 2.2 AA violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await expectNoAxeViolations(page);
      await page.getByRole("link", { name: "Hydepark", exact: true }).click();
      await expectNoAxeViolations(page);
      await page.getByRole("link", { name: "Regulamin forum" }).click();
      await expectNoAxeViolations(page);
      await page.goto("/");
      await page.getByRole("link", { name: "Witamy na forum Postmodem!" }).click();
      await expectNoAxeViolations(page);
    });
  }

  test("pages fit a 320px wide screen without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/", "/viewtopic.php?t=1"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("unknown forums and topics are 404s", async ({ request }) => {
    expect((await request.get("/viewforum.php?f=999999")).status()).toBe(404);
    expect((await request.get("/viewtopic.php?t=abc")).status()).toBe(404);
    expect((await request.get("/viewtopic.php?p=999999")).status()).toBe(404);
  });
});

test.describe("permissions (guest)", () => {
  test.use({ locale: "en-US" });
  const secrets = ["Strefa użytkowników", "Moderatornia", "Tajny zlot", "Zgłoszenia do przejrzenia"];

  test("hidden forums are not listed, and the hidden sub-forum is not offered", async ({ page }) => {
    await page.goto("/");
    for (const s of secrets) await expect(page.locator("main")).not.toContainText(s);
    await expect(page.getByRole("link", { name: "Archiwum" })).toBeVisible(); // listed, not readable
    await expect(page.locator(".subforums")).toHaveText(/Gry retro$/);
  });

  test("no forum or topic id leaks hidden content; hidden ones are plain 404s", async ({ request }) => {
    let notFound = 0;
    for (let f = 1; f <= 12; f++) {
      const res = await request.get(`/viewforum.php?f=${f}`);
      const body = await res.text();
      for (const s of secrets) expect(body, `f=${f}`).not.toContain(s);
      if (res.status() === 404) notFound++;
    }
    expect(notFound).toBeGreaterThanOrEqual(2);
    for (let t = 1; t <= 45; t++) {
      const body = await (await request.get(`/viewtopic.php?t=${t}`)).text();
      for (const s of secrets) expect(body, `t=${t}`).not.toContain(s);
    }
  });

  test("a listed but unreadable forum explains itself with a 403", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("row", { name: /Archiwum/ })).toContainText("Restricted");
    const href = await page.getByRole("link", { name: "Archiwum" }).getAttribute("href");
    const res = await page.goto(href!);
    expect(res?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access denied");
    await expect(page.locator("main")).not.toContainText("Stare ogłoszenia");
    await expectNoAxeViolations(page);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, locale: "en-US" });

  test("browsing works and theme/language switch with the plain form", async ({ page }) => {
    await openHydepark(page);
    await page.getByRole("link", { name: "Regulamin forum" }).click();
    await expect(page.locator("article.post")).toHaveCount(1);
    await page.getByLabel("Theme").selectOption("dark");
    await page.getByLabel("Language").selectOption("pl");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Regulamin forum");
    await expect(page.getByRole("navigation", { name: "Jesteś tutaj" })).toBeVisible();
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
    await page.goto("/viewtopic.php?t=1");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectNoAxeViolations(page);
  });
});

test.describe("language negotiation", () => {
  test.use({ locale: "pl-PL" });

  test("serves Polish from Accept-Language", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Strona główna forum");
    await expect(page.getByRole("link", { name: "Przejdź do treści" })).toBeAttached();
  });
});
