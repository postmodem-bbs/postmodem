// SPDX-License-Identifier: AGPL-3.0-or-later
// Theme layer 1 (DESIGN.md §7): design tokens → CSS custom properties.
// A theme can be nothing but a token file; light/dark variants per theme.

export const COLOR_TOKENS = [
  "bg",
  "surface",
  "surfaceAlt",
  "text",
  "textMuted",
  "link",
  "linkHover",
  "border",
  "headerBg",
  "headerText",
  "focus",
  /** Error messages and invalid-field markers. */
  "danger",
  /** Checked checkboxes and radio buttons (`accent-color`); 3:1 against the control background. */
  "accent",
  /** Background of text inputs, selects, textareas and secondary buttons. */
  "controlBg",
  /** Boundary of form controls; 3:1 against what surrounds them (WCAG 1.4.11). */
  "controlBorder",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type Palette = Record<ColorToken, string>;

/** phpBB2's BBCode colour names; every theme supplies readable values for both variants. */
export const BB_COLORS = [
  "darkred",
  "red",
  "orange",
  "brown",
  "yellow",
  "green",
  "olive",
  "cyan",
  "blue",
  "darkblue",
  "indigo",
  "violet",
  "gray",
] as const;
export type BbColor = (typeof BB_COLORS)[number];

export interface Theme {
  id: string;
  name: string;
  light: Palette;
  dark: Palette;
  /** Post-content colours ([color=…]), per variant. */
  bbColors: { light: Record<BbColor, string>; dark: Record<BbColor, string> };
  fonts: { body: string; mono: string };
  /** Base font size in px; Przemo-era boards used 11px, we don't. */
  baseSize: number;
  radius: string;
  density: "compact" | "comfortable";
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const vars = (p: Palette, bb: Record<BbColor, string>) =>
  [
    ...COLOR_TOKENS.map((k) => `  --pm-color-${kebab(k)}: ${p[k]};`),
    ...BB_COLORS.map((c) => `  --pm-bb-${c}: ${bb[c]};`),
  ].join("\n");

/** CSS for a theme. Dark applies via OS preference unless the reader picked light, or via data-theme="dark". */
export function themeCss(t: Theme): string {
  const space = t.density === "compact" ? [2, 4, 8, 12] : [4, 8, 12, 20];
  return `/* Postmodem theme: ${t.name} (generated from tokens) */
:root {
${vars(t.light, t.bbColors.light)}
  --pm-font-body: ${t.fonts.body};
  --pm-font-mono: ${t.fonts.mono};
  --pm-font-size: ${t.baseSize}px;
  --pm-radius: ${t.radius};
${space.map((s, i) => `  --pm-space-${i + 1}: ${s}px;`).join("\n")}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${vars(t.dark, t.bbColors.dark).replace(/^ {2}/gm, "    ")}
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
${vars(t.dark, t.bbColors.dark)}
  color-scheme: dark;
}
`;
}
