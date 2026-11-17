// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { decodeLegacy } from "./charset.ts";

/** Single-byte encoder built from the decoder's own table. */
function encoder(label: string) {
  const dec = new TextDecoder(label);
  const map = new Map<string, number>();
  for (let b = 0; b < 256; b++) map.set(dec.decode(Uint8Array.of(b)), b);
  return (text: string) => Uint8Array.from([...text].map((ch) => map.get(ch) ?? 0x3f));
}
const latin2 = encoder("iso-8859-2");
const cp1250 = encoder("windows-1250");
const utf8 = (s: string) => new TextEncoder().encode(s);

const PANGRAM = "Zażółć gęślą jaźń. Pchnąć w tę łódź jeża lub ośm skrzyń fig.";
const SHORT = ["Łódź", "Świętochłowice", "Źdźbło", "ąę", "Gość_12", "Kraków", "żółw"];

describe("decodeLegacy", () => {
  it("reads every charset a Przemo board mixes", () => {
    for (const text of [PANGRAM, ...SHORT]) {
      expect(decodeLegacy(latin2(text)), `latin2 ${text}`).toEqual({ text, charset: "latin2" });
      expect(decodeLegacy(utf8(text)).text, `utf8 ${text}`).toBe(text);
    }
    // Windows-1250 differs from latin2 only in ą Ą ś Ś ź Ź (and a few symbols).
    expect(decodeLegacy(cp1250(PANGRAM))).toEqual({ text: PANGRAM, charset: "cp1250" });
    for (const text of ["Świętochłowice", "Źdźbło", "ąę"])
      expect(decodeLegacy(cp1250(text)).text, text).toBe(text);
  });

  it("treats plain ASCII as ASCII and empty values as empty", () => {
    expect(decodeLegacy(utf8("Hello [b]world[/b]"))).toEqual({
      text: "Hello [b]world[/b]",
      charset: "ascii",
    });
    expect(decodeLegacy(null)).toEqual({ text: "", charset: "ascii" });
  });

  it("keeps text that is neither Polish nor plain ASCII readable", () => {
    expect(decodeLegacy(latin2("Café Müller")).text).toBe("Café Müller");
    expect(decodeLegacy(utf8("Ελληνικά € „cytat”")).text).toBe("Ελληνικά € „cytat”");
  });

  it("obeys a forced charset", () => {
    expect(decodeLegacy(cp1250("ś"), "latin2").text).not.toBe("ś");
    expect(decodeLegacy(cp1250("ś"), "cp1250").text).toBe("ś");
  });
});
