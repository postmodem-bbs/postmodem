// SPDX-License-Identifier: AGPL-3.0-or-later
// The essentials profile's first packages (M2 slices 3–4): quick-reply, reports and
// unread-tracking. In the demo board the Moderatorzy group (Ola) moderates "Gry retro" (5).
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const PASSWORD = "postmodem-demo";
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

test("quick reply posts from under the topic", async ({ page }) => {
  await signIn(page, "retro_fan", PASSWORD);
  await page.goto("/viewforum.php?f=6");
  await page.getByRole("link", { name: "New topic" }).first().click();
  const title = `Szybko ${unique()}`;
  await page.getByLabel("Topic title").fill(title);
  await page.getByLabel("Message").fill("Pierwszy.");
  await page.getByRole("button", { name: "Post" }).click();
  const box = page.locator(".slot-quick-reply");
  await expect(box.getByRole("heading", { level: 2 })).toHaveText("Quick reply");
  await box.getByLabel("Message").fill("Szybka odpowiedź.");
  await box.getByRole("button", { name: "Post" }).click();
  // The reply redirects to the new post; wait for that, not for the old page.
  await page.waitForURL(/#p\d+$|[?&]p=\d+/);
  await expect(page.locator("article.post")).toHaveCount(2);
  await expect(page.locator("article.post").last()).toContainText("Szybka odpowiedź.");
});

test("a member reports a post and a moderator closes the report", async ({ browser }) => {
  const member = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(member, "retro_fan", PASSWORD);
  await member.goto("/viewforum.php?f=5");
  await member.getByRole("link", { name: "Najlepsza gra na Amigę?" }).click();
  // retro_fan wrote the first post: only Łukasz's reply can be reported by them.
  await expect(member.locator("article.post").first().getByRole("link", { name: "Report" })).toHaveCount(0);
  await member.locator("article.post").last().getByRole("link", { name: "Report" }).click();
  const reason = `Obraźliwe ${unique()}`;
  await member.getByLabel("What's wrong with this post?").fill(reason);
  await member.getByRole("button", { name: "Send to the moderators" }).click();
  await expect(member.getByRole("status")).toHaveText("Thanks: the moderators have your report.");
  await expectNoAxeViolations(member);

  const mod = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(mod, "Ola", PASSWORD);
  await mod
    .locator(".site-header")
    .getByRole("link", { name: /Reports/ })
    .click();
  await expect(mod.getByRole("heading", { level: 1 })).toHaveText("Open reports");
  const item = mod.locator(".report-queue li", { hasText: reason });
  await expect(item).toContainText("Reported by retro_fan");
  await expectNoAxeViolations(mod);
  await item.getByLabel("Outcome").fill("Upomnienie.");
  await item.getByRole("button", { name: "Close report" }).click();
  await expect(mod.locator(".report-queue li", { hasText: reason })).toHaveCount(0);
});

test("unread topics are marked until read, and 'mark all read' clears them", async ({ browser }) => {
  const writer = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(writer, "retro_fan", PASSWORD);
  await writer.goto("/viewforum.php?f=6");
  await writer.getByRole("link", { name: "New topic" }).first().click();
  const title = `Nieprzeczytany ${unique()}`;
  await writer.getByLabel("Topic title").fill(title);
  await writer.getByLabel("Message").fill("Nowość.");
  await writer.getByRole("button", { name: "Post" }).click();

  const reader = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(reader, "Łukasz Żółć", PASSWORD);
  await reader.goto("/viewforum.php?f=6");
  const row = reader.locator("tr", { has: reader.getByRole("link", { name: title }) });
  await expect(row.locator(".pkg-unread")).toHaveText("new");
  await expectNoAxeViolations(reader);
  await row.getByRole("link", { name: title }).click();
  await expect(reader.getByRole("heading", { level: 1 })).toHaveText(title);
  await reader.goto("/viewforum.php?f=6");
  await expect(row.locator(".pkg-unread")).toHaveCount(0);

  // A new reply makes it unread again; "Mark all forums read" on the index clears it.
  await writer.locator(".slot-quick-reply").getByLabel("Message").fill("Jeszcze jedno.");
  await writer.locator(".slot-quick-reply").getByRole("button", { name: "Post" }).click();
  await expect(writer.locator("article.post")).toHaveCount(2);
  await reader.goto("/viewforum.php?f=6");
  await expect(row.locator(".pkg-unread")).toHaveText("new");
  await reader.goto("/");
  await reader.getByRole("button", { name: "Mark all forums read" }).click();
  await expect(reader).toHaveURL(/\/$/);
  await reader.goto("/viewforum.php?f=6");
  await expect(row.locator(".pkg-unread")).toHaveCount(0);
});
