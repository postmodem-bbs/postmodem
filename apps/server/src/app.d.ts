// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Permissions, PreferenceView, RequestContext, Session, User } from "@postmodem/core";
import type { SupportedLocale } from "@postmodem/i18n";
import type { AppContext } from "#lib/server/bootstrap.ts";
import type { Urls } from "#lib/urls.ts";

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
      requestContext: RequestContext;
      theme: "light" | "dark" | "system";
      /** The reader's preferences (platform service): stored for members, a cookie for guests. */
      prefs: PreferenceView;
      /** Link builder in the board's URL style (ADR 0012). */
      urls: Urls;
    }
  }
}
