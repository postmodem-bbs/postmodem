// SPDX-License-Identifier: AGPL-3.0-or-later
// Minimal structured logger: JSON lines to stdout (pretty in development).
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  opts: { level?: Level; pretty?: boolean; base?: Record<string, unknown> } = {},
  write: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Logger {
  const min = ORDER[opts.level ?? "info"];
  const base = opts.base ?? {};
  const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    const rec = { time: new Date().toISOString(), level, msg, ...base, ...fields };
    if (opts.pretty) {
      const extra = { ...base, ...fields };
      const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
      write(`${rec.time.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`);
    } else write(JSON.stringify(rec));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger({ ...opts, base: { ...base, ...fields } }, write),
  };
}
