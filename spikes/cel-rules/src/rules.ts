// osbb rules spike: CEL subset → (1) install-time checker, (2) per-request
// pre-resolution of viewer-only parts, (3) evaluator, (4) SQL compiler.
//
// @bufbuild/cel provides parse() and plan(). Everything else is ours, because
// 0.6.2 ships no usable type checker (see SPIKE.md).
import { celEnv, parse, plan, objectType, CelScalar, celFunc, listType, isCelError, type CelEnv } from "@bufbuild/cel";
import { create, type DescMessage } from "@bufbuild/protobuf";
import { timestampFromMs, timestampMs, TimestampSchema, DurationSchema } from "@bufbuild/protobuf/wkt";
import { buildRegistry, type FieldDecl, type MessageDecl } from "./schema.ts";

type Expr = ReturnType<typeof parse>["expr"];
type SourceInfo = ReturnType<typeof parse>["sourceInfo"];

// ---------------------------------------------------------------- types
export type Ty =
  | "string" | "bool" | "int" | "double" | "timestamp" | "duration" | "null"
  | { list: Ty } | { obj: string };
const tyName = (t: Ty): string => typeof t === "string" ? t : "list" in t ? `list<${tyName(t.list)}>` : t.obj;
const same = (a: Ty, b: Ty) => tyName(a) === tyName(b);
const fromDecl = (d: FieldDecl): Ty => d.type === "number" ? "double" : d.type === "list<string>" ? { list: "string" } : d.type;

// ---------------------------------------------------------------- environment
export interface AddonSchema {
  doc: MessageDecl;                         // collection schema fields
  settings: Record<string, FieldDecl>;
  prefs: Record<string, FieldDecl>;
}
const SYSTEM_FIELDS: MessageDecl = {
  author: { type: "string" }, created: { type: "timestamp" }, updated: { type: "timestamp" },
  state: { type: "string" }, scope: { type: "string" },
};
const VIEWER: MessageDecl = { id: { type: "string" }, isGuest: { type: "bool" }, locale: { type: "string" }, roles: { type: "list<string>" } };
const SCOPE: MessageDecl = { id: { type: "string" }, kind: { type: "string" } };
const PKG = "osbb.rules";

export type RuleKind = "list" | "row" | "create";

export class RuleEnv {
  readonly objects: Record<string, MessageDecl>;
  readonly registry;
  readonly docDesc: DescMessage;
  readonly baseEnv: CelEnv;          // evaluator env for residual rules (doc/input only)
  readonly schema: AddonSchema;
  constructor(schema: AddonSchema) {
    this.schema = schema;
    for (const k of Object.keys(schema.doc))
      if (k in SYSTEM_FIELDS) throw new Error(`schema field '${k}' clashes with a system field`);
    const doc = { ...SYSTEM_FIELDS, ...schema.doc };
    this.objects = { Viewer: VIEWER, Scope: SCOPE, Doc: doc };
    this.registry = buildRegistry(PKG, this.objects);
    this.docDesc = this.registry.getMessage(`${PKG}.Doc`)!;
    this.baseEnv = celEnv({ registry: this.registry, variables: { doc: objectType(`${PKG}.Doc`), input: objectType(`${PKG}.Doc`) } });
  }
  varType(name: string, kind: RuleKind): Ty | undefined {
    if (name === "viewer") return { obj: "Viewer" };
    if (name === "scope") return { obj: "Scope" };
    if (name === "doc" && kind !== "create") return { obj: "Doc" };
    if (name === "input" && kind !== "list") return { obj: "Doc" };
    return undefined;
  }
}

// ---------------------------------------------------------------- errors
export class RuleError extends Error {
  line: number; col: number;
  constructor(line: number, col: number, msg: string) { super(`${line}:${col}: ${msg}`); this.line = line; this.col = col; }
}
function locate(src: string, info: SourceInfo, id: bigint): [number, number] {
  const off = info.positions[id.toString() as never] ?? 0;
  const before = src.slice(0, Number(off));
  const line = before.split("\n").length;
  return [line, Number(off) - before.lastIndexOf("\n")];
}

