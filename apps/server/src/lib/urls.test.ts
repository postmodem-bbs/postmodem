// SPDX-License-Identifier: AGPL-3.0-or-later
import { URL_STYLES } from "@postmodem/core";
import { describe, expect, it } from "vitest";
import { internalPath, makeUrls, parseRef, requestedStart } from "./urls.ts";

const forum = { id: 7, slug: "sprzet", kind: "forum" as const };
const category = { id: 31, slug: "ogolne", kind: "category" as const, classicId: 3 };
const topic = { id: 123, slug: "moj-nowy-pc-123" }; // imported: the id is part of the slug
const user = { id: 42, slug: "lukasz-zolc" };
const at = (path: string) => internalPath(new URL(path, "http://board.test"));

describe("urls service (ADR 0012)", () => {
  it("classic: byte-for-byte phpBB2", () => {
    const u = makeUrls("classic");
    expect(u.forum(forum)).toBe("/viewforum.php?f=7");
    expect(u.forum(forum, 50)).toBe("/viewforum.php?f=7&start=50");
    expect(u.topic(topic, 30)).toBe("/viewtopic.php?t=123&start=30");
    expect(u.post(4567)).toBe("/viewtopic.php?p=4567#p4567");
    expect(u.postOnPage(topic, 15, 4567)).toBe("/viewtopic.php?t=123&start=15#p4567");
    expect(u.category(category)).toBe("/index.php?c=3");
    expect(u.user(user)).toBe("/profile.php?mode=viewprofile&u=42");
    // No usable classic number: falls back to the numbered form rather than a wrong category.
    expect(u.category({ ...category, classicId: null })).toBe("/c/31-ogolne");
  });

  it("numbered: id first, readable slug after, pages not offsets", () => {
    const u = makeUrls("numbered");
    expect(u.forum(forum, 50)).toBe("/f/7-sprzet?page=3");
    expect(u.topic(topic)).toBe("/t/123-moj-nowy-pc");
    expect(u.topic(topic, 30)).toBe("/t/123-moj-nowy-pc?page=3");
    expect(u.topic({ id: 5, slug: "topic-5" })).toBe("/t/5-topic");
    expect(u.category(category)).toBe("/c/31-ogolne");
    expect(u.user(user)).toBe("/u/42-lukasz-zolc");
    expect(u.post(4567)).toBe("/p/4567");
  });

  it("slug: names only", () => {
    const u = makeUrls("slug");
    expect(u.forum(forum, 25)).toBe("/forum/sprzet?page=2");
    expect(u.topic(topic)).toBe("/topic/moj-nowy-pc-123");
    expect(u.category(category)).toBe("/category/ogolne");
    expect(u.node(category)).toBe("/category/ogolne");
    expect(u.node(forum)).toBe("/forum/sprzet");
    expect(u.user(user)).toBe("/user/lukasz-zolc");
  });

  it("every style's links map back onto the internal routes", () => {
    for (const style of URL_STYLES) {
      const u = makeUrls(style);
      const ref = style === "slug" ? "~" : "";
      expect(at(u.forum(forum, 50)), style).toBe(`/-/forum/${ref ? "~sprzet" : 7}`);
      expect(at(u.topic(topic, 30)), style).toBe(`/-/topic/${ref ? "~moj-nowy-pc-123" : 123}`);
      expect(at(u.user(user)), style).toBe(`/-/user/${ref ? "~lukasz-zolc" : 42}`);
      expect(at(u.post(9)), style).toBe("/-/post/9");
    }
    expect(at("/index.php?c=3")).toBe("/-/category/@3");
    expect(at("/c/31-ogolne")).toBe("/-/category/31");
    expect(at("/category/ogolne")).toBe("/-/category/~ogolne");
  });

  it("leaves everything else alone", () => {
    expect(at("/index.php")).toBe("/");
    expect(at("/viewtopic.php")).toBeUndefined();
    expect(at("/viewtopic.php?t=abc")).toBeUndefined();
    expect(at("/viewtopic.php?t=0")).toBeUndefined();
    expect(at("/profile.php?mode=register")).toBeUndefined();
    expect(at("/t/x-123")).toBeUndefined();
    expect(at("/topic/Not_A_Slug")).toBeUndefined();
    expect(at("/login.php")).toBeUndefined();
    expect(at("/")).toBeUndefined();
  });

  it("parses refs and both pagination forms", () => {
    expect(parseRef("123")).toEqual({ id: 123 });
    expect(parseRef("~moj-pc")).toEqual({ slug: "moj-pc" });
    expect(parseRef("@3")).toEqual({ classicId: 3 });
    expect(parseRef("12a")).toBeNull();
    expect(parseRef("~")).toBeNull();
    const q = (s: string) => new URLSearchParams(s);
    expect(requestedStart(q("start=30"), 15)).toBe(30);
    expect(requestedStart(q("page=3"), 15)).toBe(30);
    expect(requestedStart(q("page=1"), 15)).toBe(0);
    expect(requestedStart(q("start=-4"), 15)).toBe(0);
    expect(requestedStart(q(""), 15)).toBe(0);
  });
});
