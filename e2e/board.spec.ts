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

  test("keeps phpBB2's index.php and index.php?c= links working", async ({ page }) => {
    await page.goto("/index.php");
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("link", { name: "Ogólne", exact: true }).first().click();
    await expect(page).toHaveURL(/\/index\.php\?c=\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ogólne");
    await expect(page.getByRole("link", { name: "Hydepark", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Komputery", exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
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
    const post = page.locator("article.post").first();
    const id = (await post.getAttribute("id"))!.slice(1);
    await expect(post.getByRole("link", { name: "Link to this post" })).toHaveAttribute(
      "href",
      new RegExp(`viewtopic\\.php\\?t=\\d+&start=15#p${id}$`),
    );
    await page.goto("/");
    await page.goto(`/viewtopic.php?p=${id}`); // phpBB2's own post link
    await expect(page).toHaveURL(new RegExp(`viewtopic\\.php\\?t=\\d+&start=15#p${id}$`));
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
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hydepark");
      await expectNoAxeViolations(page);
      await page.getByRole("link", { name: "Regulamin forum" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Regulamin forum");
      await expectNoAxeViolations(page);
      await page.goto("/");
      await page.getByRole("link", { name: "Witamy na forum Postmodem!" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Witamy na forum Postmodem!");
      await expectNoAxeViolations(page);
    });
  }

  // axe reports text in its own background colour as "incomplete", not as a violation, so the
  // 0.1.0 bug (category links in the link colour on a bar of the same colour) needs its own check.
  for (const colorScheme of ["light", "dark"] as const) {
    test(`links on header bars are readable (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      const links = page.locator(".category-title a");
      await expect(links.first()).toBeVisible();
      const ratios = await links.evaluateAll((elements) => {
        const rgb = (value: string) =>
          value
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
        const luminance = (value: string) => {
          const [r, g, b] = rgb(value).map((c) => {
            const s = c / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        return elements.map((a) => {
          const fg = luminance(getComputedStyle(a).color);
          const bg = luminance(getComputedStyle(a.closest(".category-title")!).backgroundColor);
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        });
      });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
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

  test("a topic's first page describes itself for search engines", async ({ page }) => {
    await page.goto("/viewtopic.php?t=3");
    const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "");
    expect(data).toMatchObject({
      "@type": "DiscussionForumPosting",
      headline: "Wasze pierwsze komputery",
      author: { "@type": "Person", name: expect.any(String) },
      datePublished: expect.stringMatching(/^\d{4}-/),
    });
    expect(data.url).toMatch(/\/viewtopic\.php\?t=3$/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Commodore 64/);
    await page.goto("/viewtopic.php?t=3&start=15");
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test("profiles list recent topics, only from forums the reader can see", async ({ page }) => {
    await page.goto("/profile.php?mode=viewprofile&u=2");
    const recent = page.locator(".panel.recent");
    await expect(recent.getByRole("heading", { level: 2 })).toHaveText("Recent topics");
    await expect(recent.getByRole("link", { name: "Ulubiony edytor tekstu" })).toBeVisible();
    // The members-only forum is hidden from guests, and so are its topics.
    await expect(recent).not.toContainText("Tajny zlot");
    await expectNoAxeViolations(page);
  });

  test("a topic shows its poll's results", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Gry retro" }).first().click();
    await page.getByRole("link", { name: "Najlepsza gra na Amigę?" }).click();
    const poll = page.locator(".panel.poll");
    await expect(poll.getByRole("heading", { level: 2 })).toHaveText("Na czym graliście najwięcej?");
    await expect(poll.getByRole("row", { name: /Amiga 500/ })).toContainText("58%");
    await expect(poll).toContainText("Total votes: 12");
    await expectNoAxeViolations(page);
  });

  test("uploaded images are served only from the uploads directory", async ({ request }) => {
    expect((await request.get("/smilies/smile.svg")).status()).toBe(200);
    for (const path of [
      "/smilies/nope.gif",
      "/avatars/upload/nope.png",
      "/avatars/..%2f..%2fsecrets%2fsecret_key",
    ])
      expect((await request.get(path)).status(), path).toBe(404);
  });

  test("the index says who is signed in right now", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".stats .online")).toContainText(/Signed in during the last 10 minutes: \d+/);
    // Names are separated by ", " so a long list wraps (no "a,b,c" run on narrow screens).
    expect(await page.locator(".stats .online").textContent()).not.toMatch(/,\S/);
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
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("modern");
    await page.getByRole("combobox", { name: "Colour scheme", exact: true }).selectOption("dark");
    await page.getByLabel("Language").selectOption("pl");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-board-theme", "modern");
    await expect(page.locator('link[href="/theme/modern.css"]')).toHaveCount(1);
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

test.describe("default ranks (#130)", () => {
  test("a member's rank is the same for every reader, in each reader's language", async ({ page }) => {
    // The demo's first topic is the Admin's, who owns the board.
    await page.goto("/viewtopic.php?t=1&lang=en");
    const rank = page.locator(".post").first().locator(".post-author .rank");
    // Screen readers hear "Rank: Owner"; the label is visually hidden.
    await expect(rank).toHaveText("Rank: Owner");
    await expect(rank.locator("img")).toHaveAttribute("src", "/ranks/default/en/rank_owner.svg");
    await page.goto("/viewtopic.php?t=1&lang=pl");
    await expect(rank).toHaveText("Ranga: Właściciel");
    await expect(rank.locator("img")).toHaveAttribute("src", "/ranks/default/pl/rank_owner.svg");
    const badge = await page.request.get("/ranks/default/pl/rank_owner.svg");
    expect(badge.headers()["content-type"]).toContain("image/svg+xml");
    // Back to the browser's language for the other tests in this context.
    await page.goto("/?lang=auto");
  });
});
