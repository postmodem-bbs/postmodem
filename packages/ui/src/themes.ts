// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Theme } from "./tokens.ts";

/** "Classic": an homage to subSilver's palette and density, with accessible contrast and sizes. */
export const classic: Theme = {
  id: "classic",
  name: "Classic",
  light: {
    bg: "#e5e5e5",
    surface: "#ffffff",
    surfaceAlt: "#eff1f3",
    text: "#1a1a1a",
    textMuted: "#4a5560",
    link: "#006699",
    linkHover: "#9a4a00",
    border: "#98aab1",
    headerBg: "#006699",
    headerText: "#ffffff",
    focus: "#9a4a00",
  },
  dark: {
    bg: "#12161a",
    surface: "#1c2329",
    surfaceAlt: "#232c33",
    text: "#e8ecef",
    textMuted: "#a9b4bd",
    link: "#6cb8e6",
    linkHover: "#f0a35e",
    border: "#3a4a55",
    headerBg: "#0e3a52",
    headerText: "#ffffff",
    focus: "#f0a35e",
  },
  fonts: {
    body: 'Verdana, "DejaVu Sans", "Segoe UI", system-ui, sans-serif',
    mono: '"DejaVu Sans Mono", ui-monospace, Menlo, Consolas, monospace',
  },
  baseSize: 15,
  radius: "2px",
  density: "compact",
};

export const THEMES: Record<string, Theme> = { classic };
