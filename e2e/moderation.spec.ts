// SPDX-License-Identifier: AGPL-3.0-or-later
// Moderation (M2 slice 2) on phpBB2's modcp.php. In the demo board Ola moderates
// "Moderatornia" (forum 9) through the Moderatorzy group; retro_fan moderates nothing.
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const PASSWORD = "postmodem-demo";
const MODROOM = "/viewforum.php?f=9";
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

async function topicWithReplies(page: Page, title: string, replies: string[]) {
  await page.goto(MODROOM);
  await page.getByRole("link", { name: "New topic" }).first().click();
  await page.getByLabel("Topic title").fill(title);
  await page.getByLabel("Message").fill("Pierwszy post.");
  await page.getByRole("button", { name: "Post" }).click();
  for (const text of replies) {
    await page.getByRole("link", { name: "Reply" }).first().click();
    // Wait for posting.php: the topic page has a "Message" box too (quick reply).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reply");
    await page.getByLabel("Message").fill(text);
    await page.getByRole("button", { name: "Post" }).click();
  }
  await expect(page.locator("article.post")).toHaveCount(replies.length + 1);
}

test("members who moderate nothing get no tools and a 403", async ({ page }) => {
  await signIn(page, "retro_fan", PASSWORD);
  await page.goto("/viewtopic.php?t=1");
  await expect(page.getByRole("link", { name: "Moderate" })).toHaveCount(0);
  expect((await page.goto("/modcp.php?t=1"))?.status()).toBe(403);
});

test("a moderator locks, splits, merges and moves a topic", async ({ page }) => {
  await signIn(page, "Ola", PASSWORD);
  const title = `Do moderacji ${unique()}`;
  await topicWithReplies(page, title, ["Na temat.", "Nie na temat."]);
  const topicUrl = page.url();

  // Lock, then unlock.
  await page.getByRole("link", { name: "Moderate" }).first().click();
  await expectNoAxeViolations(page);
  await page.getByLabel("Reason").first().fill("porządki");
  await page.getByRole("button", { name: "Lock topic" }).click();
  await expect(page.locator(".page-title .badge", { hasText: "Locked" })).toBeVisible();
  await page.getByRole("link", { name: "Moderate" }).first().click();
  await page.getByRole("button", { name: "Unlock topic" }).click();
  await expect(page.locator(".page-title .badge", { hasText: "Locked" })).toHaveCount(0);

  // Split the off-topic reply into its own topic.
  await page.getByRole("link", { name: "Moderate" }).first().click();
  await page.getByRole("checkbox", { name: /Nie na temat/ }).check();
  await page.getByLabel("Title of the new topic").fill(`${title} (odłączony)`);
  await page.getByRole("button", { name: "Split topic" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${title} (odłączony)`);
  await expect(page.locator("article.post")).toHaveCount(1);
  const splitUrl = page.url();

  // Merge it back: the split topic's old link now leads to the merged one.
  await page.getByRole("link", { name: "Moderate" }).first().click();
  await page.getByLabel("Topic to merge into (number or link)").fill(topicUrl);
  await page.getByRole("button", { name: "Merge into another topic" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator("article.post")).toHaveCount(3);
  await page.goto(splitUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  // Move it to "Komputery", leaving a "moved" link in Moderatornia. Ola doesn't moderate
  // Komputery, so the tools are gone there.
  await page.getByRole("link", { name: "Moderate" }).first().click();
  await page.getByLabel("Move to").selectOption({ label: "— Komputery" });
  await page.getByRole("button", { name: "Move topic" }).click();
  await expect(page.locator("nav.breadcrumbs")).toContainText("Komputery");
  await expect(page.getByRole("link", { name: "Moderate" })).toHaveCount(0);
  await page.goto(MODROOM);
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible();
});

test("a moderator deletes a topic after confirming", async ({ page }) => {
  await signIn(page, "Ola", PASSWORD);
  const title = `Do usunięcia ${unique()}`;
  await topicWithReplies(page, title, []);
  const topicUrl = page.url();
  await page.getByRole("link", { name: "Moderate" }).first().click();
  await page.getByRole("checkbox", { name: /delete this topic/ }).check();
  await page.getByRole("button", { name: "Delete topic" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Moderatornia");
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  expect((await page.goto(topicUrl))?.status()).toBe(404);
});
