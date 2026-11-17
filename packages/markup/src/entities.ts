// SPDX-License-Identifier: AGPL-3.0-or-later
// HTML entity decoding for legacy phpBB2 text, which was stored HTML-escaped
// (prepare_message: & < > " → entities, numeric entities kept, Przemo restored a list
// of named symbols such as &euro;). Decoded exactly once, at import.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Przemo's symbol list (functions_post.php) and common Latin-1 extras
  micro: "µ",
  Omega: "Ω",
  Pi: "Π",
  phi: "φ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  alpha: "α",
  beta: "β",
  chi: "χ",
  tau: "τ",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  psi: "ψ",
  theta: "θ",
  lambda: "λ",
  xi: "ξ",
  rho: "ρ",
  sigma: "σ",
  omega: "ω",
  kappa: "κ",
  Gamma: "Γ",
  clubs: "♣",
  hearts: "♥",
  euro: "€",
  sect: "§",
  copy: "©",
  reg: "®",
  bull: "•",
  trade: "™",
  deg: "°",
  laquo: "«",
  raquo: "»",
  le: "≤",
  ge: "≥",
  sup3: "³",
  sup2: "²",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  plusmn: "±",
  divide: "÷",
  times: "×",
  radic: "√",
  infin: "∞",
  int: "∫",
  asymp: "≈",
  ne: "≠",
  equiv: "≡",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  bdquo: "„",
  rdquo: "”",
  ldquo: "“",
  lsquo: "‘",
  rsquo: "’",
};

/**
 * Decode numeric (&#261; &#x105;) and known named entities. Unknown names stay as written.
 * Przemo's `&micro` (missing semicolon in its own table) is accepted too.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,15});?/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        return "�";
      return String.fromCodePoint(code);
    }
    const named = NAMED[body];
    if (named === undefined) return whole;
    // A named entity needs its semicolon, except Przemo's `&micro` quirk.
    if (!whole.endsWith(";") && body !== "micro") return whole;
    return named;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
