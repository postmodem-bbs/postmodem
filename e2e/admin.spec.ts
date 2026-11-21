// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin panel v0 (M2 slice 8). CI gives the demo board's Admin a password through
// `postmodem user set-password` and passes it as PM_ADMIN_PASSWORD; without it these skip.
// Nothing here bans or resets a demo member (other specs sign in as them in parallel).
import { isIP } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { ESSENTIALS, expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const ADMIN_PASSWORD = process.env.PM_ADMIN_PASSWORD;
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

async function asAdmin(page: Page, path: string) {
  await signIn(page, "Admin", ADMIN_PASSWORD!);
  await page.goto(path);
}

test("guests sign in first and members without admin rights get a 403", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\.php\?redirect=%2Fadmin/);
  expect((await page.request.get("/admin/client-address", { maxRedirects: 0 })).status()).toBe(303);
  await signIn(page, "retro_fan", "postmodem-demo");
  await expect(page.locator(".site-header").getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  expect((await page.goto("/admin/settings"))?.status()).toBe(403);
  expect((await page.request.get("/admin/client-address")).status()).toBe(403);
});

test.describe("as the administrator", () => {
  test.skip(!ADMIN_PASSWORD, "needs PM_ADMIN_PASSWORD (CI sets the demo Admin's password)");

  test("the address diagnostic reports the board's resolved address", async ({ page }) => {
    await asAdmin(page, "/admin");
    const normal = await page.request.get("/admin/client-address");
    expect(normal.ok()).toBe(true);
    expect(normal.headers()["cache-control"]).toBe("no-store");
    const address = (await normal.text()).trim();
    expect(isIP(address)).toBeGreaterThan(0);

    const forwarded = await page.request.get("/admin/client-address", {
      headers: { "x-forwarded-for": "192.0.2.17", "x-postmodem-client-address": "192.0.2.18" },
    });
    expect((await forwarded.text()).trim()).toBe(address);
  });

  test("overview, settings and the audit log", async ({ page }) => {
    await asAdmin(page, "/");
    await page.locator(".site-header").getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Admin panel");
    await expectNoAxeViolations(page);

    await page
      .getByRole("navigation", { name: "Admin sections" })
      .getByRole("link", { name: "Board settings" })
      .click();
    await expectNoAxeViolations(page);
    const description = page.getByLabel("Description");
    const before = await description.inputValue();
    await description.fill(`Opis ${unique()}`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await page.getByLabel("Posts per member and hour (0: no limit)").fill("-5");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto("/admin/settings");
    await page.getByLabel("Description").fill(before);
    await page.getByRole("button", { name: "Save" }).click();

    await page.goto("/admin/audit");
    await expect(page.locator("table.audit")).toContainText("settings.changed");
    await expectNoAxeViolations(page);
  });

  test("forums: create, rename and delete an empty one", async ({ page }) => {
    const title = `Testowe ${unique()}`;
    await asAdmin(page, "/admin/forums");
    await expectNoAxeViolations(page);
    const create = page.locator("form[action='?/create']");
    await create.getByLabel("Title").fill(title);
    await create.getByLabel("Inside").selectOption({ label: "Ogólne" });
    await create.getByRole("button", { name: "Create" }).click();
    // Rows by their summary line: every row's "Inside" list names every forum.
    const row = (text: string) =>
      page.locator(".admin-tree > li").filter({ has: page.locator("summary", { hasText: text }) });
    const item = row(title);
    await expect(item).toBeVisible();
    await item.locator("summary").click();
    await item.getByLabel("Title").fill(`${title} (zmienione)`);
    await item.getByRole("button", { name: "Save" }).click();
    const renamed = row(`${title} (zmienione)`);
    await renamed.locator("summary").click();
    await renamed.getByRole("button", { name: "Delete (only when empty)" }).click();
    await expect(row(title)).toHaveCount(0);
    // A forum with topics refuses.
    const hydepark = row("Hydepark");
    await hydepark.locator("summary").click();
    await hydepark.getByRole("button", { name: "Delete (only when empty)" }).click();
    await expect(page.getByRole("alert")).toContainText("Only empty forums");
  });

  test("groups and permissions, with the simulator", async ({ page }) => {
    const group = `Testerzy ${unique()}`;
    await asAdmin(page, "/admin/groups");
    await expectNoAxeViolations(page);
    const create = page.locator("form[action='?/create']");
    await create.getByLabel("Name").fill(group);
    await create.getByRole("button", { name: "Create" }).click();
    const section = page.getByRole("region", { name: group });
    await section.getByLabel("Add a member (username)").fill("retro_fan");
    await section.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("region", { name: group })).toContainText("retro_fan");
    await page
      .getByRole("region", { name: group })
      .getByRole("button", { name: `Remove retro_fan from ${group}` })
      .click();
    await expect(page.getByRole("region", { name: group })).toContainText("No members.");

    await page.goto("/admin/permissions?who=guest&cap=node.read&node=9");
    await expect(page.getByRole("status")).toContainText("Not allowed");
    await expectNoAxeViolations(page);
    await page.goto("/admin/permissions?who=Ola&cap=node.read&node=9");
    await expect(page.getByRole("status")).toContainText("Allowed");
  });

  test("bans and invites", async ({ page }) => {
    await asAdmin(page, "/admin/access");
    await expectNoAxeViolations(page);
    // 203.0.113.* is a documentation range: no test client has it.
    const ban = page.locator("form[action='?/ban']");
    await ban.getByLabel("Address or pattern").fill("not an ip!");
    await ban.getByRole("button", { name: "Ban" }).click();
    await expect(page.getByRole("alert")).toHaveText("That isn't a valid IP or e-mail pattern.");
    const pattern = `203.0.113.${Math.floor(Math.random() * 250)}`;
    await page.locator("form[action='?/ban']").getByLabel("Address or pattern").fill(pattern);
    await page.locator("form[action='?/ban']").getByRole("button", { name: "Ban" }).click();
    await page.getByRole("button", { name: `Remove the ban on ${pattern}` }).click();
    await expect(page.getByRole("button", { name: `Remove the ban on ${pattern}` })).toHaveCount(0);

    await page.locator("form[action='?/invite']").getByLabel("Note (for you)").fill("e2e");
    await page.locator("form[action='?/invite']").getByRole("button", { name: "Create" }).click();
    await expect(page.locator(".invite-link")).toContainText("/register?invite=");
  });

  test("members and packages", async ({ page }) => {
    await asAdmin(page, "/admin/users?q=retro_fan");
    await expect(page.getByRole("region", { name: "retro_fan" })).toContainText("active");
    await expectNoAxeViolations(page);
    // An admin can't ban themselves.
    await page.goto("/admin/users?q=Admin");
    await page.getByRole("region", { name: "Admin" }).getByRole("button", { name: "Ban" }).click();
    await expect(page.getByRole("alert")).toHaveText("You can't ban yourself.");

    await page.goto("/admin/packages");
    await expect(page.getByRole("checkbox", { name: /Reports/ })).toBeChecked({ checked: ESSENTIALS });
    await expectNoAxeViolations(page);
  });
});
