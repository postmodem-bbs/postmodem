// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Permissions } from "@postmodem/core";
import type { SupportedLocale } from "@postmodem/i18n";
import type { AppContext } from "#lib/server/bootstrap.ts";

declare global {
  namespace App {
    interface Locals {
      ctx: AppContext;
      /** What the current viewer may do (a guest until accounts land in slice 4). */
      perms: Permissions;
      locale: SupportedLocale;
      theme: "light" | "dark" | "system";
    }
  }
}
