// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { decodeEntities } from "./entities.ts";
import { resolveHoles } from "./holes.ts";
import { fromPhpbb2SmileyCode, fromPhpbb2Storage } from "./legacy.ts";
import { colorClass, RENDER_VERSION, renderHtml, safeUrl, sizeClass } from "./render.ts";
import { excerpt, toPlainText } from "./text.ts";

const UID = "1a2b3c4d5e";
const legacy = (stored: string) => renderHtml(fromPhpbb2Storage(stored, UID));
const smilies = [
  { code: ":-)", image: "icon_smile.gif", emotion: "Smile" },
  { code: ":lol:", image: "icon_lol.gif", emotion: "Laughing" },
  { code: ":-&gt;", image: "icon_smile2.gif", emotion: "Happy" },
].map((s) => ({ ...s, code: fromPhpbb2SmileyCode(s.code) }));

describe("legacy storage (phpBB2 / Przemo)", () => {
  it("strips this post's uid and decodes entities exactly once", () => {
    const stored = `[b:${UID}]Zażółć[/b:${UID}] &quot;cytat&quot; &amp;lt;b&amp;gt; &lt;i&gt; &#8364; &euro; &#261;`;
    expect(fromPhpbb2Storage(stored, UID)).toBe('[b]Zażółć[/b] "cytat" &lt;b&gt; <i> € € ą');
    expect(legacy(stored)).toBe(
      "<strong>Zażółć</strong> &#34;cytat&#34; &#38;lt;b&#38;gt; &#60;i&#62; € € ą",
    );
  });

  it("leaves tags with another post's uid as plain text, as phpBB2 did", () => {
    expect(legacy("[i:ffffffffff]zły uid[/i:ffffffffff]")).toBe("[i:ffffffffff]zły uid[/i:ffffffffff]");
  });

  it("converts code levels, named quotes and list closers", () => {
    expect(fromPhpbb2Storage(`[code:1:${UID}]x[/code:1:${UID}]`, UID)).toBe("[code]x[/code]");
    expect(fromPhpbb2Storage(`[quote:${UID}="Admin"]hi[/quote:${UID}]`, UID)).toBe(
      '[quote="Admin"]hi[/quote]',
    );
    expect(fromPhpbb2Storage(`[list=1:${UID}][*:${UID}]a[/list:o:${UID}]`, UID)).toBe("[list=1][*]a[/list]");
    expect(fromPhpbb2Storage(`[color=red:${UID}]r[/color:${UID}] [size=18:${UID}]s[/size:${UID}]`, UID)).toBe(
      "[color=red]r[/color] [size=18]s[/size]",
    );
    expect(fromPhpbb2Storage("a\r\nb\rc", UID)).toBe("a\nb\nc");
  });

  it("decodes HTML-escaped smiley codes from Przemo's install data", () => {
    expect(fromPhpbb2SmileyCode(":-&gt;")).toBe(":->");
  });
});