// ---------------------------------------------------------------- checker
export interface Checked {
  src: string; kind: RuleKind; expr: Expr; info: SourceInfo;
  types: Map<bigint, Ty>;
}
const LIMITS = { maxLength: 1024, maxDepth: 12 };

export function compileRule(env: RuleEnv, src: string, kind: RuleKind): Checked {
  if (src.length > LIMITS.maxLength) throw new RuleError(1, 1, `rule is longer than ${LIMITS.maxLength} characters`);
  let parsed;
  try { parsed = parse(src); } catch (e) {
    const m = /<input>:(\d+):(\d+): (.*)/.exec((e as Error).message);
    if (m) throw new RuleError(+m[1], +m[2], `syntax error: ${m[3]}`);
    throw e;
  }
  const types = new Map<bigint, Ty>();
  const err = (node: Expr, msg: string): never => { const [l, c] = locate(src, parsed.sourceInfo!, node.id); throw new RuleError(l, c, msg); };

  const visit = (node: Expr, depth: number): Ty => {
    if (depth > LIMITS.maxDepth) err(node, `rule is nested deeper than ${LIMITS.maxDepth} levels`);
    const t = infer(node, depth);
    types.set(node.id, t);
    return t;
  };
  const infer = (node: Expr, depth: number): Ty => {
    const k = node.exprKind;
    switch (k.case) {
      case "constExpr": {
        const c = k.value.constantKind;
        switch (c.case) {
          case "boolValue": return "bool";
          case "int64Value": return "int";
          case "doubleValue": return "double";
          case "stringValue": return "string";
          case "nullValue": return err(node, "null is not allowed in rules; use has() to test presence");
          default: return err(node, `unsupported literal (${c.case})`);
        }
      }
      case "identExpr": {
        const t = env.varType(k.value.name, kind);
        if (!t) {
          const known = ["viewer", "scope", "doc", "input"].filter((n) => env.varType(n, kind));
          const hint = known.find((n) => levenshtein(n, k.value.name) <= 2);
          return err(node, `unknown name '${k.value.name}'${hint ? ` (did you mean '${hint}'?)` : ""}; available here: ${known.join(", ")}`);
        }
        return t;
      }
      case "selectExpr": {
        const ot = visit(k.value.operand!, depth + 1);
        if (typeof ot === "string" || !("obj" in ot)) return err(node, `'${k.value.field}' is not a field of ${tyName(ot)}`);
        const fields = env.objects[ot.obj];
        const decl = fields[k.value.field];
        if (!decl) {
          const hint = Object.keys(fields).find((f) => levenshtein(f, k.value.field) <= 2);
          return err(node, `${ot.obj.toLowerCase()} has no field '${k.value.field}'${hint ? ` (did you mean '${hint}'?)` : ""}`);
        }
        if (k.value.testOnly) {
          if (!decl.optional && decl.type !== "timestamp")
            return err(node, `has() only works on optional fields; '${k.value.field}' is always present`);
          return "bool";
        }
        return fromDecl(decl);
      }
      case "listExpr": {
        const el = k.value.elements.map((e) => visit(e, depth + 1));
        if (el.length === 0) return err(node, "empty list literals are not allowed");
        if (!el.every((t) => same(t, el[0]))) return err(node, "list elements must all have the same type");
        return { list: el[0] };
      }
      case "comprehensionExpr":
        return err(node, "all(), exists(), exists_one(), map() and filter() are not allowed in rules");
      case "callExpr": return inferCall(node, k.value, depth);
      default: return err(node, `unsupported expression (${k.case})`);
    }
  };
  const inferCall = (node: Expr, call: { function: string; target?: Expr; args: Expr[] }, depth: number): Ty => {
    const fn = call.function;
    const args = call.args.map((a) => visit(a, depth + 1));
    const target = call.target ? visit(call.target, depth + 1) : undefined;
    const want = (n: number) => { if (args.length !== n) err(node, `${fn}() takes ${n} argument(s), got ${args.length}`); };
    const literalString = (i: number) => {
      const a = call.args[i].exprKind;
      if (a.case !== "constExpr" || a.value.constantKind.case !== "stringValue") err(call.args[i], `${fn}() needs a quoted string here`);
      return (a as { value: { constantKind: { value: string } } }).value.constantKind.value;
    };
    const bothSame = (ops: Ty[]) => { if (!same(args[0], args[1])) err(node, `cannot compare ${tyName(args[0])} with ${tyName(args[1])}`); if (!ops.some((o) => same(o, args[0]))) err(node, `operator not supported for ${tyName(args[0])}`); };
    switch (fn) {
      case "_&&_": case "_||_":
        args.forEach((a, i) => { if (a !== "bool") err(call.args[i], `expected a true/false value, got ${tyName(a)}`); });
        return "bool";
      case "!_": if (args[0] !== "bool") err(node, "! needs a true/false value"); return "bool";
      case "_==_": case "_!=_":
        if (!same(args[0], args[1])) err(node, `cannot compare ${tyName(args[0])} with ${tyName(args[1])} (always ${fn === "_==_" ? "false" : "true"})`);
        return "bool";
      case "_<_": case "_<=_": case "_>_": case "_>=_":
        bothSame(["string", "int", "double", "timestamp", "duration"]); return "bool";
      case "@in": {
        const l = args[1];
        if (typeof l === "string" || !("list" in l) || !same(l.list, args[0])) err(node, `'in' needs a list of ${tyName(args[0])} on the right`);
        return "bool";
      }
      case "_?_:_": if (args[0] !== "bool" || !same(args[1], args[2])) err(node, "condition ? a : b needs a true/false condition and a, b of the same type"); return args[1];
      case "_-_":
        if (args[0] === "timestamp" && args[1] === "timestamp") return "duration";
        if (args[0] === "timestamp" && args[1] === "duration") return "timestamp";
        if (same(args[0], args[1]) && (args[0] === "int" || args[0] === "double" || args[0] === "duration")) return args[0];
        return err(node, `cannot subtract ${tyName(args[1])} from ${tyName(args[0])}`);
      case "_+_":
        if (args[0] === "timestamp" && args[1] === "duration") return "timestamp";
        if (same(args[0], args[1]) && ["int", "double", "duration", "string"].includes(args[0] as string)) return args[0];
        return err(node, `cannot add ${tyName(args[0])} and ${tyName(args[1])}`);
      case "size": { const t = target ?? args[0]; if (t !== "string" && (typeof t === "string" || !("list" in t))) err(node, "size() needs a string or list"); return "int"; }
      case "startsWith": case "endsWith": case "contains":
        if (target !== "string" || args[0] !== "string") err(node, `${fn}() works on strings`); return "bool";
      case "matches":
        if (kind === "list") err(node, "matches() can't be used in list rules (it can't be turned into a database filter)");
        if (target !== "string" || args[0] !== "string") err(node, "matches() works on strings"); return "bool";
      case "duration": want(1); literalString(0); return "duration";
      case "timestamp": want(1); literalString(0); return "timestamp";
      case "can": want(1); if (args[0] !== "string") err(node, "can() needs a capability name"); return "bool";
      case "isMember": want(1); if (args[0] !== "string") err(node, "isMember() needs a group id"); return "bool";
      case "now": want(0); return "timestamp";
      case "age": want(1); if (kind === "create") err(node, "age() is not available in create rules"); return "duration";
      case "setting": case "pref": {
        want(1); const key = literalString(0);
        const decl = (fn === "setting" ? env.schema.settings : env.schema.prefs)[key];
        if (!decl) err(call.args[0], `this add-on has no ${fn} '${key}'`);
        return fromDecl(decl!);
      }
      case "count":
        want(2); literalString(0); literalString(1);
        if (kind !== "create") err(node, "count() is only available in create rules");
        return "int";
      default: return err(node, `unknown function '${fn}()'`);
    }
  };

  const t = visit(parsed.expr, 0);
  if (t !== "bool") throw new RuleError(1, 1, `a rule must be true/false, this one is ${tyName(t)}`);
  return { src, kind, expr: parsed.expr, info: parsed.sourceInfo!, types };
}

