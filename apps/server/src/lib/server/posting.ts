// SPDX-License-Identifier: AGPL-3.0-or-later
// Helpers for posting.php that aren't rules (those are in @postmodem/core posting.ts).

/** Quoting copies the source, minus [hide] blocks: quoting must not reveal hidden content. */
export function quoteSource(author: string, source: string): string {
  const body = source.replace(/\[hide\][\s\S]*?\[\/hide\]/gi, "").trim();
  const name = author.replace(/["\]]/g, "");
  return `[quote="${name}"]${body}[/quote]\n`;
}
