// SPDX-License-Identifier: AGPL-3.0-or-later
// End to end: posts stored the way phpBB2/Przemo stored them render cleanly through
// @postmodem/markup — the path every imported post takes.
import { fromPhpbb2Storage, renderHtml } from "@postmodem/markup";
import { describe, expect, it } from "vitest";
import { LANGS, phpbbStore, postBody } from "./content.ts";
import { Rng } from "./rng.ts";

describe("generated legacy posts render cleanly", () => {
  it("leaves no uids, no unmatched tags and no double-escaped entities (2000 posts)", () => {
    const rng = new Rng(2026);
    const tags = /\[\/?(b|i|u|quote|code|list|\*|color|size|url|img|center|shadow)[\]=:]/i;
    for (let i = 0; i < 2000; i++) {
      const uid = rng.hex(10);
      const lang = rng.chance(0.5) ? LANGS.pl : LANGS.en;
      const body = postBody(rng, lang, uid, rng.chance(0.2) ? "Admin" : undefined);
      const stored = phpbbStore(body);
      const html = renderHtml(fromPhpbb2Storage(stored, uid));
      expect(html, stored).not.toContain(uid);
      // Code blocks show BBCode literally on purpose; everything else must be converted.
      const outsideCode = html.replace(/<pre class="bb-code">[\s\S]*?<\/pre>/g, "");
      expect(outsideCode, stored).not.toMatch(tags);
      expect(html, stored).not.toMatch(/&amp;|&quot;|&lt;|&gt;/);
      if (stored.startsWith("[quote:")) expect(html).toContain('<cite class="bb-quote-author">Admin</cite>');
    }
  });

  it("shows code blocks verbatim, including characters phpBB2 escaped on input", () => {
    const uid = "0123456789";
    const stored = phpbbStore(`[code:1:${uid}]echo "<b>" . $i;[/code:1:${uid}]`);
    expect(stored).toContain("&quot;&lt;b&gt;&quot;");
    expect(renderHtml(fromPhpbb2Storage(stored, uid))).toBe(
      '<pre class="bb-code"><code>echo &#34;&#60;b&#62;&#34; . $i;</code></pre>',
    );
  });
});
