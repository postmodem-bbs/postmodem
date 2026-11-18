// SPDX-License-Identifier: AGPL-3.0-or-later
// Search and the member list (M2 slice 6). "Spotykamy się w sobotę!" is in the members-only
// forum "Strefa użytkowników": guests must not find it, members must (accents ignored).
// The board runs with core.search.perMinute = 0: every e2e search comes from one IP.
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

test("search finds posts by word prefix, author and forum, never in hidden forums", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Search" })
    .click();
  await page.getByLabel("Words to find").fill("sensibl");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("status")).toHaveText("One post found.");
  await expect(
    page.locator(".search-results").getByRole("link", { name: "Najlepsza gra na Amigę?" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // retro_fan wrote "Sensible Soccer"; Łukasz only quoted it (quotes aren't indexed).
  await page.goto("/search.php?search_keywords=sensible&search_author=retro_fan");
  await expect(page.getByRole("status")).toHaveText("One post found.");
  await page.goto("/search.php?search_keywords=sensible&search_author=Ola");
  await expect(page.getByRole("status")).toHaveText("Nothing found.");
  await page.goto("/search.php?search_keywords=sensible&search_author=nobody-at-all");
  await expect(page.getByRole("alert")).toHaveText("There's no member with that name.");
  await page.goto("/search.php?search_keywords=a");
  await expect(page.getByRole("alert")).toHaveText("Enter at least one word of two or more letters.");

  await page.goto("/search.php?search_keywords=sobote");
  await expect(page.getByRole("status")).toHaveText("Nothing found.");
  await signIn(page, "Łukasz Żółć", "postmodem-demo");
  await page.goto("/search.php?search_keywords=sobote");
  await expect(
    page.locator(".search-results").getByRole("link", { name: "Tajny zlot użytkowników" }),
  ).toBeVisible();
});

test("the member list sorts by name, join date and posts", async ({ page }) => {
  await page.goto("/memberlist.php");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Members");
  await expect(page.getByRole("link", { name: "Łukasz Żółć" })).toBeVisible();
  await page.getByRole("link", { name: "Posts" }).click();
  await expect(page).toHaveURL(/mode=posts&order=DESC/);
  await expect(page.locator("th[aria-sort='descending']")).toHaveText("Posts");
  await expectNoAxeViolations(page);
});
