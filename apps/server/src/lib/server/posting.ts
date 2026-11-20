// SPDX-License-Identifier: AGPL-3.0-or-later
// Helpers for posting.php that aren't rules (those are in @postmodem/core posting.ts).

/** Quoting copies the source, minus [hide] blocks: quoting must not reveal hidden content. */
export function quoteSource(author: string, source: string): string {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (const match of source.matchAll(/\[(\/?)hide(?:=[^\]\n]*)?\]/gi)) {
    if (match[1]) {
      if (depth > 0 && --depth === 0) start = match.index + match[0].length;
    } else if (depth++ === 0) {
      parts.push(source.slice(start, match.index));
    }
  }
  if (depth === 0) parts.push(source.slice(start));
  const body = parts.join("").trim();
  const name = author.replace(/["\]]/g, "");
  return `[quote="${name}"]${body}[/quote]\n`;
}
