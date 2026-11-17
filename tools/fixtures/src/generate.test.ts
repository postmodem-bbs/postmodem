// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { generate } from "./generate.ts";
import { decodeLatin2, encode, literal } from "./sql.ts";

const run = (preset = "tiny", seed = 42) => {
  const chunks: Buffer[] = [];
  const manifest = generate(preset, seed, (b) => chunks.push(b));
  return { manifest, sql: Buffer.concat(chunks) };
};

describe("charset encoding", () => {
  it("encodes Polish letters differently in latin2 and cp1250, and raw in utf8", () => {
    expect(encode("ąśź", "latin2")).toEqual(Buffer.from([0xb1, 0xb6, 0xbc]));
    expect(encode("ąśź", "cp1250")).toEqual(Buffer.from([0xb9, 0x9c, 0x9f]));
    expect(encode("ą", "utf8")).toEqual(Buffer.from([0xc4, 0x85]));
  });

  it("turns characters outside the charset into HTML entities, like phpBB2", () => {
    expect(encode("€ ż", "latin2").toString("latin1")).toBe("&#8364; \xbf");
    expect(decodeLatin2(encode("Zażółć", "latin2"))).toBe("Zażółć");
  });

  it("escapes MySQL string literals byte-safely", () => {
    expect(literal(Buffer.from('it\'s \\ "x"\r\n')).toString("latin1")).toBe("'it\\'s \\\\ \\\"x\\\"\\r\\n'");
  });
});

describe("generator", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = run("tiny", 42);
    const b = run("tiny", 42);
    const c = run("tiny", 43);
    expect(a.manifest.sha256).toBe(b.manifest.sha256);
    expect(a.sql.equals(b.sql)).toBe(true);
    expect(c.manifest.sha256).not.toBe(a.manifest.sha256);
  });

  it("produces a coherent board description", () => {
    const { manifest } = run("small");
    expect(manifest.counts.posts).toBeGreaterThan(3000);
    expect(manifest.counts.topics).toBe(601); // 600 + one TOPIC_MOVED shadow
    expect(new Set(manifest.forums.map((f) => f.access))).toEqual(
      new Set(["public", "registered", "private", "moderators"]),
    );
    expect(manifest.forums.some((f) => f.parent.startsWith("forum "))).toBe(true); // Przemo sub-forums
    expect(manifest.accounts[0]).toEqual({ userId: 2, username: "Admin", password: "admin", level: "admin" });
  });

  it("contains every kind of real-world quirk in the small preset", () => {
    const kinds = new Set(run("small").manifest.quirks.map((q) => q.kind));
    for (const k of [
      "cp1250-in-latin2",
      "utf8-in-latin2",
      "html-entities",
      "broken-bbcode",
      "anonymous-poster",
      "dangling-poster",
      "orphan-post",
      "stale-counters",
      "missing-smiley-image",
      "moved-shadow-topic",
    ]) {
      expect(kinds, k).toContain(k);
    }
  });

  it("writes uid-suffixed BBCode with CRLF line endings, as phpBB2 stored it", () => {
    const text = run("tiny").sql.toString("latin1");
    expect(text).toMatch(/\[b:[0-9a-f]{10}\]/);
    expect(text).toContain("\\r\\n");
    expect(text.startsWith("-- Postmodem legacy fixture")).toBe(true);
  });
});
