// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { messageIds, negotiate, SUPPORTED, translator } from "./index.ts";

describe("i18n", () => {
  it("uses Polish plural categories (one / few / many)", () => {
    const t = translator("pl");
    expect([1, 2, 4, 5, 12, 22, 25, 112].map((count) => t("posts-count", { count }))).toEqual([
      "1 post",
      "2 posty",
      "4 posty",
      "5 postów",
      "12 postów",
      "22 posty",
      "25 postów",
      "112 postów",
    ]);
  });

  it("interpolates variables and falls back to the id for unknown messages", () => {
    const t = translator("en");
    expect(t("welcome-title", { board: "Retro Corner" })).toBe("Welcome to Retro Corner");
    expect(t("no-such-message")).toBe("no-such-message");
  });

  it("every locale defines every English message", () => {
    const en = new Set(messageIds("en"));
    for (const l of SUPPORTED)
      expect(
        [...en].filter((id) => !messageIds(l).includes(id)),
        l,
      ).toEqual([]);
  });

  it("negotiates explicit choice > Accept-Language > board default", () => {
    expect(negotiate({ acceptLanguage: "pl-PL,pl;q=0.9,en;q=0.8" })).toBe("pl");
    expect(negotiate({ requested: "en", acceptLanguage: "pl-PL" })).toBe("en");
    expect(negotiate({ acceptLanguage: "de-DE", boardDefault: "pl" })).toBe("pl");
    expect(negotiate({})).toBe("en");
  });
});
