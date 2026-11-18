// SPDX-License-Identifier: AGPL-3.0-or-later
// schema.org structured data as a <script type="application/ld+json"> block. It is data, not
// a script, so the CSP doesn't apply to it. Every "<" is escaped, so nothing inside (a topic
// title, a post excerpt) can close the element or open another one.
export function jsonLdTag(data: unknown): string {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
