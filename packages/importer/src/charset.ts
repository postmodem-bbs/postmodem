// SPDX-License-Identifier: AGPL-3.0-or-later
// Legacy text decoding. Przemo declares latin2 (ISO-8859-2), but real boards also hold
// Windows-1250 bytes (pasted from Windows, or a board that ran with the wrong SET NAMES) and
// UTF-8 bytes stored as latin2. Each value is decoded by whichever reading looks most like
// real text, so one board can mix all three.

export type LegacyCharset = "ascii" | "latin2" | "cp1250" | "utf8";

const LATIN2 = new TextDecoder("iso-8859-2");
const CP1250 = new TextDecoder("windows-1250");
const UTF8 = new TextDecoder("utf-8", { fatal: true });

// Letters a Polish board actually writes.
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/gu;
// What a wrong reading tends to produce: C1 controls, latin2/cp1250 cross-overs that are rare
// in Polish text (Ľ š Ť ť Ž ž …), and the tell-tale halves of UTF-8 read as one byte per char.
const IMPLAUSIBLE = /[\u0080-\u009f�ĽľŠšŤťŽžĹĺŔŕĂăŮůŰűŐőÄÃĹÂ€‚„…†‡‰‹›]/gu;

const score = (text: string) =>
  (text.match(POLISH)?.length ?? 0) - 3 * (text.match(IMPLAUSIBLE)?.length ?? 0);

export interface Decoded {
  text: string;
  charset: LegacyCharset;
}

/**
 * Decodes one legacy value. `force` skips detection (an operator's `--charset` override).
 * Ties go to latin2, the charset Przemo declares.
 */
export function decodeLegacy(
  bytes: Uint8Array | null | undefined,
  force?: Exclude<LegacyCharset, "ascii">,
): Decoded {
  if (!bytes || bytes.length === 0) return { text: "", charset: "ascii" };
  if (!bytes.some((b) => b >= 0x80)) return { text: Buffer.from(bytes).toString("latin1"), charset: "ascii" };
  if (force === "latin2") return { text: LATIN2.decode(bytes), charset: "latin2" };
  if (force === "cp1250") return { text: CP1250.decode(bytes), charset: "cp1250" };
  if (force === "utf8") return { text: new TextDecoder().decode(bytes), charset: "utf8" };

  const candidates: Decoded[] = [
    { text: LATIN2.decode(bytes), charset: "latin2" },
    { text: CP1250.decode(bytes), charset: "cp1250" },
  ];
  try {
    candidates.push({ text: UTF8.decode(bytes), charset: "utf8" });
  } catch {
    // not valid UTF-8: one of the single-byte readings it is
  }
  let best = candidates[0]!;
  let bestScore = score(best.text);
  for (const c of candidates.slice(1)) {
    const s = score(c.text);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}
