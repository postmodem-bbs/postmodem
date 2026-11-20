// SPDX-License-Identifier: AGPL-3.0-or-later
// Posting (M2 slice 1): new topics, replies, quotes, edits and deletes on phpBB2's
// posting.php, with and without JavaScript. Posts go to "Komputery" (forum 6), which no
// other spec counts. The board runs with core.posting.floodSeconds = 0 and
// core.posting.perHour = 0 (CI sets both after seed-demo): those limits are covered by the
// core's tests, and every browser posting as the same demo users would trip them here.
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const PASSWORD = "postmodem-demo";
const FORUM = "/viewforum.php?f=6";
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

async function newTopic(page: Page, title: string, body: string) {
  await page.goto(FORUM);
  await page.getByRole("link", { name: "New topic" }).first().click();
  await page.getByLabel("Topic title").fill(title);
  await page.getByLabel("Message").fill(body);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
}

test("guests see no posting buttons and are sent to sign in", async ({ page }) => {
  await page.goto(FORUM);
  await expect(page.getByRole("link", { name: "New topic" })).toHaveCount(0);
  await page.goto("/posting.php?mode=newtopic&f=6");
  await expect(page).toHaveURL(/\/login\.php\?redirect=%2Fposting\.php/);
});

test("a member starts a topic, previews and posts a reply, quotes, edits and deletes", async ({ page }) => {
  await signIn(page, "retro_fan", PASSWORD);
  const title = `Zasilacz AT ${unique()}`;
  await newTopic(page, title, "Szukam [b]zasilacza[/b] do 486 :-)");
  await expect(page.locator("article.post strong", { hasText: "zasilacza" })).toBeVisible();

  // An empty reply explains itself; a preview renders without saving.
  await page.getByRole("link", { name: "Reply" }).first().click();
  // Wait for posting.php: the topic page has a "Message" box and "Post" button too (quick reply).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reply");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("alert")).toHaveText("Write a message.");
  await page.getByLabel("Message").fill("Mam jeden [i]na strychu[/i].");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator(".panel.preview em")).toHaveText("na strychu");
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.locator("article.post")).toHaveCount(2);

  // Quoting fills in the quote; the last post is ours, so it can be edited and deleted.
  await page.locator("article.post").first().getByRole("link", { name: "Quote" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reply");
  await expect(page.getByLabel("Message")).toHaveValue(/^\[quote="retro_fan"\]Szukam/);
  await page.goBack();
  const last = page.locator("article.post").last();
  await last.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edit post");
  await page.getByLabel("Message").fill("Mam dwa na strychu.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("article.post").last()).toContainText("Mam dwa na strychu.");
  // The first post isn't the last one any more: it can be edited, not deleted.
  await expect(page.locator("article.post").first().getByRole("link", { name: "Delete" })).toHaveCount(0);
  await page.locator("article.post").last().getByRole("link", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("article.post")).toHaveCount(1);
});

test("hide blocks unlock for the reader who replied and stay private for guests", async ({
  page,
  browser,
}) => {
  await signIn(page, "retro_fan", PASSWORD);
  const marker = `Protected ${unique()}`;
  await newTopic(page, `Hidden content ${unique()}`, `Public introduction. [hide][b]${marker}[/b][/hide]`);
  const topicUrl = page.url();
  const first = page.locator("article.post").first();
  await expect(first).toContainText("This content is hidden.");
  expect(await page.content()).not.toContain(marker);

  await first.getByRole("link", { name: "Quote" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reply");
  await expect(page.getByLabel("Message")).not.toHaveValue(new RegExp(marker));
  await page.getByLabel("Message").fill("A public reply.");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(first.locator("strong", { hasText: marker })).toBeVisible();

  const guest = await browser.newContext({ javaScriptEnabled: false, locale: "en-US" });
  try {
    const guestPage = await guest.newPage();
    const response = await guestPage.goto(topicUrl);
    expect(await response?.text()).not.toContain(marker);
    await expect(guestPage.locator("article.post").first()).toContainText("This content is hidden.");
    await guestPage.goto(new URL(`/search.php?search_keywords=${encodeURIComponent(marker)}`, topicUrl).href);
    await expect(guestPage.getByRole("status")).toHaveText("Nothing found.");
  } finally {
    await guest.close();
  }
});

test("members can't edit someone else's post", async ({ page, request }) => {
  await signIn(page, "retro_fan", PASSWORD);
  // Post 1 is the admin's welcome post.
  const res = await page.goto("/posting.php?mode=editpost&p=1");
  expect(res?.status()).toBe(403);
  expect((await request.get("/posting.php?mode=bogus")).status()).toBe(404);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("posting works with the plain form, without the toolbar", async ({ page }) => {
    await signIn(page, "Ola", PASSWORD);
    const title = `Bez JS ${unique()}`;
    await page.goto(FORUM);
    await page.getByRole("link", { name: "New topic" }).first().click();
    await expect(page.getByRole("toolbar")).toHaveCount(0);
    await page.getByLabel("Topic title").fill(title);
    await page.getByLabel("Message").fill("Działa bez JavaScriptu.");
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  });
});
