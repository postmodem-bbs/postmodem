// SPDX-License-Identifier: AGPL-3.0-or-later
// WCAG 2.2 contrast ratio between two #rrggbb colours.
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`expected #rrggbb, got ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => channel(Number.parseInt(x!, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
