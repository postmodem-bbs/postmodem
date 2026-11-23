// SPDX-License-Identifier: AGPL-3.0-or-later
// Avatars (#131): limits, storage, links and the gallery.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  avatarForExport,
  avatarGallery,
  fetchAvatar,
  galleryAvatar,
  isPrivateAddress,
  releaseAvatar,
  storeAvatar,
} from "./avatars.ts";
import { type AppContext, createContext } from "./bootstrap.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures/images", name)));
const LIMITS = { maxBytes: 64 * 1024, maxWidth: 512, maxHeight: 512 };
const tmp = () => mkdtempSync(join(tmpdir(), "pm-avatars-"));

describe("storeAvatar", () => {
  it("refuses what is over the limits, as phpBB2 did, and stores the rest without metadata", async () => {
    const dir = tmp();
    expect(await storeAvatar(dir, fixture("exif-600x400.jpg"), LIMITS)).toEqual({ problem: "dimensions" });
    expect(await storeAvatar(dir, fixture("text-64x48.png"), { ...LIMITS, maxBytes: 100 })).toEqual({
      problem: "large",
    });
    expect(await storeAvatar(dir, new TextEncoder().encode("<svg/>"), LIMITS)).toEqual({ problem: "type" });
    expect(await storeAvatar(dir, new Uint8Array(), LIMITS)).toEqual({ problem: "empty" });

    const big = { ...LIMITS, maxWidth: 600, maxHeight: 400 };
    const stored = await storeAvatar(dir, fixture("exif-600x400.jpg"), big);
    expect(stored).toEqual({ avatar: expect.stringMatching(/^upload\/[0-9a-f]{32}\.jpg$/) });
    const path = "avatar" in stored ? stored.avatar : "";
    const saved = readFileSync(join(dir, "uploads/avatars", path)).toString("latin1");
    expect(saved.toLowerCase()).not.toContain("secret");
    // The same image again is the same file.
    expect(await storeAvatar(dir, fixture("exif-600x400.jpg"), big)).toEqual(stored);
  });

  it("names gallery images after their file, which describes them there", async () => {
    const dir = tmp();
    const gif = fixture("anim-32x32.gif");
    expect(await storeAvatar(dir, gif, LIMITS, "gallery/zwierzaki", "Kot rudy!.gif")).toEqual({
      avatar: "gallery/zwierzaki/Kot-rudy.gif",
    });
    expect(await storeAvatar(dir, gif, LIMITS, "gallery/zwierzaki", "Kot rudy!.gif")).toEqual({
      avatar: "gallery/zwierzaki/Kot-rudy-2.gif",
    });
    // The extension comes from the content, never from the name.
    expect(await storeAvatar(dir, gif, LIMITS, "gallery/zwierzaki", "kot.php")).toEqual({
      avatar: "gallery/zwierzaki/kot.gif",
    });
  });

  it("counts the stored file, not the metadata a camera added", async () => {
    const original = fixture("exif-600x400.jpg");
    const stored = await storeAvatar(tmp(), original, {
      maxBytes: original.length - 20,
      maxWidth: 600,
      maxHeight: 400,
    });
    expect(stored).toHaveProperty("avatar");
  });
});

