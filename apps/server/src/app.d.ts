// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SupportedLocale } from "@postmodem/i18n";
import type { AppContext } from "#lib/server/bootstrap.ts";

declare global {
  namespace App {
    interface Locals {
      ctx: AppContext;
      locale: SupportedLocale;
      theme: "light" | "dark" | "system";
    }
  }
}
