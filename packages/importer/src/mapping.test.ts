// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from "vitest";
import { legacyAvatar, legacyMessageView, legacyRankImage, postSubject, safeRelativePath } from "./przemo.ts";

it("keeps a post's own subject and drops ones that only repeat the topic title", () => {
  expect(postSubject("", "Nowy komputer")).toBe("");
  expect(postSubject("Nowy komputer", "Nowy komputer")).toBe("");
  expect(postSubject("Re: nowy komputer", "Nowy komputer")).toBe("");
  expect(postSubject("RE: Re: Nowy komputer ", "Nowy komputer")).toBe("");
  expect(postSubject("Zasilacz też wymieniłem", "Nowy komputer")).toBe("Zasilacz też wymieniłem");
});

it("maps phpBB2 avatars and refuses paths that could leave the avatar directory", () => {
  expect(legacyAvatar(1, "123456.jpg")).toBe("upload/123456.jpg");
  expect(legacyAvatar(3, "zwierzaki/kot.gif")).toBe("gallery/zwierzaki/kot.gif");
  expect(legacyAvatar(2, "https://example.org/a.png")).toBe("https://example.org/a.png");
  expect(legacyAvatar(2, "http://example.org/a.png")).toBeNull();
  expect(legacyAvatar(2, 'https://x.org/a.png" onerror="x')).toBeNull();
  expect(legacyAvatar(0, "a.gif")).toBeNull();
  for (const bad of ["../config.php", "a/../../b", "/etc/passwd", "a\\..\\b", "", "a//b", "x\u0000.gif"])
    expect(legacyAvatar(1, bad), bad).toBeNull();
  expect(safeRelativePath("icon_smile.gif")).toBe(true);
});

it("maps phpBB2's private message types to who still sees each row", () => {
  expect(legacyMessageView(1)).toEqual({ sender: true, recipient: true, read: false });
  expect(legacyMessageView(5)).toEqual({ sender: true, recipient: true, read: false });
  expect(legacyMessageView(0)).toEqual({ sender: false, recipient: true, read: true });
  expect(legacyMessageView(3)).toEqual({ sender: false, recipient: true, read: true });
  expect(legacyMessageView(2)).toEqual({ sender: true, recipient: false, read: true });
  expect(legacyMessageView(4)).toEqual({ sender: true, recipient: false, read: true });
  expect(legacyMessageView(9)).toBeNull();
});

it("rank images keep their path under uploads/ranks, or an https URL (#130)", () => {
  expect(legacyRankImage("images/ranks/star.gif")).toBe("images/ranks/star.gif");
  expect(legacyRankImage("https://example.org/r.png")).toBe("https://example.org/r.png");
  expect(legacyRankImage("http://example.org/r.png")).toBeNull();
  expect(legacyRankImage("../config.php")).toBeNull();
  expect(legacyRankImage("/etc/passwd")).toBeNull();
  expect(legacyRankImage("")).toBeNull();
});
