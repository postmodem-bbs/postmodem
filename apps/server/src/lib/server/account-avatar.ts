// SPDX-License-Identifier: AGPL-3.0-or-later
// The Avatar section of /account (#131): upload a file or give a link, pick one from the
// gallery, or remove it. Plain forms, no JavaScript needed. The board's settings say which
// sources are open and how large an avatar may be.
import { avatarsGallery, avatarsRemote, avatarsUpload } from "@postmodem/core";
import { fail, type RequestEvent } from "@sveltejs/kit";
import {
  type AvatarProblem,
  avatarGallery,
  avatarLimits,
  fetchAvatar,
  galleryAvatar,
  releaseAvatar,
  storeAvatar,
} from "./avatars.ts";
import { avatarUrl } from "./board.ts";

type Event = Pick<RequestEvent, "locals" | "url" | "request">;

/** What the section shows: the current avatar, the open sources, the limits, the gallery. */
export async function avatarSection(event: Pick<RequestEvent, "locals" | "url">, avatar: string | null) {
  const { settings, config } = event.locals.ctx;
  const gallery = settings.get(avatarsGallery) ? await avatarGallery(config.dataDir) : [];
  const asked = event.url.searchParams.get("gallery");
  const category = gallery.find((g) => g.category === asked) ?? gallery[0] ?? null;
  return {
    current: avatarUrl(avatar),
    upload: settings.get(avatarsUpload),
    remote: settings.get(avatarsRemote),
    limits: avatarLimits(settings),
    categories: gallery.map((g) => g.category),
    category: category && {
      name: category.category,
      images: category.images.map((file) => ({
        value: `${category.category}/${file}`,
        url: avatarUrl(`gallery/${category.category}/${file}`)!,
        name: file.replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " "),
      })),
    },
  };
}

async function replace(event: Event, avatar: string | null) {
  const user = event.locals.user!;
  const { repos } = event.locals.ctx.db;
  const before = (await repos.users.get(user.id))?.avatar ?? null;
  await repos.users.update(user.id, { avatar });
  if (before !== avatar) await releaseAvatar(event.locals.ctx.config.dataDir, repos, before);
}

const problem = (p: AvatarProblem) => fail(400, { section: "avatar", error: p });

export const avatarActions = {
  /** A file, or failing that a link: phpBB2's "upload" and "upload from a URL". */
  avatarUpload: async (event: Event) => {
    const { settings, config } = event.locals.ctx;
    const form = await event.request.formData();
    const limits = avatarLimits(settings);
    const file = form.get("file");
    const link = String(form.get("link") ?? "").trim();
    let bytes: Uint8Array;
    if (file instanceof File && file.size > 0) {
      if (!settings.get(avatarsUpload)) return problem("type");
      // Room for metadata the stored copy won't keep, but nothing huge read into memory.
      if (file.size > limits.maxBytes * 4) return problem("large");
      bytes = new Uint8Array(await file.arrayBuffer());
    } else if (link) {
      if (!settings.get(avatarsRemote)) return problem("fetch");
      const fetched = await fetchAvatar(link, limits.maxBytes);
      if ("problem" in fetched) return problem(fetched.problem);
      bytes = fetched.bytes;
    } else return problem("empty");
    const stored = await storeAvatar(config.dataDir, bytes, limits);
    if ("problem" in stored) return problem(stored.problem);
    await replace(event, stored.avatar);
    return { section: "avatar", saved: true };
  },
  avatarGallery: async (event: Event) => {
    const { settings, config } = event.locals.ctx;
    const form = await event.request.formData();
    if (!settings.get(avatarsGallery)) return problem("type");
    const avatar = await galleryAvatar(config.dataDir, String(form.get("image") ?? ""));
    if (!avatar) return problem("empty");
    await replace(event, avatar);
    return { section: "avatar", saved: true };
  },
  avatarRemove: async (event: Event) => {
    await replace(event, null);
    return { section: "avatar", saved: true };
  },
};
