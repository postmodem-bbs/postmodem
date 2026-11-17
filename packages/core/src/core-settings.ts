// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings owned by the core itself.
import { z } from "zod";
import { defineSetting, SettingsRegistry } from "./settings.ts";

export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];

export const boardName = defineSetting({
  key: "core.board.name",
  schema: z.string().trim().min(1).max(80),
  default: "Postmodem",
});

export const boardDescription = defineSetting({
  key: "core.board.description",
  schema: z.string().trim().max(300),
  default: "",
});

export const defaultLocale = defineSetting<Locale>({
  key: "core.board.defaultLocale",
  schema: z.enum(LOCALES),
  default: "en",
});

export function coreSettings(): SettingsRegistry {
  return new SettingsRegistry().register(boardName, boardDescription, defaultLocale);
}
