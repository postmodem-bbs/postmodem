// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin panel v0 (M2 slice 8). CI gives the demo board's Admin a password through
// `postmodem user set-password` and passes it as PM_ADMIN_PASSWORD; without it these skip.
// Nothing here bans or resets a demo member (other specs sign in as them in parallel).
import { isIP } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { ESSENTIALS, enablePackage, expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

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
    const edit = item.locator("form[action='?/update']");
    await edit.getByLabel("Title").fill(`${title} (zmienione)`);
    await edit.getByRole("button", { name: "Save" }).click();
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

  // Saving /admin/packages stores the whole form, so two tests switching packages at once
  // can switch each other's package back off. These run one after the other (#38).
  test.describe("package switches", () => {
    test.describe.configure({ mode: "default" });

    test("trash destinations hide moderator deletes until an administrator restores them", async ({
      page,
      browser,
    }) => {
      await asAdmin(page, "/admin/packages");
      await enablePackage(page, /Trash bin/);

      await page.goto("/admin/forums");
      const suffix = unique();
      const source = `Trash source ${suffix}`;
      const destination = `Trash destination ${suffix}`;
      const row = (title: string) =>
        page.locator(".admin-tree > li").filter({
          has: page.locator("summary").getByText(title, { exact: true }),
        });
      for (const title of [source, destination]) {
        const create = page.locator("form[action='?/create']");
        await create.getByLabel("Title").fill(title);
        await create.getByRole("button", { name: "Create" }).click();
        await expect(row(title)).toBeVisible();
      }
      const sourceRow = row(source);
      await sourceRow.locator("summary").click();
      const settings = sourceRow.locator("form[action='?/trash']");
      await settings.getByLabel("Trash destination").selectOption({ label: destination });
      await settings.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("status")).toHaveText("Saved.");

      const sourceTrash = await sourceRow.locator("a[href^='/admin/forums/trash?']").getAttribute("href");
      const destinationTrash = await row(destination)
        .locator("a[href^='/admin/forums/trash?']")
        .getAttribute("href");
      const sourceId = new URL(sourceTrash!, page.url()).searchParams.get("forum")!;
      const topicTitle = `Recover this ${suffix}`;
      await page.goto(`/posting.php?mode=newtopic&f=${sourceId}`);
      await page.getByLabel("Topic title").fill(topicTitle);
      await page.getByLabel("Message").fill("This text should survive the trip.");
      await page.getByRole("button", { name: "Post" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(topicTitle);
      const topicUrl = page.url();
      await page.getByRole("link", { name: "Moderate" }).first().click();
      await page.getByRole("checkbox", { name: /delete this topic/ }).check();
      await page.getByRole("button", { name: "Delete topic" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(source);
      const guest = await browser.newContext({ javaScriptEnabled: false });
      try {
        const publicPage = await guest.newPage();
        expect((await publicPage.goto(topicUrl))?.status()).toBe(404);
      } finally {
        await guest.close();
      }

      await page.goto(destinationTrash!);
      await expectNoAxeViolations(page);
      await page.getByLabel(`Restore “${topicTitle}” to`).selectOption(sourceId);
      await page.getByRole("button", { name: "Restore topic" }).click();
      await expect(page.getByRole("status")).toHaveText("Topic restored.");
      expect((await page.goto(topicUrl))?.status()).toBe(200);
      await expect(page.getByText("This text should survive the trip.")).toBeVisible();
    });

    test("IP history records an enabled member sign-in and requires admin access", async ({
      page,
      browser,
    }) => {
      await asAdmin(page, "/admin/packages");
      await enablePackage(page, /^IP logging/);

      const member = await browser.newPage({ locale: "en-US", baseURL: new URL(page.url()).origin });
      try {
        await signIn(member, "retro_fan", "postmodem-demo");
        await page.goto("/admin/users?q=retro_fan");
        await page.getByRole("link", { name: "IP history" }).click();
        await expect(page.getByRole("row", { name: /Sign-in/ }).first()).toBeVisible();
        await expectNoAxeViolations(page);
        expect((await member.goto(page.url()))?.status()).toBe(403);
      } finally {
        await member.close();
      }
    });
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

  test("ranks: an image upload, a special rank on posts and profiles (#130)", async ({ page }) => {
    const title = `Crew ${unique()}`;
    const member = "Łukasz Żółć";
    // A 1×1 PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await asAdmin(page, "/admin/ranks");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ranks");
    await expectNoAxeViolations(page);

    const create = page.locator("form[action='?/create']");
    await create.getByLabel("Title").fill(title);
    await create.getByLabel("Special: given to members one by one").check();
    await create
      .getByLabel("Image", { exact: true })
      .setInputFiles({ name: "crew.png", mimeType: "image/png", buffer: png });
    await create.getByRole("button", { name: "Create" }).click();
    const section = page.getByRole("region", { name: title });
    await expect(section.getByRole("heading")).toContainText("special, 0 members");

    try {
      // Something that only claims to be an image is refused.
      await section.getByText("Edit", { exact: true }).click();
      await section.getByLabel("Image", { exact: true }).setInputFiles({
        name: "evil.png",
        mimeType: "image/png",
        buffer: Buffer.from("<svg onload=alert(1)>"),
      });
      await section.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("region", { name: title }).getByRole("alert")).toHaveText(
        "The image must be a PNG, GIF, JPEG or WebP file.",
      );

      const assign = page.locator("form[action='?/assign']");
      await assign.getByLabel("Member (username)").fill(member);
      await assign.getByLabel("Rank", { exact: true }).selectOption({ label: title });
      await assign.getByRole("button", { name: "Give rank" }).click();
      await expect(page.getByRole("status")).toHaveText(`${member} now has the rank ${title}.`);

      // The profile, and the author card of a topic the member started, show the rank and its image.
      await page.goto("/memberlist.php");
      await page.getByRole("link", { name: member, exact: true }).click();
      await expect(page.locator(".profile-facts .rank")).toHaveText(title);
      const image = page.locator(".profile-facts .rank img");
      const src = (await image.getAttribute("src")) ?? "";
      expect(src).toMatch(/^\/ranks\/upload\/[0-9a-f]{32}\.png$/);
      const served = await page.request.get(src);
      expect(served.headers()["content-type"]).toBe("image/png");
      await page.locator(".recent-topics a").first().click();
      await expect(page.locator(".post").first().locator(".post-author .rank")).toContainText(title);
    } finally {
      await page.goto("/admin/ranks");
      await page
        .getByRole("region", { name: title })
        .getByRole("button", { name: `Delete the rank ${title}` })
        .click();
      await expect(page.getByRole("region", { name: title })).toHaveCount(0);
    }
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
