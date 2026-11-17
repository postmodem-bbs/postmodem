// SPDX-License-Identifier: AGPL-3.0-or-later
// Every shipped theme must meet WCAG 2.2 AA contrast in both light and dark variants.
import { describe, expect, it } from "vitest";
import { contrast } from "./contrast.ts";
import { THEMES } from "./themes.ts";
import { BB_COLORS, type ColorToken, themeCss } from "./tokens.ts";

const TEXT_PAIRS: [ColorToken, ColorToken][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surfaceAlt"],
  ["textMuted", "surface"],
  ["textMuted", "surfaceAlt"],
  ["link", "surface"],
  ["link", "surfaceAlt"],
  ["linkHover", "surface"],
  ["headerText", "headerBg"],
  ["danger", "surface"],
  ["danger", "bg"],
];
// Non-text UI (focus ring, borders that convey state) needs 3:1.
const UI_PAIRS: [ColorToken, ColorToken][] = [
  ["focus", "bg"],
  ["focus", "surface"],
];

describe.each(Object.values(THEMES))("theme $name", (theme) => {
  for (const variant of ["light", "dark"] as const) {
    it(`${variant}: text pairs reach 4.5:1`, () => {
      const p = theme[variant];
      const failing = TEXT_PAIRS.map(([a, b]) => ({
        pair: `${a}/${b}`,
        ratio: +contrast(p[a], p[b]).toFixed(2),
      })).filter((x) => x.ratio < 4.5);
      expect(failing).toEqual([]);
    });
    it(`${variant}: focus indicator reaches 3:1`, () => {
      const p = theme[variant];
      const failing = UI_PAIRS.map(([a, b]) => ({
        pair: `${a}/${b}`,
        ratio: +contrast(p[a], p[b]).toFixed(2),
      })).filter((x) => x.ratio < 3);
      expect(failing).toEqual([]);
    });
  }

  for (const variant of ["light", "dark"] as const) {
    it(`${variant}: every BBCode colour reaches 4.5:1 on post surfaces`, () => {
      const p = theme[variant];
      const failing = BB_COLORS.flatMap((c) =>
        (["surface", "surfaceAlt"] as const)
          .map((bg) => ({
            pair: `${c}/${bg}`,
            ratio: +contrast(theme.bbColors[variant][c], p[bg]).toFixed(2),
          }))
          .filter((x) => x.ratio < 4.5),
      );
      expect(failing).toEqual([]);
    });
  }

  it("generates CSS with light, OS-dark and forced-dark blocks", () => {
    const css = themeCss(theme);
    expect(css).toContain("--pm-color-text-muted:");
    expect(css).toContain("--pm-bb-darkred:");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
  });
});

it("computes known contrast ratios", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
});
