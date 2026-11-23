// SPDX-License-Identifier: AGPL-3.0-or-later
// /admin/avatars: the avatar gallery (#131), phpBB2's avatar_gallery_path with one folder per
// category. Images added here pass the same checks as members' avatars; deleting one takes it
// away from the members who picked it.
import { unlink } from "node:fs/promises";
import { fail } from "@sveltejs/kit";
import { adminAudit, requireAdmin } from "#lib/server/admin.ts";
import { avatarGallery, avatarLimits, galleryAvatar, storeAvatar } from "#lib/server/avatars.ts";
import { avatarUrl } from "#lib/server/board.ts";
import { inside, uploadsDir } from "#lib/server/uploads.ts";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const CATEGORY = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals, url, "admin.users");
  const { repos } = locals.ctx.db;
  const gallery = await avatarGallery(locals.ctx.config.dataDir);
  return {
    limits: avatarLimits(locals.ctx.settings),
    categories: await Promise.all(
      gallery.map(async (g) => ({
        name: g.category,
        images: await Promise.all(
          g.images.map(async (file) => {
            const avatar = `gallery/${g.category}/${file}`;
            return {
              value: `${g.category}/${file}`,
              file,
              url: avatarUrl(avatar)!,
              members: await repos.users.countWithAvatar(avatar),
            };
          }),
        ),
      })),
    ),
  };
};

async function guarded(event: RequestEvent) {
  requireAdmin(event.locals, event.url, "admin.users");
  return event.request.formData();
}

export const actions: Actions = {
  add: async (event) => {
    const form = await guarded(event);
    const { settings, config } = event.locals.ctx;
    const category = String(form.get("category") ?? "").trim();
    if (!CATEGORY.test(category)) return fail(400, { error: "category" });
    const file = form.get("file");
    const limits = avatarLimits(settings);
    if (!(file instanceof File) || !file.size) return fail(400, { error: "empty" });
    if (file.size > limits.maxBytes * 4) return fail(400, { error: "large" });
    const stored = await storeAvatar(
      config.dataDir,
      new Uint8Array(await file.arrayBuffer()),
      limits,
      `gallery/${category}`,
      file.name,
    );
    if ("problem" in stored) return fail(400, { error: stored.problem });
    await adminAudit(event.locals, "avatar.gallery_added", "avatar", stored.avatar);
    return { done: true };
  },
  delete: async (event) => {
    const form = await guarded(event);
    const { config, db } = event.locals.ctx;
    const avatar = await galleryAvatar(config.dataDir, String(form.get("image") ?? ""));
    if (!avatar) return fail(404, { error: "missing" });
    const cleared = await db.repos.users.clearAvatar(avatar);
    const full = inside(uploadsDir(config.dataDir), `avatars/${avatar}`);
    if (full) await unlink(full).catch(() => {});
    await adminAudit(event.locals, "avatar.gallery_deleted", "avatar", avatar, { members: cleared });
    return { done: true };
  },
};
