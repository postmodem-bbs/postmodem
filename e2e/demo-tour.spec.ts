// SPDX-License-Identifier: AGPL-3.0-or-later
// The demo board's feature tour (#163): each visible feature has something to look at. Runs on a
// board set up with `postmodem demo` (PM_DEMO=1). When a feature lands with new demo content,
// a check for it goes here (CONTRIBUTING.md, "Demo board").
import { expect, type Page, test } from "@playwright/test";
import { ESSENTIALS, expectNoAxeViolations, guardCsp, openDemoSignIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });
test.skip(process.env.PM_DEMO !== "1", "needs a demo board (postmodem demo) and PM_DEMO=1");

async function signInAs(page: Page, name: string) {
  await openDemoSignIn(page);
  await page.getByRole("button", { name: `Sign in as ${name}`, exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function openTopic(page: Page, forum: string, topic: string) {
  await page.goto("/");
  await page.getByRole("link", { name: forum, exact: true }).click();
  await page.getByRole("link", { name: topic, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(topic);
}

test("the index has the feature tour", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "Pokaz funkcji · Feature tour" })).toBeVisible();
  for (const forum of ["Przedstaw się · Introductions", "English corner", "Moderacja na pokaz · Moderation"])
    await expect(page.getByRole("link", { name: forum, exact: true })).toBeVisible();
});

test("introductions show avatars, signatures and a special rank", async ({ page }) => {
  await openTopic(page, "Przedstaw się · Introductions", "Cześć, jestem Kasia!");
  const kasia = page.locator("article.post").first();
  await expect(kasia.locator(".author-name")).toHaveText("Kasia");
  await expect(kasia.locator("img.avatar")).toBeVisible();
  expect(
    await kasia.locator("img.avatar").evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await expect(kasia.locator(".rank")).toContainText("Weteranka forum");
  await expect(kasia).toContainText("Kasia z Gdańska");
  // Mika's avatar comes from the gallery.
  await expect(
    page.locator("article.post", { hasText: "Hello from Ōsaka" }).locator("img.avatar"),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("the English corner has a poll", async ({ page }) => {
  await openTopic(page, "English corner", "Which theme do you browse in?");
  await expect(page.getByText("Your favourite theme?")).toBeVisible();
});

test("a locked topic says so", async ({ page }) => {
  await openTopic(page, "Moderacja na pokaz · Moderation", "Ten temat jest zamknięty · This topic is locked");
  await expect(page.locator(".badge", { hasText: "Locked" })).toBeVisible();
});

test("Admin has an unread message and an open report", async ({ page }) => {
  await signInAs(page, "Admin");
  const header = page.locator(".site-header");
  await expect(header.getByRole("link", { name: /Messages/ }).locator(".count")).toBeVisible();
  if (!ESSENTIALS) return; // reports are a package (essentials profile)
  await header.getByRole("link", { name: /Reports/ }).click();
  await expect(page.locator(".report-queue li", { hasText: "Spam: reklama zegarków." })).toBeVisible();
});

test("Kasia's profile is filled in", async ({ page }) => {
  await signInAs(page, "Kasia");
  await page.goto("/memberlist.php");
  await page.getByRole("link", { name: "Kasia", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profile of Kasia");
  await expect(page.locator("main")).toContainText("Gdańsk");
  await expect(page.locator("main")).toContainText("Weteranka forum");
});

test("the banned member can't sign in", async ({ page }) => {
  await page.goto("/login.php");
  await page.getByLabel("Username or e-mail address").fill("tanie_zegarki_24");
  await page.getByLabel("Password").fill("postmodem-demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("You have been banned from this board.");
});
