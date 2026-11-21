// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineField, type Id, type PackageDefinition, type Repositories } from "@postmodem/core";
import { z } from "zod";

export const trashDestination = defineField({
  key: "trash-bin.destination",
  target: "forum",
  schema: z.number().int().positive(),
  read: "staff",
  write: ({ perms }) => perms.can("admin.forums", null),
});

export const TRASHED = "trash-bin:trashed";

export const trashBin: PackageDefinition = {
  key: "trash-bin",
  name: "Trash bin",
  description: "Move deleted topics to a configured trash forum.",
  tier: 2,
  version: "0.1.0",
  privateTopicStates: [TRASHED],
  fields: [trashDestination],
  setup: () => ({
    content: {
      async beforeDelete({ node }, tx) {
        const fields = await tx.fields.load("forum", [node.id], [trashDestination.key]);
        const destination = trashDestination.schema.safeParse(fields.get(node.id)?.[trashDestination.key]);
        if (!destination.success || destination.data === node.id) return;
        const target = await tx.nodes.get(destination.data);
        if (target?.kind === "forum") return { nodeId: target.id, visibility: TRASHED };
      },
    },
  }),
};

/** Recover content even if the package was disabled after it was trashed. */
export async function restoreTrashedTopic(repos: Repositories, topicId: Id, nodeId: Id, actorId: Id) {
  return repos.transaction(async (tx) => {
    const topic = await tx.topics.get(topicId, { forUpdate: true });
    if (topic?.visibility !== TRASHED || (await tx.nodes.get(nodeId))?.kind !== "forum") return false;
    const posts = (await tx.posts.allInTopic(topicId)).filter((post) => post.visibility === "core:public");
    if (!posts.length) return false;
    await tx.topics.moveTo(topicId, nodeId);
    await tx.topics.setVisibility(topicId, "core:public");
    const counts = new Map<Id, number>();
    for (const post of posts) {
      if (post.authorId !== null) counts.set(post.authorId, (counts.get(post.authorId) ?? 0) + 1);
    }
    for (const [author, count] of [...counts].sort(([a], [b]) => a - b))
      await tx.users.adjustPostCount(author, count);
    await tx.nodes.recount(nodeId);
    await tx.audit.append({
      actorId,
      action: "moderation.trash-restored",
      targetType: "topic",
      targetId: String(topicId),
      details: { from: topic.nodeId, to: nodeId },
    });
    return true;
  });
}
