// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/ranks: phpBB2's ranks (#130, admin_ranks.php). A rank is either reached by post count
// or special, given to members one by one. Images are uploaded here or come from the import.
import { RANK_TITLE_MAX, type Rank } from "@postmodem/core";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import { rankImageUrl, rankTitle } from "#lib/server/board.ts";
import { saveUploadedImage, uploadsDir } from "#lib/server/uploads.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

/** Rank images are small: phpBB2's were a few stars. */
const IMAGE_MAX = 256 * 1024;
const POSTS_MAX = 1_000_000_000;

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.users");
  const { repos } = locals.ctx.db;
  const counts = await repos.ranks.memberCounts();
  return {
    ranks: (await repos.ranks.all()).map((r) => ({
      ...r,
      title: rankTitle(r, locals.locale),
      translated: r.titleKey !== null,
      imageUrl: rankImageUrl(r.image, locals.locale),
      members: r.special ? (counts.get(r.id) ?? 0) : null,
    })),
  };
};

async function guarded(event: RequestEvent) {
  requireAdmin(event.locals, event.url, "admin.users");
  return { form: await event.request.formData(), repos: event.locals.ctx.db.repos };
}

type Fields = Omit<Rank, "id" | "image" | "titleKey"> & { image?: string | null };

/** A rank as the form describes it, with a new image stored if one was uploaded. */
async function readRank(event: RequestEvent, form: FormData): Promise<Fields | { error: string }> {
  const title = String(form.get("title") ?? "").trim();
  if (!title || [...title].length > RANK_TITLE_MAX) return { error: "title" };
  const special = form.get("kind") === "special";
  const minPosts = Number(form.get("minPosts"));
  if (!special && !(Number.isInteger(minPosts) && minPosts >= 0 && minPosts <= POSTS_MAX))
    return { error: "minPosts" };
  const out: Fields = { title, special, minPosts: special ? null : minPosts };
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    const saved = await saveUploadedImage(
      uploadsDir(event.locals.ctx.config.dataDir),
      "ranks",
      file,
      IMAGE_MAX,
    );
    if ("problem" in saved) return { error: `image-${saved.problem}` };
    out.image = saved.path;
  } else if (form.get("removeImage") === "on") out.image = null;
  return out;
}

export const actions: Actions = {
  create: async (event) => {
    const { form, repos } = await guarded(event);
    const fields = await readRank(event, form);
    if ("error" in fields) return fail(400, { action: "create", error: fields.error });
    const rank = await repos.ranks.create({ ...fields, titleKey: null, image: fields.image ?? null });
    await adminAudit(event.locals, "rank.created", "rank", rank.id, { title: rank.title });
    return { done: "create" };
  },
  update: async (event) => {
    const { form, repos } = await guarded(event);
    const id = Number(form.get("id"));
    const before = await repos.ranks.get(id);
    if (!before) return fail(404, { action: "update", error: "missing", id });
    const fields = await readRank(event, form);
    if ("error" in fields) return fail(400, { action: "update", error: fields.error, id });
    // A default rank keeps following each reader's language until its title is changed; then
    // it is the typed title for everyone, as any other rank.
    const { title, ...rest } = fields;
    const renamed = title !== rankTitle(before, event.locals.locale);
    await repos.ranks.update(id, renamed ? { ...fields, titleKey: null } : rest);
    await adminAudit(event.locals, "rank.updated", "rank", id, { title, renamed });
    return { done: "update", id };
  },
  delete: async (event) => {
    const { form, repos } = await guarded(event);
    const rank = await repos.ranks.get(Number(form.get("id")));
    if (!rank) return fail(404, { action: "delete", error: "missing" });
    await repos.ranks.delete(rank.id);
    await adminAudit(event.locals, "rank.deleted", "rank", rank.id, { title: rank.title });
    return { done: "delete" };
  },
  /** Gives a member a special rank, or takes it away ("none"). */
  assign: async (event) => {
    const { form, repos } = await guarded(event);
    const user = await repos.users.byUsername(String(form.get("username") ?? "").trim());
    if (!user || user.status === "deleted") return fail(400, { action: "assign", error: "user" });
    const choice = String(form.get("rank") ?? "");
    const rank = choice === "none" ? null : await repos.ranks.get(Number(choice));
    if (choice !== "none" && !rank?.special) return fail(400, { action: "assign", error: "rank" });
    await repos.users.update(user.id, { rankId: rank?.id ?? null });
    await adminAudit(event.locals, "rank.assigned", "user", user.id, { rankId: rank?.id ?? null });
    return {
      done: "assign",
      username: user.username,
      rank: rank ? rankTitle(rank, event.locals.locale) : null,
    };
  },
};