describe("rendering", () => {
  it("renders the phpBB2 tag set", () => {
    expect(renderHtml("[b]b[/b][i]i[/i][u]u[/u]")).toBe("<strong>b</strong><em>i</em><u>u</u>");
    expect(renderHtml('[quote="Admin"]hi[/quote]')).toBe(
      '<blockquote class="bb-quote"><cite class="bb-quote-author">Admin</cite><div class="bb-quote-body">hi</div></blockquote>',
    );
    expect(renderHtml("[quote]anon[/quote]")).toBe(
      '<blockquote class="bb-quote"><div class="bb-quote-body">anon</div></blockquote>',
    );
    expect(renderHtml("[code]\n[b]raw[/b] <x> & y\n[/code]")).toBe(
      '<pre class="bb-code"><code>[b]raw[/b] &#60;x&#62; &#38; y</code></pre>',
    );
    expect(renderHtml("[list]\n[*]one\n[*]two\n[/list]")).toBe(
      '<ul class="bb-list"><li>one</li><li>two</li></ul>',
    );
    expect(renderHtml("[list=a][*]x[/list]")).toBe('<ol class="bb-list" type="a"><li>x</li></ol>');
    expect(renderHtml("[color=red]r[/color][size=24]big[/size]")).toBe(
      '<span class="bb-color bb-color-red">r</span><span class="bb-size-xl">big</span>',
    );
    expect(renderHtml("line1\nline2")).toBe("line1<br>line2");
    // Typed line breaks next to blocks don't stack on top of the block's margins.
    expect(renderHtml("before\n\n[quote]q[/quote]\n\nafter\n\n\nend")).toBe(
      'before<blockquote class="bb-quote"><div class="bb-quote-body">q</div></blockquote>after<br><br><br>end',
    );
  });

  it("renders Przemo's extra tags as classes, never inline styles", () => {
    expect(
      renderHtml(
        "[center]c[/center][fade]f[/fade][glow=red]g[/glow][shadow=blue]s[/shadow][scroll]m[/scroll]",
      ),
    ).toBe(
      '<div class="bb-center">c</div><span class="bb-fade">f</span><span class="bb-glow bb-color-red">g</span><span class="bb-shadow bb-color-blue">s</span><div class="bb-scroll"><span>m</span></div>',
    );
    expect(renderHtml("[color=#ff0000]x[/color]")).toContain("bb-color-red");
    expect(renderHtml("[color=expression(alert(1))]x[/color]")).toBe("x");
    expect(renderHtml("[size=999999]x[/size]")).toBe('<span class="bb-size-xl">x</span>');
  });

  it("only links to safe targets", () => {
    expect(renderHtml("[url]http://example.org/a?b=1&c=2[/url]")).toBe(
      '<a href="http://example.org/a?b=1&#38;c=2" rel="ugc nofollow noopener">http://example.org/a?b=1&#38;c=2</a>',
    );
    expect(renderHtml("[url=https://example.org][b]label[/b][/url]")).toBe(
      '<a href="https://example.org/" rel="ugc nofollow noopener"><strong>label</strong></a>',
    );
    expect(renderHtml("[url=javascript:alert(1)]click[/url]")).toBe("click");
    expect(renderHtml("[img]https://example.org/a.png[/img]")).toBe(
      '<img class="bb-img" src="https://example.org/a.png" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">',
    );
    expect(renderHtml('[img]javascript:alert("x")[/img]')).toBe("javascript:alert(&#34;x&#34;)");
    expect(renderHtml("[email]user@example.org[/email]")).toBe(
      '<a href="mailto:user@example.org" rel="ugc nofollow noopener">user@example.org</a>',
    );
  });

  it("auto-links bare URLs and e-mail addresses, leaving trailing punctuation out", () => {
    expect(renderHtml("See www.example.org/x, or mail a@b.pl.")).toBe(
      'See <a href="http://www.example.org/x" rel="ugc nofollow noopener">www.example.org/x</a>, or mail <a href="mailto:a@b.pl" rel="ugc nofollow noopener">a@b.pl</a>.',
    );
    const long = `https://example.org/${"a".repeat(80)}`;
    expect(renderHtml(long)).toContain(`>${long.slice(0, 39)}…${long.slice(-10)}</a>`);
  });

  it("replaces smilies only when they stand on their own, never inside links or code", () => {
    const html = renderHtml("Hi :-) and hi:-) :lol: :-> [code]:-)[/code] http://x.org/:-)", { smilies });
    expect(html.match(/class="smiley"/g)).toHaveLength(3);
    expect(html).toContain('<img class="smiley" src="/smilies/icon_smile2.gif" alt=":-&#62;" title="Happy">');
    expect(html).toContain("<code>:-)</code>");
  });

  it("degrades broken markup to the text the author typed", () => {
    expect(renderHtml("[b]never closed")).toBe("[b]never closed");
    expect(renderHtml("[b][i]crossed[/b][/i]")).toBe("<strong>[i]crossed</strong>[/i]");
    expect(renderHtml("[/b]stray")).toBe("[/b]stray");
    expect(renderHtml("[*]item outside a list")).toBe("[*]item outside a list");
    expect(renderHtml("[unknown]x[/unknown]")).toBe("[unknown]x[/unknown]");
  });

  it("parses tag arguments full of quotes in linear time", () => {
    // Exponential backtracking took seconds at 40 quotes and minutes at 50.
    for (const tail of ["", "x", "\n", "]"]) {
      const source = `[url=${'"'.repeat(20_000)}${tail}`;
      const started = performance.now();
      renderHtml(source);
      expect(performance.now() - started).toBeLessThan(500);
    }
    expect(renderHtml('[quote="Ola"]hi[/quote]')).toContain("Ola");
    expect(renderHtml('[quote=""Ola""]hi[/quote]')).toContain("hi");
  });

  it("survives pathological nesting", () => {
    const html = renderHtml(`${"[b]".repeat(500)}deep${"[/b]".repeat(500)}`);
    expect((html.match(/<strong>/g) ?? []).length).toBeLessThanOrEqual(24);
    expect(html).toContain("deep");
  });

  it("maps phpBB2 pixel sizes and hex colours onto theme steps", () => {
    expect([7, 9, 12, 18, 24].map((n) => sizeClass(String(n)))).toEqual(["xs", "s", "m", "l", "xl"]);
    expect(colorClass("#FF0000")).toBe("red");
    expect(colorClass("darkred")).toBe("darkred");
    expect(colorClass("not-a-colour")).toBeNull();
    expect(safeUrl("www.example.org")).toBe("http://www.example.org/");
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(RENDER_VERSION).toBeGreaterThan(0);
  });
});

