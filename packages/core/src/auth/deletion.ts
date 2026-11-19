// SPDX-License-Identifier: AGPL-3.0-or-later
// Deleting one's account (M2 slice 9, decision 2 of M2.md). Everything personal goes: profile
// fields, e-mail, password, sessions, memberships, personal grants, watches and the member's
// side of every private message; the account row stays as "deleted-<id>" (ids in posts and
// the audit log keep pointing somewhere) with status "deleted". Posts stay, credited to
// "Deleted user" (phpBB2), or are removed if the board says so (core.accounts.deletedPosts).
import type { Repositories } from "../domain/ports.ts";
import type { Id, User } from "../domain/types.ts";

export async function deleteAccount(
  repos: Repositories,
  user: User,
  opts: { posts: "keep" | "remove"; deletedName: string },
): Promise<{ posts: number }> {
  return repos.transaction(async (r) => {
    await r.users.get(user.id, { forUpdate: true });
    // Posts: count, then keep (anonymised) or remove.
    const topics = new Set<Id>();
    const nodes = new Set<Id>();
    let count = 0;
    for (let after = 0; ; ) {
      const batch = await r.posts.byAuthor(user.id, after, 500);
      if (!batch.length) break;
      for (const p of batch) {
        count++;
        if (opts.posts === "remove" && p.visibility === "core:public") {
          await r.posts.setVisibility(p.id, "core:deleted");
          topics.add(p.topicId);
          nodes.add(p.nodeId);
        }
      }
      after = batch.at(-1)!.id;
    }
    if (opts.posts === "remove") {
      for (const t of topics) {
        const topic = await r.topics.recount(t);
        // A topic left with no public posts goes too.
        if (topic.firstPostId === null) await r.topics.setVisibility(t, "core:deleted");
      }
      for (const n of nodes) await r.nodes.recount(n);
    }
    await r.posts.anonymiseAuthor(user.id, opts.deletedName);
    await r.search.forgetAuthor(user.id);

    for (const m of await r.messages.allFor(user.id)) await r.messages.deleteFor(m.id, user.id);
    await r.watches.removeAllFor(user.id);
    await r.groups.removeAllFor(user.id);
    for (const g of await r.grants.all())
      if (g.subject.type === "user" && g.subject.id === user.id) await r.grants.remove(g.id);
    await r.sessions.removeForUser(user.id);
    await r.credentials.remove(user.id);
    await r.emailTokens.revoke(user.id, "change-email", Date.now());
    await r.users.update(user.id, {
      username: `deleted-${user.id}`,
      email: null,
      status: "deleted",
      signatureSource: "",
      location: "",
      website: "",
      avatar: null,
      locale: null,
      timezone: null,
      postCount: 0,
      notifyPm: false,
      autoWatch: false,
    });
    await r.audit.append({
      actorId: user.id,
      action: "account.deleted",
      targetType: "user",
      targetId: String(user.id),
      details: { posts: count, kept: opts.posts === "keep" },
    });
    return { posts: count };
  });
}
