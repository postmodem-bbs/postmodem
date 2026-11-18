// SPDX-License-Identifier: AGPL-3.0-or-later
// Server half of the urls service (ADR 0012): resolves internal route refs to entities (id,
// slug, old slug, classic category number) and redirects every request to its canonical URL.
import type { Id, Node, Repositories, Topic, UrlStyle, User } from "@postmodem/core";
import { redirect } from "@sveltejs/kit";
import { makeUrls, parseRef, type Urls } from "../urls.ts";
import type { ClassicIds } from "./board.ts";

export function urlsFor(style: UrlStyle): Urls {
  return makeUrls(style);
}

/**
 * Numbers for classic `index.php?c=` links. phpBB2 numbered categories separately from
 * forums; imported categories became nodes with new ids, so their old number lives in
 * legacy_ids and stays their classic link. A category created later uses its node id, unless
 * that number already belongs to an imported category (then null: it links in numbered form).
 */
export async function classicCategoryIds(repos: Repositories, tree: Node[]): Promise<ClassicIds> {
  const legacy = await repos.legacyIds.list("category");
  const categories = new Set(tree.filter((n) => n.kind === "category").map((n) => n.id));
  const claimed = new Set(legacy.map((l) => Number(l.legacyId)));
  const out = new Map<Id, Id | null>();
  for (const l of legacy) {
    const number = Number(l.legacyId);
    if (!categories.has(l.newId) || !Number.isInteger(number)) continue;
    const prev = out.get(l.newId);
    if (prev === undefined || prev === null || number < prev) out.set(l.newId, number);
  }
  for (const id of categories) if (!out.has(id)) out.set(id, claimed.has(id) ? null : id);
  return out;
}

/** `index.php?c=N`: an imported category's old number first, then a node id. */
async function nodeByClassicNumber(repos: Repositories, number: Id): Promise<Node | undefined> {
  for (const l of await repos.legacyIds.list("category"))
    if (Number(l.legacyId) === number) {
      const node = await repos.nodes.get(l.newId);
      if (node) return node;
    }
  const node = await repos.nodes.get(number);
  return node?.kind === "category" ? node : undefined;
}

export async function resolveNode(repos: Repositories, ref: string): Promise<Node | undefined> {
  const r = parseRef(ref);
  if (!r) return undefined;
  if ("id" in r) return repos.nodes.get(r.id);
  if ("classicId" in r) return nodeByClassicNumber(repos, r.classicId);
  const node = await repos.nodes.bySlug(r.slug);
  if (node) return node;
  const old = await repos.slugs.resolve("node", r.slug);
  return old === undefined ? undefined : repos.nodes.get(old);
}

export async function resolveTopic(repos: Repositories, ref: string): Promise<Topic | undefined> {
  const r = parseRef(ref);
  if (!r || "classicId" in r) return undefined;
  if ("id" in r) return repos.topics.get(r.id);
  const topic = await repos.topics.bySlug(r.slug);
  if (topic) return topic;
  const old = await repos.slugs.resolve("topic", r.slug);
  return old === undefined ? undefined : repos.topics.get(old);
}

export async function resolveUser(repos: Repositories, ref: string): Promise<User | undefined> {
  const r = parseRef(ref);
  if (!r || "classicId" in r) return undefined;
  if ("id" in r) return repos.users.get(r.id);
  const user = await repos.users.bySlug(r.slug);
  if (user) return user;
  const old = await repos.slugs.resolve("user", r.slug);
  return old === undefined ? undefined : repos.users.get(old);
}

/** For `<link rel="canonical">` and anything that leaves the board (mail, feeds). */
export function absoluteUrl(publicUrl: string, path: string): string {
  return new URL(path, publicUrl).href;
}

/**
 * Sends a non-canonical request (another style, an old slug, a stray `sid=` or `start=0`) to
 * the canonical URL with a 301, so each page has exactly one address.
 */
export function ensureCanonical(url: URL, canonical: string): void {
  const target = canonical.split("#")[0]!;
  if (url.pathname + url.search !== target) redirect(301, target);
}
