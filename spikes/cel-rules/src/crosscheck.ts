// Runs the spike: checker diagnostics, pre-resolution, evaluator vs SQLite vs Postgres.
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { RuleEnv, compileRule, resolve, evaluator, docMessage, toSql, RuleError, Untranslatable, type ViewerCtx, type DocInit } from "./rules.ts";
import { unparse } from "@bufbuild/cel";

// ----------------------------------------------------------- the announcements add-on
const env = new RuleEnv({
  doc: {
    title: { type: "string" }, audience: { type: "string" }, priority: { type: "int" },
    pinned: { type: "bool" }, startsAt: { type: "timestamp" }, endsAt: { type: "timestamp" },
    forum: { type: "string", optional: true }, groups: { type: "list<string>" },
  },
  settings: { editWindow: { type: "duration" }, minPriority: { type: "int" }, prefix: { type: "string" } },
  prefs: { showLowPriority: { type: "bool" } },
});

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

// ----------------------------------------------------------- 1. checker diagnostics
console.log("── 1. Install-time checker ─────────────────────────────────────");
const bad: [string, string][] = [
  ["typo in variable", "viewr.id == doc.author"],
  ["typo in field", "!viewer.isGust"],
  ["type mismatch", "doc.author == 5"],
  ["unknown function", "canSee('x')"],
  ["unknown setting", "doc.priority >= setting('minPrio')"],
  ["setting key not literal", "doc.priority >= setting(doc.title)"],
  ["loop macro", "doc.groups.exists(g, isMember(g))"],
  ["regex in list rule", "doc.title.matches('^A')"],
  ["has() on required field", "has(doc.title)"],
  ["input in list rule", "input.title == ''"],
  ["not a boolean", "doc.priority + 1"],
  ["syntax error", "doc.title == "],
];
for (const [label, src] of bad) {
  try { compileRule(env, src, "list"); console.log(`  ✗ NOT REJECTED  ${label}: ${src}`); }
  catch (e) { console.log(`  ✓ ${label.padEnd(24)} ${src.padEnd(38)} → ${e instanceof RuleError ? e.message : `CRASH ${(e as Error).message}`}`); }
}

// ----------------------------------------------------------- 2. list rules
const RULES: Record<string, string> = {
  simple: "can('announcements.read')",
  advanced: `(doc.audience == 'all'
   || (doc.audience == 'members' && !viewer.isGuest)
   || can('announcements.staffView'))
&& doc.startsAt <= now()
&& (!has(doc.endsAt) || doc.endsAt > now())
&& (!has(doc.forum) || doc.forum == scope.id)`,
  numbers: "doc.author == viewer.id || (doc.priority >= setting('minPriority') && !doc.pinned) || pref('showLowPriority')",
  strings: "doc.title.startsWith(setting('prefix')) || doc.title.endsWith('!') || doc.title.contains('_%') || size(doc.title) == 3",
  lists: "'g2' in doc.groups || (isMember('g1') && size(doc.groups) == 0) || doc.audience in ['staff', 'Staff']",
  ordering: "doc.title < 'b' && doc.created > now() - duration('1h') && doc.priority != 0",
  ternary: "doc.pinned ? doc.priority > 0 : doc.audience != 'all'",
};

const viewers: Record<string, ViewerCtx> = {
  guest: { viewer: { id: "", isGuest: true, locale: "en", roles: [] }, scope: { id: "f1", kind: "forum" },
    capabilities: new Set(["announcements.read"]), groups: new Set(), settings: { minPriority: 5, prefix: "[Info]", editWindow: 300 },
    prefs: { showLowPriority: false }, nowMs: NOW },
  member: { viewer: { id: "u1", isGuest: false, locale: "pl", roles: ["member"] }, scope: { id: "f2", kind: "forum" },
    capabilities: new Set(["announcements.read"]), groups: new Set(["g1"]), settings: { minPriority: 5, prefix: "[Info]", editWindow: 300 },
    prefs: { showLowPriority: false }, nowMs: NOW },
  moderator: { viewer: { id: "u9", isGuest: false, locale: "en", roles: ["moderator"] }, scope: { id: "f1", kind: "forum" },
    capabilities: new Set(["announcements.read", "announcements.staffView"]), groups: new Set(["g2"]), settings: { minPriority: 5, prefix: "[Info]", editWindow: 300 },
    prefs: { showLowPriority: true }, nowMs: NOW },
};

