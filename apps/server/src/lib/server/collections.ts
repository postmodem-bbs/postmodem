// SPDX-License-Identifier: AGPL-3.0-or-later
// HTTP for collections (PLATFORM-SERVICES §6.4): /x/<package>/c/<name>[/<id>] as JSON, and
// …/form variants that answer a plain form post with a redirect, so a package's forms work
// without JavaScript. A disabled package's collections answer 404.
import { CollectionError, type Doc, type RuleContext } from "@postmodem/core";
import { error, json } from "@sveltejs/kit";
import { safeReturnPath } from "./preferences.ts";

const STATUS = { "not-found": 404, denied: 403, invalid: 400, "rate-limited": 429 } as const;

/** The collection's key, after checking that its package is on. */
export function collectionKey(locals: App.Locals, params: { pkg: string; name: string }): string {
  const key = `${params.pkg}.${params.name}`;
  if (!locals.ctx.packages.isEnabled(params.pkg) || !locals.ctx.platform.collections.definition(key))
    error(404, "Not found");
  return key;
}

export function ruleContext(locals: App.Locals, url: URL): RuleContext {
  const raw = url.searchParams.get("scope");
  const scope = raw && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  return { perms: locals.perms, scope, now: Date.now() };
}

/** What readers get: never the state of a visible document, only of hidden ones (moderators). */
export const publicDoc = (d: Doc) => ({
  id: d.id,
  author: d.author,
  created: d.created,
  updated: d.updated,
  ...(d.state === "visible" ? {} : { state: d.state }),
  data: d.data,
});

/** Runs a collection call; its errors become HTTP statuses. */
export async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CollectionError) error(STATUS[e.code], e.message);
    throw e;
  }
}

export async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) error(415, "Send JSON");
  try {
    return await request.json();
  } catch {
    error(400, "Invalid JSON");
  }
}

/** Form fields, minus the ones the form itself uses, as the document's data. */
export function formData(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form) if (typeof v === "string" && !k.startsWith("_") && k !== "returnTo") out[k] = v;
  return out;
}

/** After a form post: back to the page it came from, with a status for the page to show. */
export function backTo(form: FormData, status: "ok" | CollectionError["code"]): Response {
  const path = safeReturnPath(String(form.get("returnTo") ?? "/"));
  const url = new URL(path, "http://x");
  url.searchParams.set("collection", status);
  return new Response(null, { status: 303, headers: { location: url.pathname + url.search } });
}

export { json };
