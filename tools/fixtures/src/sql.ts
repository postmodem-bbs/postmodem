// SPDX-License-Identifier: AGPL-3.0-or-later
// Building MySQL statements as raw bytes, so each value can carry its own (possibly wrong) encoding.

const decoders = {
  latin2: new TextDecoder("iso-8859-2"),
  cp1250: new TextDecoder("windows-1250"),
};
/** Reverse tables built from the platform's decoders: char → byte. */
const encoders = Object.fromEntries(
  Object.entries(decoders).map(([name, dec]) => {
    const map = new Map<string, number>();
    for (let b = 0; b < 256; b++) {
      const ch = dec.decode(Uint8Array.of(b));
      if (ch !== "�" && !map.has(ch)) map.set(ch, b);
    }
    return [name, map];
  }),
) as Record<keyof typeof decoders, Map<string, number>>;

export type Charset = "latin2" | "cp1250" | "utf8";

/**
 * Encode text the way a legacy board stored it. Characters a single-byte charset
 * can't represent become HTML numeric entities, exactly as phpBB2 did on input.
 */
export function encode(text: string, charset: Charset): Buffer {
  if (charset === "utf8") return Buffer.from(text, "utf8");
  const table = encoders[charset];
  const bytes: number[] = [];
  for (const ch of text) {
    const b = table.get(ch);
    if (b !== undefined) bytes.push(b);
    else for (const c of Buffer.from(`&#${ch.codePointAt(0)};`, "latin1")) bytes.push(c);
  }
  return Buffer.from(bytes);
}

export function decodeLatin2(buf: Buffer): string {
  return decoders.latin2.decode(buf);
}

/** A MySQL string literal with standard backslash escaping, around arbitrary bytes. */
export function literal(value: Buffer): Buffer {
  const out: number[] = [0x27];
  for (const b of value) {
    switch (b) {
      case 0x00:
        out.push(0x5c, 0x30);
        break;
      case 0x0a:
        out.push(0x5c, 0x6e);
        break;
      case 0x0d:
        out.push(0x5c, 0x72);
        break;
      case 0x1a:
        out.push(0x5c, 0x5a);
        break;
      case 0x22:
        out.push(0x5c, 0x22);
        break;
      case 0x27:
        out.push(0x5c, 0x27);
        break;
      case 0x5c:
        out.push(0x5c, 0x5c);
        break;
      default:
        out.push(b);
    }
  }
  out.push(0x27);
  return Buffer.from(out);
}

export type Value = number | null | Buffer;

/** Accumulates multi-row INSERTs (fast to load) and flushes them in batches. */
export class InsertBatcher {
  #rows: Buffer[] = [];
  readonly #head: Buffer;
  readonly #write: (b: Buffer) => void;
  readonly #batch: number;
  count = 0;
  constructor(table: string, columns: string[], write: (b: Buffer) => void, batch = 500) {
    this.#head = Buffer.from(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n`, "latin1");
    this.#write = write;
    this.#batch = batch;
  }
  add(values: Value[]): void {
    const parts: Buffer[] = [Buffer.from("(")];
    values.forEach((v, i) => {
      if (i) parts.push(Buffer.from(", "));
      parts.push(
        v === null ? Buffer.from("NULL") : typeof v === "number" ? Buffer.from(String(v)) : literal(v),
      );
    });
    parts.push(Buffer.from(")"));
    this.#rows.push(Buffer.concat(parts));
    this.count++;
    if (this.#rows.length >= this.#batch) this.flush();
  }
  flush(): void {
    if (!this.#rows.length) return;
    const body: Buffer[] = [];
    for (const [i, r] of this.#rows.entries()) body.push(i ? Buffer.from(",\n") : Buffer.alloc(0), r);
    this.#write(Buffer.concat([this.#head, ...body, Buffer.from(";\n")]));
    this.#rows = [];
  }
}