describe("releaseAvatar and the export", () => {
  const saved = { ...process.env };
  let ctx: AppContext | undefined;
  afterEach(async () => {
    await ctx?.db.close();
    ctx = undefined;
    process.env = { ...saved };
  });

  it("removes an uploaded file once no member uses it", async () => {
    const dir = tmp();
    process.env.POSTMODEM_DATA_DIR = dir;
    process.env.POSTMODEM_LOG_LEVEL = "error";
    ctx = await createContext({ migrate: true });
    const { repos } = ctx.db;
    const stored = await storeAvatar(dir, fixture("text-64x48.png"), LIMITS);
    const avatar = "avatar" in stored ? stored.avatar : "";
    const file = join(dir, "uploads/avatars", avatar);
    const ola = await repos.users.create({ username: "Ola", email: null, avatar });
    await repos.users.create({ username: "Bob", email: null, avatar });

    const exported = await avatarForExport(dir, avatar);
    expect(exported).toMatchObject({ source: "upload", value: avatar });
    expect(exported?.image).toMatch(/^data:image\/png;base64,/);
    expect(await avatarForExport(dir, "gallery/zwierzaki/kot.gif")).toEqual({
      source: "gallery",
      value: "gallery/zwierzaki/kot.gif",
    });

    await repos.users.update(ola.id, { avatar: null });
    await releaseAvatar(dir, repos, avatar);
    expect(existsSync(file)).toBe(true); // Bob still uses it
    expect(await repos.users.clearAvatar(avatar)).toBe(1);
    await releaseAvatar(dir, repos, avatar);
    expect(existsSync(file)).toBe(false);
  });
});

describe("links", () => {
  it("knows which addresses are private", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
    ])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "64:ff9b::a00:1"])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"])
      expect(isPrivateAddress(a), a).toBe(false);
  });

  let server: Server;
  let base = "";
  const png = fixture("text-64x48.png");
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/a.png") res.writeHead(200, { "content-type": "image/png" }).end(png);
      else if (req.url === "/moved") res.writeHead(302, { location: "/a.png" }).end();
      else if (req.url === "/loop") res.writeHead(302, { location: "/loop" }).end();
      else if (req.url === "/huge") res.writeHead(200).end(Buffer.alloc(300 * 1024));
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("never reaches this machine or a private network", async () => {
    expect(await fetchAvatar(`${base}/a.png`, 64 * 1024)).toEqual({ problem: "address" });
    expect(await fetchAvatar(`http://localhost:${new URL(base).port}/a.png`, 64 * 1024)).toEqual({
      problem: "address",
    });
    expect(await fetchAvatar("file:///etc/passwd", 64 * 1024)).toEqual({ problem: "fetch" });
    expect(await fetchAvatar(`http://user:pw@example.org/a.png`, 64 * 1024)).toEqual({ problem: "fetch" });
  });

  it("downloads an image, following a few redirects, within the size limit", async () => {
    const open = { allowPrivate: true }; // the test server is local
    expect(await fetchAvatar(`${base}/a.png`, 64 * 1024, open)).toEqual({ bytes: png });
    expect(await fetchAvatar(`${base}/moved`, 64 * 1024, open)).toEqual({ bytes: png });
    expect(await fetchAvatar(`${base}/loop`, 64 * 1024, open)).toEqual({ problem: "fetch" });
    expect(await fetchAvatar(`${base}/missing`, 64 * 1024, open)).toEqual({ problem: "fetch" });
    expect(await fetchAvatar(`${base}/huge`, 64 * 1024, open)).toEqual({ problem: "large" });
  });
});

describe("gallery", () => {
  it("lists categories and checks a choice is really in it", async () => {
    const dir = tmp();
    const root = join(dir, "uploads/avatars/gallery");
    mkdirSync(join(root, "zwierzaki"), { recursive: true });
    mkdirSync(join(root, "puste"), { recursive: true });
    writeFileSync(join(root, "zwierzaki/kot.gif"), fixture("anim-32x32.gif"));
    writeFileSync(join(root, "zwierzaki/notes.txt"), "not an image");
    expect(await avatarGallery(dir)).toEqual([{ category: "zwierzaki", images: ["kot.gif"] }]);
    expect(await galleryAvatar(dir, "zwierzaki/kot.gif")).toBe("gallery/zwierzaki/kot.gif");
    expect(await galleryAvatar(dir, "zwierzaki/pies.gif")).toBeNull();
    expect(await galleryAvatar(dir, "zwierzaki/notes.txt")).toBeNull();
    expect(await galleryAvatar(dir, "../../../db/postmodem.sqlite")).toBeNull();
    expect(await galleryAvatar(dir, "zwierzaki/../../upload/x.png")).toBeNull();
  });
});
