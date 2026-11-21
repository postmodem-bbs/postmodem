// SPDX-License-Identifier: AGPL-3.0-or-later
// The vanilla profile (PACKAGES.md §5): no package is on, and the pages show nothing a package
// adds. The rest of the suite covers the core itself on both profiles.
import { expect, test } from "@playwright/test";
import { ESSENTIALS, expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

test.skip(ESSENTIALS, "runs on a vanilla board only");
guardCsp();
test.use({ locale: "en-US" });

test("a topic shows no package's additions", async ({ page }) => {
  await signIn(page, "retro_fan", "postmodem-demo");
  await page.goto("/viewforum.php?f=5");
  await expect(page.locator(".pkg-unread")).toHaveCount(0);
  await page.getByRole("link", { name: "Najlepsza gra na Amigę?" }).click();
  await expect(page.locator("article.post").first()).toBeVisible();
  // quick-reply and reports add these; the core reply page is still there.
  await expect(page.locator(".slot-quick-reply")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Report" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reply" }).first()).toBeVisible();
  await expectNoAxeViolations(page);
});
