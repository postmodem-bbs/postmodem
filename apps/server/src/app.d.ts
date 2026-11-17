// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Permissions, Session, User } from "@postmodem/core";
import type { SupportedLocale } from "@postmodem/i18n";
import type { AppContext } from "#lib/server/bootstrap.ts";

declare global {
  namespace App {
    interface Locals {
      ctx: AppContext;
      /** The signed-in user and their session, or null for guests. */
      user: User | null;
      session: Session | null;
      /** What the current viewer may do. */
      perms: Permissions;
      locale: SupportedLocale;
      theme: "light" | "dark" | "system";
    }
  }
}
