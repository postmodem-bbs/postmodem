// SPDX-License-Identifier: AGPL-3.0-or-later
// Outside contexts (EXTENSION-POINTS §7.2): plain text for meta descriptions, feeds, search
// snippets, e-mail. Quotes and hidden content are left out; reader-dependent tags vanish.
import { type Node, parse } from "./bbcode.ts";

function collect(nodes: Node[], out: string[], omit?: ReadonlySet<string>) {
  for (const n of nodes) {
    if (n.type === "text") out.push(n.value);
    else if (
      n.name === "quote" ||
      n.name === "hide" ||
      n.name === "you" ||
      n.name === "img" ||
      omit?.has(n.name)
    )
      out.push(" ");
    else if (n.name === "*") {
      out.push(" ");
      collect(n.children, out, omit);
    } else {
      collect(n.children, out, omit);
      if (n.name === "code" || n.name === "list" || n.name === "center" || n.name === "scroll") out.push(" ");
    }
  }
}

export function toPlainText(source: string, omit?: ReadonlySet<string>): string {
  const out: string[] = [];
  collect(parse(source), out, omit);
  return out.join("").replace(/\s+/g, " ").trim();
}

/** A short plain-text summary, cut at a word boundary with an ellipsis. */
export function excerpt(source: string, max = 160, omit?: ReadonlySet<string>): string {
  const text = toPlainText(source, omit);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}
