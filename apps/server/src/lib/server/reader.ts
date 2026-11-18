// SPDX-License-Identifier: AGPL-3.0-or-later
// Who is reading, for filling the reader-dependent holes of rendered posts ([you], [hide]).
import { translator } from "@postmodem/i18n";

export function readerOf(locals: App.Locals) {
  const t = translator(locals.locale);
  return {
    name: locals.user?.username ?? null,
    messages: { guest: t("post-guest"), hiddenContent: t("bb-hidden-content") },
  };
}
