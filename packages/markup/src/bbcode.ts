// SPDX-License-Identifier: AGPL-3.0-or-later
// Parser for Postmodem's BBCode dialect ("bbcode-phpbb2": phpBB2's tags plus Przemo's,
// without uids). Produces an AST; never throws. Tags that aren't closed properly turn back
// into the literal text the author typed, exactly as phpBB2 left unmatched tags alone.

export type Node =
  | { type: "text"; value: string }
  | { type: "tag"; name: TagName; arg: string | null; children: Node[] };

export const TAGS = {
  b: "inline",
  i: "inline",
  u: "inline",
  color: "inline",
  size: "inline",
  url: "inline",
  email: "raw",
  img: "raw",
  code: "raw",
  quote: "block",
  list: "block",
  "*": "item",
  center: "block",
  fade: "inline",
  glow: "inline",
  shadow: "inline",
  scroll: "block",
  hide: "block",
  you: "void",
} as const;
export type TagName = keyof typeof TAGS;
const isTag = (s: string): s is TagName => Object.hasOwn(TAGS, s);

const MAX_DEPTH = 24; // deeper nesting is rendered as text (defence against pathological input)

interface Frame {
  name: TagName | "#root";
  arg: string | null;
  raw: string; // the opening tag as typed, for degrading to text
  children: Node[];
}

// An argument runs up to the first "]" or line break. Quotes in it are ordinary characters
// here (unquote() strips a surrounding pair). An earlier `(?:"…"|[^\]\n])*` matched the same
// strings, but its alternatives overlapped on '"': an unclosed tag full of quotes backtracked
// exponentially, and one post could stall the server (CodeQL js/redos).
const TAG_RE = /\[(\/?)(\*|[a-z]+)(?:=([^\]\n]*))?\]/gi;

function pushText(into: Node[], value: string) {
  if (!value) return;
  const last = into[into.length - 1];
  if (last?.type === "text") last.value += value;
  else into.push({ type: "text", value });
}

function unquote(arg: string | undefined): string | null {
  if (arg === undefined) return null;
  const a = arg.trim();
  return a.length >= 2 && a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a;
}

export function parse(source: string): Node[] {
  const text = source.replace(/\r\n?/g, "\n");
  const root: Frame = { name: "#root", arg: null, raw: "", children: [] };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1]!;

  /** Close frames down to (and including) index i; frames above i were never closed → text. */
  const closeTo = (i: number, keepLast: boolean) => {
    while (stack.length - 1 > i) {
      const open = stack.pop()!;
      // List items close implicitly with their list; anything else left open was never closed.
      if (open.name === "*")
        top().children.push({ type: "tag", name: "*", arg: null, children: open.children });
      else degrade(open);
    }
    const frame = stack.pop()!;
    if (keepLast)
      top().children.push({
        type: "tag",
        name: frame.name as TagName,
        arg: frame.arg,
        children: frame.children,
      });
    else degrade(frame);
  };
  /** An unclosed tag: its opening text comes back, its children stay. */
  const degrade = (frame: Frame) => {
    const into = top().children;
    pushText(into, frame.raw);
    for (const child of frame.children) {
      if (child.type === "text") pushText(into, child.value);
      else into.push(child);
    }
  };

  let pos = 0;
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
    const [raw, slash, rawName, rawArg] = m;
    const name = rawName!.toLowerCase();
    const current = top();

    // Inside raw tags (code, img, email) only the matching close tag is special.
    if (current.name !== "#root" && TAGS[current.name] === "raw") {
      if (slash && name === current.name) {
        pushText(current.children, text.slice(pos, m.index));
        pos = m.index + raw.length;
        closeTo(stack.length - 1, true);
      }
      continue;
    }

    pushText(current.children, text.slice(pos, m.index));
    pos = m.index + raw.length;

    if (!isTag(name)) {
      pushText(current.children, raw);
      continue;
    }
    if (slash) {
      // [*] items close implicitly; a stray [/*] is text.
      const target = name === "*" ? -1 : stack.findLastIndex((f) => f.name === name);
      if (target > 0) {
        // Close any open list item on the way to its list.
        closeTo(target, true);
      } else pushText(current.children, raw);
      continue;
    }
    if (name === "you") {
      current.children.push({ type: "tag", name, arg: null, children: [] });
      continue;
    }
    if (name === "*") {
      const listIndex = stack.findLastIndex((f) => f.name === "list");
      if (listIndex < 1) {
        pushText(current.children, raw);
        continue;
      }
      // A new item ends the previous one.
      if (top().name === "*") closeTo(stack.length - 1, true);
      else if (stack.length - 1 > listIndex) {
        pushText(current.children, raw);
        continue;
      }
    }
    if (stack.length > MAX_DEPTH) {
      pushText(current.children, raw);
      continue;
    }
    stack.push({ name, arg: unquote(rawArg), raw, children: [] });
  }
  pushText(top().children, text.slice(pos));
  // Close open list items at the end of their list; everything else left open degrades.
  while (stack.length > 1) {
    const frame = top();
    if (frame.name === "*") closeTo(stack.length - 1, true);
    else closeTo(stack.length - 1, false);
  }
  return root.children;
}
