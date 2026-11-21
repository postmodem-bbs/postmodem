// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/forums: the forum tree. Create, edit (title, description, locked, position), move,
// and delete when empty; forums with topics are emptied by moving their topics first (modcp).
import type { NodeKind } from "@postmodem/core";
import { trashDestination } from "@postmodem/modules";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const KINDS: NodeKind[] = ["category", "forum", "link"];

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.forums");
  const { repos } = locals.ctx.db;
  const tree = await repos.nodes.tree();
  const trashEnabled = locals.ctx.packages.isEnabled("trash-bin");
  const destinations = trashEnabled
    ? await repos.fields.load(
        "forum",
        tree.filter((node) => node.kind === "forum").map((node) => node.id),
        [trashDestination.key],
      )
    : new Map<number, Record<string, unknown>>();
  return {
    trashEnabled,
    nodes: tree.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      depth: n.depth,
      kind: n.kind,
      title: n.title,
      description: n.description,
      locked: n.locked,
      position: n.position,
      topics: n.topicCount,
      posts: n.postCount,
      linkUrl: n.linkUrl ?? "",
      trashDestination: Number(destinations.get(n.id)?.[trashDestination.key]) || null,
    })),
  };
};

async function guarded(event: RequestEvent) {
  requireAdmin(event.locals, event.url, "admin.forums");
  return { form: await event.request.formData(), repos: event.locals.ctx.db.repos };
}
const text = (v: FormDataEntryValue | null, max: number) =>
  String(v ?? "")
    .trim()
    .slice(0, max);

export const actions: Actions = {
  create: async (event) => {
    const { form, repos } = await guarded(event);
    const title = text(form.get("title"), 120);
    const kind = String(form.get("kind")) as NodeKind;
    const parentId = Number(form.get("parent")) || null;
    const linkUrl = text(form.get("url"), 500);
    if (!title || !KINDS.includes(kind)) return fail(400, { action: "create", error: "invalid" });
    if (kind === "link" && !/^https?:\/\//i.test(linkUrl))
      return fail(400, { action: "create", error: "url" });
    const parent = parentId ? await repos.nodes.get(parentId) : null;
    if (parentId && (!parent || parent.kind === "link"))
      return fail(400, { action: "create", error: "parent" });
    const node = await repos.nodes.create({
      parentId,
      kind,
      title,
      description: text(form.get("description"), 1000),
      linkUrl: kind === "link" ? linkUrl : null,
    });
    await adminAudit(event.locals, "node.created", "node", node.id, { title, kind, parentId });
    return { action: "create", done: node.id };
  },
  update: async (event) => {
    const { form, repos } = await guarded(event);
    const id = Number(form.get("id"));
    const node = await repos.nodes.get(id);
    if (!node) return fail(404, { action: "update", error: "invalid" });
    const title = text(form.get("title"), 120);
    if (!title) return fail(400, { action: "update", error: "invalid", id });
    const patch = {
      title,
      description: text(form.get("description"), 1000),
      locked: form.get("locked") === "on",
      position: Math.max(0, Math.min(100_000, Number(form.get("position")) || 0)),
    };
    await repos.nodes.update(id, patch);
    const parent = String(form.get("parent") ?? "");
    const newParent = parent === "" ? null : Number(parent);
    if (newParent !== node.parentId) {
      try {
        await repos.nodes.move(id, newParent);
      } catch {
        return fail(400, { action: "update", error: "move", id });
      }
    }
    await adminAudit(event.locals, "node.updated", "node", id, { ...patch, parentId: newParent });
    return { action: "update", done: id };
  },
  trash: async (event) => {
    const { form, repos } = await guarded(event);
    const id = Number(form.get("id"));
    const rawDestination = form.get("destination");
    const destination = rawDestination === "" ? null : Number(rawDestination);
    if (!event.locals.ctx.packages.isEnabled("trash-bin"))
      return fail(400, { action: "trash", error: "invalid", id });
    const node = await repos.nodes.get(id);
    if (node?.kind !== "forum") return fail(404, { action: "trash", error: "invalid", id });
    if (
      destination !== null &&
      (!trashDestination.schema.safeParse(destination).success ||
        destination === id ||
        (await repos.nodes.get(destination))?.kind !== "forum")
    )
      return fail(400, { action: "trash", error: "trash-destination", id });
    await event.locals.ctx.platform.fields.set(
      trashDestination.key,
      { perms: event.locals.perms, entityId: id, node, ownerId: null },
      destination ?? undefined,
    );
    await adminAudit(event.locals, "node.trash-destination", "node", id, { destination });
    return { action: "trash", done: id };
  },
  delete: async (event) => {
    const { form, repos } = await guarded(event);
    const id = Number(form.get("id"));
    if (!(await repos.nodes.removeEmpty(id))) return fail(409, { action: "delete", error: "not-empty", id });
    await adminAudit(event.locals, "node.deleted", "node", id);
    return { action: "delete", done: id };
  },
};
