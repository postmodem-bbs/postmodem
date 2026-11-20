// SPDX-License-Identifier: AGPL-3.0-or-later
// /account/export — everything the board holds about the member, as JSON (GDPR art. 15/20).
// Never the password hash or other members' private data beyond the messages they exchanged.
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  const user = locals.user;
  if (!user) error(401, "Sign in first");
  const { repos } = locals.ctx.db;
  const posts = [];
  for (let after = 0; ; ) {
    const batch = await repos.posts.byAuthor(user.id, after, 500);
    if (!batch.length) break;
    posts.push(...batch);
    after = batch.at(-1)!.id;
  }
  const topics = await repos.topics.getMany([...new Set(posts.map((p) => p.topicId))]);
  const messages = await repos.messages.allFor(user.id);
  const names = await repos.users.getMany(
    messages.flatMap((m) => [m.senderId, m.recipientId]).filter((i): i is number => i !== null),
  );
  const groups = await Promise.all((await repos.groups.groupsOf(user.id)).map((id) => repos.groups.get(id)));
  const watched = await repos.topics.getMany(await repos.watches.topicsOf(user.id));
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const data = {
    exportedAt: new Date().toISOString(),
    board: locals.ctx.config.publicUrl,
    account: {
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
      joined: iso(user.createdAt),
      lastSeen: iso(user.lastSeenAt),
      postCount: user.postCount,
      location: user.location,
      website: user.website,
      signature: user.signatureSource,
      locale: user.locale,
      rulesAccepted:
        user.rulesVersion === null ? null : { version: user.rulesVersion, at: iso(user.rulesAcceptedAt) },
      notifications: { privateMessages: user.notifyPm, watchOwnTopics: user.autoWatch },
    },
    groups: groups.filter((g) => !!g).map((g) => g!.name),
    sessions: (await repos.sessions.listForUser(user.id)).map((s) => ({
      started: iso(s.createdAt),
      lastSeen: iso(s.lastSeenAt),
      userAgent: s.userAgent,
    })),
    watchedTopics: [...watched.values()].map((t) => ({ id: t.id, title: t.title })),
    posts: posts.map((p) => ({
      id: p.id,
      topic: { id: p.topicId, title: topics.get(p.topicId)?.title ?? null },
      subject: p.subject,
      text: p.source,
      createdAt: iso(p.createdAt),
      editedAt: iso(p.editedAt),
      deleted: p.visibility !== "core:public",
    })),
    preferences: (await locals.ctx.platform.preferences.forReader(user.id, undefined)).chosen(),
    // Packages' data (M2b slice 10 services): personal user fields and documents written.
    fields: await locals.ctx.platform.fields.personal(user.id),
    documents: (await locals.ctx.db.platform.docs.byAuthor(user.id)).map((d) => ({
      collection: d.collection,
      id: d.id,
      createdAt: iso(d.created),
      data: d.data,
    })),
    packages: await locals.ctx.packages.exportPersonal(user.id),
    privateMessages: messages.map((m) => ({
      id: m.id,
      direction: m.recipientId === user.id ? "received" : "sent",
      with:
        (m.recipientId === user.id
          ? m.senderId === null
            ? null
            : names.get(m.senderId)?.username
          : names.get(m.recipientId)?.username) ?? null,
      subject: m.subject,
      text: m.source,
      sentAt: iso(m.createdAt),
      readAt: iso(m.readAt),
    })),
  };
  await repos.audit.append({
    actorId: user.id,
    action: "account.exported",
    targetType: "user",
    targetId: String(user.id),
    details: {},
  });
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="postmodem-${user.username.replace(/[^\w.-]+/g, "_")}.json"`,
      "cache-control": "no-store",
    },
  });
};