// ----------------------------------------------------------- 3. data with edge cases
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const maybe = <T>(v: T, p = 0.5) => (rnd() < p ? v : undefined);
const TITLES = ["[Info] hi", "[info] hi", "[Info]", "abc", "ab", "a_%b", "Zebra", "zebra", "émoji 🎉", "🎉🎉🎉", "", "A!", "b", "B", "ä", "x_%"];
const offsets = [-86400e3, -3600e3, -1, 0, 1, 3600e3, 86400e3];

const docs: (DocInit & { id: string })[] = Array.from({ length: 3000 }, (_, i) => ({
  id: `d${i}`,
  author: pick(["u1", "u2", "u9", ""]),
  created: iso(NOW + pick([-7200e3, -3600e3 - 1, -3600e3, -3599e3, -60e3, 0])),
  updated: iso(NOW), state: "visible", scope: "board",
  title: maybe(pick(TITLES), 0.9),
  audience: maybe(pick(["all", "members", "staff", "Staff", "ALL"]), 0.9),
  priority: maybe(pick([-5, 0, 4, 5, 6, 2 ** 40]), 0.85),
  pinned: maybe(pick([true, false]), 0.7),
  startsAt: maybe(iso(NOW + pick(offsets)), 0.85),
  endsAt: maybe(iso(NOW + pick(offsets)), 0.5),
  forum: maybe(pick(["f1", "f2", ""]), 0.5),
  groups: maybe(pick([[], ["g1"], ["g2"], ["g1", "g2"], ["G2"]]), 0.8),
}));

// SQLite
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE ext_docs (id TEXT PRIMARY KEY, author TEXT, created TEXT, updated TEXT, state TEXT, scope TEXT, data TEXT)`);
const ins = sqlite.prepare(`INSERT INTO ext_docs VALUES (?, ?, ?, ?, ?, ?, ?)`);
const payload = (d: DocInit) => { const { id, author, created, updated, state, scope, ...rest } = d; void id; void author; void created; void updated; void state; void scope; return JSON.stringify(rest); };
for (const d of docs) ins.run(d.id, d.author as string, d.created as string, d.updated as string, "visible", "board", payload(d));

// Postgres (PGlite = real Postgres compiled to WASM)
const pg = new PGlite();
await pg.exec(`CREATE TABLE ext_docs (id TEXT PRIMARY KEY, author TEXT, created TEXT, updated TEXT, state TEXT, scope TEXT, data JSONB)`);
for (const d of docs) await pg.query(`INSERT INTO ext_docs VALUES ($1,$2,$3,$4,$5,$6,$7)`, [d.id, d.author, d.created, d.updated, "visible", "board", payload(d)]);

const messages = new Map(docs.map((d) => [d.id, docMessage(env, d)]));

// ----------------------------------------------------------- 4. cross-check
console.log("\n── 2. Evaluator vs SQLite vs Postgres (3000 docs × 3 viewers) ──");
let mismatches = 0;
for (const [name, src] of Object.entries(RULES)) {
  const rule = compileRule(env, src, "list");
  for (const [vname, ctx] of Object.entries(viewers)) {
    const residual = resolve(env, rule, ctx);
    const ev = evaluator(env, residual);
    const want = new Set(docs.filter((d) => ev(messages.get(d.id)!)).map((d) => d.id));
    const s = toSql(env, residual, "sqlite"), p = toSql(env, residual, "pg");
    const gotS = new Set((sqlite.prepare(`SELECT id FROM ext_docs WHERE ${s.sql}`).all(...(s.params as never[])) as { id: string }[]).map((r) => r.id));
    const gotP = new Set((await pg.query<{ id: string }>(`SELECT id FROM ext_docs WHERE ${p.sql}`, p.params)).rows.map((r) => r.id));
    const diffS = [...want].filter((x) => !gotS.has(x)).concat([...gotS].filter((x) => !want.has(x)));
    const diffP = [...want].filter((x) => !gotP.has(x)).concat([...gotP].filter((x) => !want.has(x)));
    mismatches += diffS.length + diffP.length;
    const ok = diffS.length === 0 && diffP.length === 0;
    console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(9)} ${vname.padEnd(9)} matched ${String(want.size).padStart(4)}  sqlite Δ${diffS.length}  pg Δ${diffP.length}`);
    for (const id of [...diffS, ...diffP].slice(0, 3)) console.log(`      e.g. ${id}: ${JSON.stringify(docs.find((d) => d.id === id))}`);
    if (name === "advanced" || name === "simple") {
      console.log(`      residual: ${unparse(residual)}`);
      console.log(`      pg:       ${p.sql.replace(/\s+/g, " ")}   params ${JSON.stringify(p.params)}`);
    }
  }
}
console.log(`  total mismatches: ${mismatches}`);

