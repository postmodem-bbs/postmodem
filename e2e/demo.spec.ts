// SPDX-License-Identifier: AGPL-3.0-or-later
// The demo board's sign-in page (#162): one click signs in as each demo account. Needs a board
// set up with `postmodem demo` (CI runs it as the solo job's last step and sets PM_DEMO=1).
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp, openDemoSignIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });
test.skip(process.env.PM_DEMO !== "1", "needs a demo board (postmodem demo) and PM_DEMO=1");

const ACCOUNTS = ["Admin", "Ola", "Łukasz Żółć", "retro_fan", "Kasia"];

test("the sign-in page offers every demo account and passes WCAG 2.2 AA", async ({ page }) => {
  await openDemoSignIn(page);
  await expect(page.getByText("postmodem-demo")).toBeVisible();
  for (const name of ACCOUNTS)
    await expect(page.getByRole("button", { name: `Sign in as ${name}`, exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
});

for (const name of ACCOUNTS)
  test(`one click signs in as ${name}`, async ({ page }) => {
    await openDemoSignIn(page);
    await page.getByRole("button", { name: `Sign in as ${name}`, exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator(".site-header")).toContainText(name);
    if (name === "Admin")
      await expect(
        page.locator(".site-header").getByRole("link", { name: "Admin", exact: true }),
      ).toBeVisible();
  });
