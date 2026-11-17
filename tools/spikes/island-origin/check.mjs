// Drives real browsers against server.mjs (must be running on :8090) and
// reports what the island can and cannot do. This is the shape of the CI test.
import { chromium, firefox } from "playwright-core";

const browsers = [
  ["chrome", () => chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true })],
  ["firefox", () => firefox.launch({ executablePath: "/usr/bin/firefox", headless: true })],
];

for (const [name, launch] of browsers) {
  let browser;
  try { browser = await launch(); } catch (e) { console.log(`\n== ${name}: could not launch (${e.message.split("\n")[0]})`); continue; }
  const page = await browser.newPage();
  const serverHits = [];
  page.on("request", (r) => { if (r.url().includes("/api/me") || r.url().includes("example.com")) serverHits.push(r.url()); });
  await page.goto("http://localhost:8090/");
  await page.waitForTimeout(3000);
  const frame = page.frames().find((f) => f.url().includes("/x/demo/island"));
  const islandText = frame ? await frame.locator("#out").textContent() : "(no island frame)";
  const bridge = await page.locator("#bridge").textContent();
  console.log(`\n== ${name} (top url: ${page.url()})`);
  console.log(islandText.trim().split("\n").map((l) => "  island> " + l).join("\n"));
  console.log(bridge.trim().split("\n").map((l) => "  board > " + l).join("\n"));
  console.log(`  requests attempted to /api/me or example.com: ${serverHits.length ? serverHits.join(", ") : "none"}`);
  await browser.close();
}