// ----------------------------------------------------------- 5. untranslatable list rule
console.log("\n── 3. List rule that can't become SQL ─────────────────────────");
try { const r = compileRule(env, "age(doc) < setting('editWindow')", "list"); toSql(env, resolve(env, r, viewers.member), "pg"); console.log("  ✗ translated?!"); }
catch (e) { console.log(`  ✓ ${e instanceof Untranslatable ? "rejected" : "error"}: ${(e as Error).message}`); }

// ----------------------------------------------------------- 6. row + create rules
console.log("\n── 4. Row and create rules ────────────────────────────────────");
const editRule = compileRule(env, "doc.author == viewer.id && age(doc) < setting('editWindow')", "row");
const r1 = resolve(env, editRule, viewers.member);
console.log(`  edit rule for member → residual: ${unparse(r1)}`);
const ev1 = evaluator(env, r1);
for (const ago of [60e3, 299e3, 300e3, 301e3]) {
  const d = docMessage(env, { author: "u1", created: iso(NOW - ago) });
  console.log(`    message by u1 posted ${ago / 1000}s ago → may edit: ${ev1(d)}`);
}
const createRule = compileRule(env, "can('announcements.read') && count('items', 'doc.author == viewer.id') < 3 && size(input.title) <= 80", "create");
const newcomer: ViewerCtx = { ...viewers.member, viewer: { ...viewers.member.viewer, id: "u5" } };
for (const [vname, base] of [["member u1", viewers.member], ["newcomer u5", newcomer]] as const) {
  let n = -1;
  const ctx = { ...base, count: (_c: string, r: string) => {
    const inner = resolve(env, compileRule(env, r, "list"), base); const s = toSql(env, inner, "sqlite");
    return (n = (sqlite.prepare(`SELECT count(*) AS n FROM ext_docs WHERE ${s.sql}`).get(...(s.params as never[])) as { n: number }).n);
  } };
  const res = resolve(env, createRule, ctx);
  console.log(`  create rule for ${vname} (has ${n} items) → residual: ${unparse(res)}`);
}

// ----------------------------------------------------------- 7. timings
console.log("\n── 5. Timings ─────────────────────────────────────────────────");
const time = (n: number, f: () => void) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n; };
const adv = RULES.advanced;
console.log(`  parse + check advanced rule:   ${(time(2000, () => compileRule(env, adv, "list")) * 1000).toFixed(1)} µs`);
const advRule = compileRule(env, adv, "list");
console.log(`  pre-resolve per request:       ${(time(2000, () => resolve(env, advRule, viewers.member)) * 1000).toFixed(1)} µs`);
const res = resolve(env, advRule, viewers.member);
console.log(`  compile residual to SQL:       ${(time(2000, () => toSql(env, res, "pg")) * 1000).toFixed(1)} µs`);
const evAdv = evaluator(env, res); const ms = [...messages.values()];
let k = 0;
console.log(`  evaluate per document:         ${(time(200000, () => evAdv(ms[k++ % ms.length])) * 1000).toFixed(2)} µs`);
const evEdit = evaluator(env, r1);
console.log(`  evaluate edit rule per doc:    ${(time(200000, () => evEdit(ms[k++ % ms.length])) * 1000).toFixed(2)} µs`);
process.exit(mismatches ? 1 : 0);
