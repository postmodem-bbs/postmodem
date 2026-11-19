// SPDX-License-Identifier: AGPL-3.0-or-later
// Live updates (M2b slice 10): an open page hears about new replies, new private messages
// and changes to the reports queue, without reloading. Two browsers, two people.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { guardCsp, signIn } from "./helpers.ts";

guardCsp();
test.use({ locale: "en-US" });

const PASSWORD = "postmodem-demo";
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

async function person(browser: Browser, login: string): Promise<Page> {
  const page = await (await browser.newContext({ locale: "en-US" })).newPage();
  await signIn(page, login, PASSWORD);
  return page;
}

/** Waits until the page's live stream is open, so nothing published before it is missed. */
async function streaming(page: Page) {
  await page.waitForResponse((r) => r.url().includes("/x/stream"));
}

test("a reader sees replies posted while the topic is open, as a link", async ({ page, browser }) => {
  const author = await person(browser, "Łukasz Żółć");
  await author.goto("/viewforum.php?f=6");
  await author.getByRole("link", { name: "New topic" }).first().click();
  await author.getByLabel("Topic title").fill(`Na żywo ${unique()}`);
  await author.getByLabel("Message").fill("Pierwszy post.");
  await author.getByRole("button", { name: "Post" }).click();
  await author.waitForURL(/#p\d+$|[?&]p=\d+/);

  // A guest reads the topic.
  const stream = streaming(page);
  await page.goto(author.url());
  await stream;
  const notice = page.getByRole("status").filter({ hasText: "new repl" });
  await expect(notice).toHaveCount(0);

  const box = author.locator(".slot-quick-reply");
  await box.getByLabel("Message").fill("Druga wiadomość, na żywo.");
  await box.getByRole("button", { name: "Post" }).click();
  await author.waitForURL(/#p\d+$|[?&]p=\d+/);

  await expect(notice).toHaveText(/1 new reply since you opened this page/);
  await notice.getByRole("link").click();
  await expect(page.locator("article.post").last()).toContainText("Druga wiadomość, na żywo.");
  await author.context().close();
});

test("the header counts private messages as they arrive", async ({ page, browser }) => {
  await signIn(page, "retro_fan", PASSWORD);
  const stream = streaming(page);
  await page.goto("/");
  await stream;
  const messages = page.getByRole("link", { name: /^Messages/ });
  const before = Number((await messages.innerText()).replace(/\D/g, "") || 0);

  const sender = await person(browser, "Łukasz Żółć");
  await sender.goto("/privmsg.php?mode=post");
  await sender.getByLabel("To").fill("retro_fan");
  await sender.getByLabel("Subject").fill(`Na żywo ${unique()}`);
  await sender.getByLabel("Message").fill("Ta wiadomość dochodzi bez przeładowania.");
  await sender.getByRole("button", { name: "Send" }).click();
  await sender.waitForURL(/folder=sent/);

  await expect(messages).toHaveText(new RegExp(`Messages\\s*${before + 1}$`));
  await sender.context().close();
});