// ---------------------------------------------------------------- per-request context
export interface ViewerCtx {
  viewer: { id: string; isGuest: boolean; locale: string; roles: string[] };
  scope: { id: string; kind: string };
  capabilities: Set<string>;
  groups: Set<string>;
  settings: Record<string, unknown>;     // already typed: durations in seconds, timestamps in ms
  prefs: Record<string, unknown>;
  nowMs: number;
  count?: (collection: string, rule: string) => number;
}

// ---------------------------------------------------------------- pre-resolution
// Every sub-expression that does not touch `doc`/`input` depends only on the
// viewer, the scope and board settings → evaluate it once per request with CEL
// itself and replace it by a constant. Both backends then see the same residual.
let nextId = 1_000_000n;
const mk = (exprKind: unknown): Expr => ({ $typeName: "cel.expr.Expr", id: nextId++, exprKind } as unknown as Expr);
const constNode = (constantKind: unknown) => mk({ case: "constExpr", value: { $typeName: "cel.expr.Constant", constantKind } });
const callNode = (fn: string, args: Expr[], target?: Expr) => mk({ case: "callExpr", value: { $typeName: "cel.expr.Expr.Call", function: fn, args, target } });
const isConst = (e: Expr) => e.exprKind.case === "constExpr";
// Constants produced by folding: literals, timestamp('…')/duration('…'), lists of those.
const isFolded = (e: Expr): boolean => {
  const k = e.exprKind;
  if (k.case === "constExpr") return true;
  if (k.case === "callExpr" && (k.value.function === "timestamp" || k.value.function === "duration") && !k.value.target)
    return k.value.args.length === 1 && isConst(k.value.args[0]);
  if (k.case === "listExpr") return k.value.elements.every(isFolded);
  return false;
};
const boolOf = (e: Expr) => e.exprKind.case === "constExpr" && e.exprKind.value.constantKind.case === "boolValue" ? e.exprKind.value.constantKind.value : undefined;