describe("reader-dependent holes", () => {
  const messages = { guest: "Gość", hiddenContent: "Ukryta treść" };
  it("never puts hidden content into the cached HTML", () => {
    const html = renderHtml("public [hide]SECRET[/hide] for [you]");
    expect(html).not.toContain("SECRET");
    expect(resolveHoles(html, { viewerName: "Ala <script>", messages })).toBe(
      'public <p class="bb-hidden">Ukryta treść</p> for <span class="bb-you">Ala &#60;script&#62;</span>',
    );
    expect(resolveHoles(html, { viewerName: null, messages })).toContain(">Gość<");
    expect(resolveHoles("<!--pm-hole:unknown-->x", { viewerName: null, messages })).toBe("x");
  });
});

describe("plain text", () => {
  it("leaves out quotes, hidden content and images", () => {
    const src =
      '[quote="Bob"]old stuff[/quote]Nowy [b]post[/b] [hide]tajne[/hide][img]http://x.org/a.png[/img] [code]x = 1[/code]';
    expect(toPlainText(src)).toBe("Nowy post x = 1");
    expect(excerpt("słowo ".repeat(60), 40)).toMatch(/^(słowo ){5,6}słowo…$|^(słowo ){5,6}…$/u);
    expect(excerpt("krótki", 40)).toBe("krótki");
  });
  it("decodes entities only where asked", () => {
    expect(decodeEntities("&amp;amp; &unknown; &#x105;")).toBe("&amp; &unknown; ą");
  });
});

/** Fuzz: whatever the input, the output only contains allow-listed markup. */
describe("safety", () => {
  const ALLOWED: Record<string, string[]> = {
    strong: [],
    em: [],
    u: [],
    span: ["class"],
    div: ["class"],
    a: ["href", "rel"],
    img: ["class", "src", "alt", "title", "loading", "decoding", "referrerpolicy"],
    pre: ["class"],
    code: [],
    blockquote: ["class"],
    cite: ["class"],
    ul: ["class"],
    ol: ["class", "type"],
    li: [],
    br: [],
  };
  const PIECES = [
    "[b]",
    "[/b]",
    "[i]",
    "[/i]",
    "[url=",
    "[url]",
    "[/url]",
    "[img]",
    "[/img]",
    "[quote=",
    "[quote]",
    "[/quote]",
    "[code]",
    "[/code]",
    "[list]",
    "[list=",
    "[*]",
    "[/list]",
    "[color=",
    "[/color]",
    "[size=",
    "[/size]",
    "[email]",
    "[/email]",
    "[hide]",
    "[/hide]",
    "[you]",
    "]",
    '"',
    "'",
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    "JaVaScRiPt:x",
    "data:text/html,x",
    "onerror=alert(1)",
    " ",
    "\n",
    "http://example.org/x",
    "www.example.org",
    "a@b.pl",
    ":-)",
    "&",
    "&lt;",
    "&#60;",
    "<img src=x onerror=1>",
    "Zażółć",
    '="',
    "`",
  ];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };

  it("emits only allow-listed elements, attributes and URL schemes (3000 random inputs)", () => {
    for (let i = 0; i < 3000; i++) {
      const input = Array.from(
        { length: 1 + Math.floor(rnd() * 25) },
        () => PIECES[Math.floor(rnd() * PIECES.length)],
      ).join("");
      const html = renderHtml(input, { smilies });
      for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
        const [, , tag, attrs] = m;
        expect(Object.keys(ALLOWED), `${tag} in ${JSON.stringify(input)}`).toContain(tag!.toLowerCase());
        for (const a of attrs!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
          expect(ALLOWED[tag!.toLowerCase()], `${a[1]} on ${tag} in ${JSON.stringify(input)}`).toContain(
            a[1],
          );
          if (a[1] === "href" || a[1] === "src")
            expect(a[2]).toMatch(/^(https?:\/\/|ftp:\/\/|mailto:|\/smilies\/)/);
        }
        // Attributes must be well-formed name="value" pairs only.
        expect(attrs!.replace(/\s+[a-zA-Z-]+="[^"]*"/g, "").trim()).toBe("");
      }
      // Text may *mention* "onerror=" or "<script>"; it must never become markup.
      expect(html).not.toMatch(/<script/i);
    }
  });
});
