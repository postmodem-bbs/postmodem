// SPDX-License-Identifier: AGPL-3.0-or-later
// Permalinks (ADR 0012): every URL style resolves under every setting, and lands on the
// canonical URL for the current one. CI runs this spec once per style, after
// `postmodem settings set core.urls.style <style>`; PM_URL_STYLE says which one is active.
// Uses the demo board's fixed ids: topic 1 "Witamy na forum Postmodem!", topic 3 "Wasze
// pierwsze komputery" (3 pages), forum 4 Hydepark (2 pages), category 1 Ogólne, user 2.
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const STYLE = (process.env.PM_URL_STYLE ?? "classic") as "classic" | "numbered" | "slug";

/** The canonical URLs for each demo entity, per style. */
const CANONICAL = {
  classic: {
    topic: "/viewtopic.php?t=1",
    topicPage3: "/viewtopic.php?t=3&start=30",
    forumPage2: "/viewforum.php?f=4&start=25",
    category: "/index.php?c=1",
    user: "/profile.php?mode=viewprofile&u=2",
  },
  numbered: {
    topic: "/t/1-witamy-na-forum-postmodem",
    topicPage3: "/t/3-wasze-pierwsze-komputery?page=3",
    forumPage2: "/f/4-hydepark?page=2",
    category: "/c/1-ogolne",
    user: "/u/2-lukasz-zolc",
  },
  slug: {
    topic: "/topic/witamy-na-forum-postmodem",
    topicPage3: "/topic/wasze-pierwsze-komputery?page=3",
    forumPage2: "/forum/hydepark?page=2",
    category: "/category/ogolne",
    user: "/user/lukasz-zolc",
  },
} as const;
const want = CANONICAL[STYLE];
const path = (page: Page) => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};

/** Where a URL lands, without following redirects past the first hop. */
async function firstHop(request: APIRequestContext, url: string) {
  const res = await request.get(url, { maxRedirects: 0 });
  return res.status() === 200 ? url : new URL(res.headers().location!, "http://x").pathname;
}

test.beforeAll(async ({ request }) => {
  // The setting was just changed from the CLI; servers re-read settings every few seconds.
  await expect.poll(() => firstHop(request, CANONICAL.classic.topic), { timeout: 20_000 }).toBe(want.topic);
});

test.describe(`permalinks with the ${STYLE} style`, () => {
  test("the same topic through all three styles", async ({ page }) => {
    for (const from of Object.values(CANONICAL).map((c) => c.topic)) {
      await page.goto(from);
      expect(path(page), `from ${from}`).toBe(want.topic);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Witamy na forum Postmodem!");
    }
    // A wrong slug after the id, or phpBB2's session id, still finds it.
    await page.goto("/t/1-old-title");
    expect(path(page)).toBe(want.topic);
    await page.goto("/viewtopic.php?t=1&sid=0123456789abcdef0123456789abcdef");
    expect(path(page)).toBe(want.topic);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${escapeRegExp(want.topic)}$`),
    );
    await expectNoAxeViolations(page);
  });

  test("start= and page= convert both ways", async ({ page }) => {
    for (const c of Object.values(CANONICAL)) {
      await page.goto(c.topicPage3);
      expect(path(page), `from ${c.topicPage3}`).toBe(want.topicPage3);
      await page.goto(c.forumPage2);
      expect(path(page), `from ${c.forumPage2}`).toBe(want.forumPage2);
    }
    // Past the end lands on the last page; offset 0 is the plain URL.
    await page.goto("/viewtopic.php?t=3&start=9999");
    expect(path(page)).toBe(want.topicPage3);
    await page.goto("/viewtopic.php?t=1&start=0");
    expect(path(page)).toBe(want.topic);
  });

  test("links on the page are in the current style", async ({ page }) => {
    await page.goto(want.forumPage2);
    await expect(page.getByText("Page 2 of 2").first()).toBeVisible();
    const topicLink = page.locator("a.topic-title").first();
    const prev = page.getByRole("link", { name: "Previous" }).first();
    const pattern = {
      classic: /^\/viewtopic\.php\?t=\d+$/,
      numbered: /^\/t\/\d+-[a-z0-9-]+$/,
      slug: /^\/topic\/[a-z0-9-]+$/,
    }[STYLE];
    await expect(topicLink).toHaveAttribute("href", pattern);
    await prev.click();
    const first = want.forumPage2.replace(/[?&](start|page)=\d+$/, "");
    await expect(page).toHaveURL((u) => u.pathname + u.search === first);
  });

  test("post links find the post's page and anchor", async ({ page }) => {
    await page.goto(want.topicPage3);
    const id = (await page.locator("article.post").first().getAttribute("id"))!.slice(1);
    for (const from of [`/viewtopic.php?p=${id}`, `/p/${id}`]) {
      await page.goto("/");
      await page.goto(from);
      expect(path(page) + new URL(page.url()).hash, `from ${from}`).toBe(`${want.topicPage3}#p${id}`);
      await expect(page.locator(`#p${id}`)).toBeVisible();
    }
  });

  test("categories, including phpBB2's index.php?c=", async ({ page }) => {
    for (const from of Object.values(CANONICAL).map((c) => c.category)) {
      await page.goto(from);
      expect(path(page), `from ${from}`).toBe(want.category);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ogólne");
    }
  });

  test("profiles, linked from posts", async ({ page }) => {
    for (const from of Object.values(CANONICAL).map((c) => c.user)) {
      await page.goto(from);
      expect(path(page), `from ${from}`).toBe(want.user);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profile of Łukasz Żółć");
    }
    await page.goto(want.topicPage3);
    await page.locator(".author-name a").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Profile of");
    await expectNoAxeViolations(page);
  });

  test("unknown things are 404, in every style", async ({ request }) => {
    for (const p of [
      "/viewtopic.php?t=999999",
      "/t/999999-x",
      "/topic/no-such-topic",
      "/user/no-such-user",
      "/p/999999",
      "/index.php?c=999999",
    ])
      expect((await request.get(p)).status(), p).toBe(404);
  });
});

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