function refsRow(e: Expr): boolean {
  const k = e.exprKind;
  switch (k.case) {
    case "identExpr": return k.value.name === "doc" || k.value.name === "input";
    case "selectExpr": return refsRow(k.value.operand!);
    case "callExpr": return (k.value.target ? refsRow(k.value.target) : false) || k.value.args.some(refsRow);
    case "listExpr": return k.value.elements.some(refsRow);
    default: return false;
  }
}

function staticEnv(env: RuleEnv, ctx: ViewerCtx): CelEnv {
  const dur = (s: number) => create(DurationSchema, { seconds: BigInt(Math.floor(s)), nanos: Math.round((s % 1) * 1e9) });
  const typed = (decl: FieldDecl | undefined, v: unknown) =>
    decl?.type === "duration" ? dur(v as number) : decl?.type === "timestamp" ? timestampFromMs(v as number)
      : decl?.type === "int" ? BigInt(v as number) : v;
  return celEnv({
    registry: env.registry,
    variables: { viewer: objectType(`${PKG}.Viewer`), scope: objectType(`${PKG}.Scope`) },
    funcs: [
      celFunc("can", [CelScalar.STRING], CelScalar.BOOL, (c) => ctx.capabilities.has(c)),
      celFunc("isMember", [CelScalar.STRING], CelScalar.BOOL, (g) => ctx.groups.has(g)),
      celFunc("now", [], objectType(TimestampSchema), () => timestampFromMs(ctx.nowMs)),
      celFunc("setting", [CelScalar.STRING], CelScalar.DYN, (k) => typed(env.schema.settings[k], ctx.settings[k]) as never),
      celFunc("pref", [CelScalar.STRING], CelScalar.DYN, (k) => typed(env.schema.prefs[k], ctx.prefs[k]) as never),
      celFunc("count", [CelScalar.STRING, CelScalar.STRING], CelScalar.INT, (c, r) => BigInt(ctx.count!(c, r))),
    ],
  });
}

