// SPDX-License-Identifier: AGPL-3.0-or-later
// Private messages, topic watching and account settings (M2 slice 5). E-mails are covered by
// the core and server tests; here, what members see.
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, guardCsp, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const PASSWORD = "postmodem-demo";
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

test("a private message arrives, is read, and gets a reply that quotes it", async ({ browser }) => {
  const subject = `Spotkanie ${unique()}`;
  const fan = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(fan, "retro_fan", PASSWORD);
  await fan
    .locator(".site-header")
    .getByRole("link", { name: /Messages/ })
    .click();
  await fan.getByRole("link", { name: "New message" }).click();
  await fan.getByLabel("To").fill("nobody-here");
  await fan.getByLabel("Subject").fill(subject);
  await fan.getByLabel("Message").fill("Hej [b]Ola[/b]!");
  await fan.getByRole("button", { name: "Send" }).click();
  await expect(fan.getByRole("alert")).toHaveText("There's no member with that name.");
  await fan.getByLabel("To").fill("Ola");
  await fan.getByRole("button", { name: "Send" }).click();
  await expect(fan.getByRole("status")).toHaveText("Message sent.");
  await expect(fan.getByRole("row", { name: new RegExp(subject) })).toContainText("not read yet");

  const ola = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(ola, "Ola", PASSWORD);
  await expect(
    ola
      .locator(".site-header")
      .getByRole("link", { name: /Messages/ })
      .locator(".count"),
  ).toBeVisible();
  await ola
    .locator(".site-header")
    .getByRole("link", { name: /Messages/ })
    .click();
  await expectNoAxeViolations(ola);
  await ola.getByRole("link", { name: subject }).click();
  await expect(ola.locator(".pm-message strong", { hasText: "Ola" }).first()).toBeVisible();
  await expectNoAxeViolations(ola);
  await ola.getByRole("link", { name: "Reply" }).click();
  await expect(ola.getByLabel("To")).toHaveValue("retro_fan");
  await expect(ola.getByLabel("Subject")).toHaveValue(`Re: ${subject}`);
  await expect(ola.getByLabel("Message")).toHaveValue(/^\[quote="retro_fan"\]Hej/);
  await ola.getByRole("button", { name: "Send" }).click();
  await expect(ola.getByRole("status")).toHaveText("Message sent.");

  await fan.goto("/privmsg.php?folder=inbox");
  await expect(fan.getByRole("link", { name: `Re: ${subject}` })).toBeVisible();
  await fan.goto("/privmsg.php?folder=sent");
  await expect(fan.getByRole("row", { name: new RegExp(`^${subject}`) })).not.toContainText("not read yet");
});

test("members watch and stop watching a topic", async ({ page }) => {
  await signIn(page, "Łukasz Żółć", PASSWORD);
  await page.goto("/viewtopic.php?t=1");
  const toggle = page.locator(".topic-actions").first();
  const watching = await toggle.getByRole("button", { name: "Stop watching" }).count();
  if (watching) await toggle.getByRole("button", { name: "Stop watching" }).click();
  await toggle.getByRole("button", { name: "Watch this topic" }).click();
  await expect(toggle.getByRole("button", { name: "Stop watching" })).toBeVisible();
  await toggle.getByRole("button", { name: "Stop watching" }).click();
  await expect(toggle.getByRole("button", { name: "Watch this topic" })).toBeVisible();
});

test("account settings save the profile and refuse a wrong current password", async ({ page }) => {
  await signIn(page, "Ola", PASSWORD);
  await page
    .locator(".site-header")
    .getByRole("link", { name: /Signed in as Ola/ })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your account");
  await expectNoAxeViolations(page);
  const sig = `Pozdrawiam, Ola ${unique()}`;
  const profile = page.locator("form[action='?/profile']");
  await page.getByLabel("Website").fill("not a link");
  await profile.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#website-error")).toHaveText("Enter a full link, starting with https://");
  await page.getByLabel("Website").fill("https://example.org");
  await page.getByLabel("Signature").fill(`[i]${sig}[/i]`);
  await profile.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved.");
  await expect(page.locator(".signature-preview em")).toHaveText(sig);
  // Her signature now shows under her posts.
  await page.goto("/viewforum.php?f=9");
  await page.getByRole("link", { name: "Zgłoszenia do przejrzenia" }).click();
  await expect(page.locator(".post-signature em").first()).toHaveText(sig);

  await page.goto("/account");
  const change = page.locator("form[action='?/password']");
  await change.getByLabel("Current password").fill("not the password");
  await change.getByLabel("New password").fill("a brand new passphrase");
  await change.getByRole("button", { name: "Change password" }).click();
  await expect(page.locator("#current-error")).toHaveText("That's not your current password.");
});
