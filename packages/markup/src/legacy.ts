// SPDX-License-Identifier: AGPL-3.0-or-later
// Converting phpBB2/Przemo storage form into Postmodem's BBCode dialect (format "bbcode-phpbb2").
//
// phpBB2 stored a post HTML-escaped and with every BBCode tag that the "first pass" matched
// rewritten to carry the post's uid: [b:uid] [color=red:uid] [size=18:uid] [quote:uid="name"]
// [code:1:uid] (code also carries a nesting level) [list:uid] [list=1:uid] [*:uid]
// [/list:u:uid] [/list:o:uid] [img:uid] [you:uid]. [url] and [email] never had a uid.
// Only tags with *this post's* uid were rendered; anything else was shown as typed.
import { decodeEntities } from "./entities.ts";

const TAG_WITH_UID = (uid: string) =>
  new RegExp(
    // [/?name (:level)? (:u|:o)? (=arg)? :uid (=arg)? ]
    `\\[(\\/?)(\\*|[a-z]+)((?::\\d+)?)((?::[uo])?)((?:=[^\\]]*?)?):${uid}((?:=[^\\]]*)?)\\]`,
    "gi",
  );

/**
 * Turns stored legacy text into the canonical dialect: tags with this post's uid lose the
 * uid (and code/list bookkeeping), tags with any other uid are left untouched (they then
 * parse as plain text, as phpBB2 displayed them), and HTML entities are decoded once.
 */
export function fromPhpbb2Storage(stored: string, uid: string): string {
  let text = stored.replace(/\r\n?/g, "\n");
  if (/^[0-9a-f]{5,10}$/i.test(uid)) {
    text = text.replace(
      TAG_WITH_UID(uid),
      (
        _m,
        slash: string,
        name: string,
        _level: string,
        _listKind: string,
        argBefore: string,
        argAfter: string,
      ) => `[${slash}${name.toLowerCase()}${argBefore || argAfter}]`,
    );
  }
  return decodeEntities(text);
}

/** Legacy smiley codes were stored HTML-escaped too (Przemo's default ":-&gt;"). */
export function fromPhpbb2SmileyCode(code: string): string {
  return decodeEntities(code);
}