export function resolve(env: RuleEnv, rule: Checked, ctx: ViewerCtx): Expr {
  const senv = staticEnv(env, ctx);
  const bindings = {
    viewer: create(env.registry.getMessage(`${PKG}.Viewer`)!, ctx.viewer),
    scope: create(env.registry.getMessage(`${PKG}.Scope`)!, ctx.scope),
  };
  const evalStatic = (e: Expr, known?: Ty): Expr => {
    const t = known ?? rule.types.get(e.id)!;
    const v = plan(senv, e)(bindings as never);
    if (isCelError(v)) throw new Error(`rule evaluation failed: ${v.message}`);
    return toConst(v, t);
  };
  const walk = (e: Expr): Expr => {
    const k = e.exprKind;
    // age(doc) → now() - doc.created, so `now()` can be folded
    if (k.case === "callExpr" && k.value.function === "age") {
      const created = mk({ case: "selectExpr", value: { $typeName: "cel.expr.Expr.Select", operand: k.value.args[0], field: "created", testOnly: false } });
      return walk(callNode("_-_", [evalStatic(callNode("now", []), "timestamp"), created]));
    }
    if (!refsRow(e)) return isFolded(e) ? e : evalStatic(e);
    if (k.case === "callExpr") {
      const args = k.value.args.map(walk);
      const target = k.value.target ? walk(k.value.target) : undefined;
      return simplify(callNode(k.value.function, args, target));
    }
    if (k.case === "listExpr") return mk({ case: "listExpr", value: { ...k.value, elements: k.value.elements.map(walk) } });
    return e;
  };
  return walk(rule.expr);
}

function toConst(v: unknown, t: Ty): Expr {
  if (t === "bool") return constNode({ case: "boolValue", value: v as boolean });
  if (t === "string") return constNode({ case: "stringValue", value: v as string });
  if (t === "int") return constNode({ case: "int64Value", value: v as bigint });
  if (t === "double") return constNode({ case: "doubleValue", value: v as number });
  const msg = (v as { message?: unknown }).message ?? v;
  if (t === "timestamp") return callNode("timestamp", [constNode({ case: "stringValue", value: new Date(timestampMs(msg as never)).toISOString() })]);
  if (t === "duration") {
    const d = msg as { seconds: bigint; nanos: number };
    return callNode("duration", [constNode({ case: "stringValue", value: `${Number(d.seconds) + d.nanos / 1e9}s` })]);
  }
  if (typeof t !== "string" && "list" in t) {
    const items = [...(v as Iterable<unknown>)];
    return mk({ case: "listExpr", value: { $typeName: "cel.expr.Expr.CreateList", elements: items.map((i) => toConst(i, t.list)), optionalIndices: [] } });
  }
  throw new Error(`cannot turn ${tyName(t)} into a constant`);
}

function simplify(e: Expr): Expr {
  if (e.exprKind.case !== "callExpr") return e;
  const { function: fn, args } = e.exprKind.value;
  const [a, b] = args.map(boolOf);
  const T = () => constNode({ case: "boolValue", value: true }), F = () => constNode({ case: "boolValue", value: false });
  if (fn === "_&&_") { if (a === false || b === false) return F(); if (a === true) return args[1]; if (b === true) return args[0]; }
  if (fn === "_||_") { if (a === true || b === true) return T(); if (a === false) return args[1]; if (b === false) return args[0]; }
  if (fn === "!_" && a !== undefined) return a ? F() : T();
  if (fn === "_?_:_" && a !== undefined) return a ? args[1] : args[2];
  return e;
}

// ---------------------------------------------------------------- evaluator (row-level)
export type DocInit = Record<string, unknown>;
export function docMessage(env: RuleEnv, d: DocInit) {
  const init: Record<string, unknown> = {};
  const decls = env.objects.Doc;
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    const t = decls[k]?.type;
    init[k] = t === "timestamp" ? timestampFromMs(Date.parse(v as string)) : t === "int" ? BigInt(v as number) : v;
  }
  return create(env.docDesc, init);
}
export function evaluator(env: RuleEnv, residual: Expr) {
  const f = plan(env.baseEnv, residual);
  return (doc: ReturnType<typeof docMessage>, input?: ReturnType<typeof docMessage>) => {
    const out = f({ doc, input: input ?? doc } as never);
    if (isCelError(out)) throw new Error(out.message);
    return out as boolean;
  };
}

// ---------------------------------------------------------------- SQL compiler (list rules)
export type Dialect = "sqlite" | "pg";
export class Untranslatable extends Error {}

const DEFAULTS: Record<string, string> = { string: "''", int: "0", double: "0", bool: "false", timestamp: "'1970-01-01T00:00:00.000Z'" };
const SYS_COLS = new Set(["author", "created", "updated", "state", "scope"]);

export function toSql(env: RuleEnv, residual: Expr, dialect: Dialect): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return dialect === "pg" ? `$${params.length}` : "?"; };
  const fieldOf = (e: Expr): { name: string; decl: FieldDecl } | undefined => {
    const k = e.exprKind;
    if (k.case === "selectExpr" && !k.value.testOnly && k.value.operand!.exprKind.case === "identExpr" && k.value.operand!.exprKind.value.name === "doc")
      return { name: k.value.field, decl: env.objects.Doc[k.value.field] };
    return undefined;
  };
  // A field read with protobuf/CEL default semantics: absent → '' / 0 / false / epoch.
  const fieldSql = (name: string, decl: FieldDecl): string => {
    if (SYS_COLS.has(name)) return name;
    if (dialect === "sqlite") {
      const x = `json_extract(data, '$.${name}')`;
      return decl.type === "bool" ? `coalesce(${x}, 0)` : `coalesce(${x}, ${DEFAULTS[decl.type === "number" ? "double" : decl.type]})`;
    }
    const x = `(data->>'${name}')`;
    const cast = { string: "", int: "::bigint", number: "::double precision", bool: "::boolean", timestamp: "" }[decl.type as string] ?? "";
    return `coalesce(${x}${cast}, ${DEFAULTS[decl.type === "number" ? "double" : decl.type]})`;
  };
  const lit = (e: Expr): unknown => {
    const k = e.exprKind;
    if (k.case === "constExpr") {
      const c = k.value.constantKind;
      if (c.case === "boolValue") return dialect === "sqlite" ? (c.value ? 1 : 0) : c.value;
      if (c.case === "int64Value") return Number(c.value);
      return c.value;
    }
    if (k.case === "callExpr" && k.value.function === "timestamp") return lit(k.value.args[0]);
    return undefined;
  };
  const str = (s: string) => dialect === "pg" ? `${s} COLLATE "C"` : s;   // CEL compares strings by code point

  const c = (e: Expr): string => {
    const k = e.exprKind;
    if (k.case === "constExpr" || (k.case === "callExpr" && k.value.function === "timestamp")) {
      const b = boolOf(e);
      if (b !== undefined) return b ? "TRUE" : "FALSE";
      return p(lit(e));
    }
    if (k.case === "selectExpr" && k.value.testOnly) {            // has(doc.x)
      const name = k.value.field;
      return dialect === "sqlite" ? `json_type(data, '$.${name}') IS NOT NULL` : `(data ? '${name}')`;
    }
    const f = fieldOf(e);
    if (f) {
      const sql = fieldSql(f.name, f.decl);
      return f.decl.type === "bool" ? (dialect === "sqlite" ? `(${sql} = 1)` : sql) : sql;
    }
    if (k.case !== "callExpr") throw new Untranslatable(`cannot translate ${k.case}`);
    const { function: fn, args, target } = k.value;
    const isStr = (x: Expr) => fieldOf(x)?.decl.type === "string" || (x.exprKind.case === "constExpr" && x.exprKind.value.constantKind.case === "stringValue");
    const operand = (x: Expr) => { const f2 = fieldOf(x); if (f2?.decl.type === "bool") return fieldSql(f2.name, f2.decl); return isStr(x) ? str(c(x)) : c(x); };
    switch (fn) {
      case "_&&_": return `(${c(args[0])} AND ${c(args[1])})`;
      case "_||_": return `(${c(args[0])} OR ${c(args[1])})`;
      case "!_": return `(NOT ${c(args[0])})`;
      case "_?_:_": return `(CASE WHEN ${c(args[0])} THEN ${c(args[1])} ELSE ${c(args[2])} END)`;
      case "_==_": case "_!=_": case "_<_": case "_<=_": case "_>_": case "_>=_": {
        const op = { "_==_": "=", "_!=_": "<>", "_<_": "<", "_<=_": "<=", "_>_": ">", "_>=_": ">=" }[fn];
        return `(${operand(args[0])} ${op} ${operand(args[1])})`;
      }
      case "@in": {
        const [x, list] = args;
        const lf = fieldOf(list);
        if (lf) {                                                    // 'g1' in doc.groups
          const v = p(lit(x));
          return dialect === "sqlite"
            ? `EXISTS (SELECT 1 FROM json_each(data, '$.${lf.name}') WHERE value = ${v})`
            : `(coalesce(data->'${lf.name}', '[]'::jsonb) ? ${v})`;
        }
        if (list.exprKind.case === "listExpr") {                     // doc.x in ['a', 'b']
          const items = list.exprKind.value.elements.map((el) => p(lit(el)));
          return `(${operand(x)} IN (${items.join(", ")}))`;
        }
        throw new Untranslatable("'in' needs a field or a constant list");
      }
      case "size": {
        const t = target ?? args[0]; const tf = fieldOf(t);
        if (tf?.decl.type === "string") return dialect === "sqlite" ? `length(${c(t)})` : `char_length(${c(t)})`;
        if (tf?.decl.type === "list<string>") return dialect === "sqlite" ? `coalesce(json_array_length(data, '$.${tf.name}'), 0)` : `coalesce(jsonb_array_length(data->'${tf.name}'), 0)`;
        throw new Untranslatable("size() needs a string or list field");
      }
      case "startsWith": case "endsWith": case "contains": {
        if (!target || !fieldOf(target) || !isConst(args[0])) throw new Untranslatable(`${fn}() needs a field and a constant`);
        const fsql = c(target), needle = lit(args[0]);
        if (dialect === "pg") {
          const v = p(needle);   // pg placeholders are numbered, so one param can be reused
          return fn === "startsWith" ? `starts_with(${fsql}, ${v})` : fn === "endsWith" ? `(right(${fsql}, char_length(${v})) = ${v})` : `(strpos(${fsql}, ${v}) > 0)`;
        }
        // SQLite: LIKE is case-insensitive for ASCII but CEL is not → substr/instr.
        // Positional '?' params: push one per occurrence, in text order.
        if (fn === "contains") return `(instr(${fsql}, ${p(needle)}) > 0)`;
        if (fn === "startsWith") { const a = p(needle), b = p(needle); return `(substr(${fsql}, 1, length(${a})) = ${b})`; }
        const a = p(needle), b = p(needle), d = p(needle);
        return `(length(${fsql}) >= length(${a}) AND substr(${fsql}, -length(${b})) = ${d})`;
      }
      default: {
        const sym: Record<string, string> = { "_-_": "subtraction (-)", "_+_": "addition (+)", "-_": "negation", "matches": "matches()" };
        throw new Untranslatable(`${sym[fn] ?? fn + "()"} involving document fields can't become a database filter; rewrite it as a comparison against a constant (e.g. doc.created > now() - duration('5m'))`);
      }
    }
  };
  return { sql: c(residual), params };
}

// ---------------------------------------------------------------- utils
function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export { listType };
