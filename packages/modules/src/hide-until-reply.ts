// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PackageDefinition } from "@postmodem/core";

export const hideUntilReply: PackageDefinition = {
  key: "hide-until-reply",
  name: "Hide until reply",
  description: "Reveal hidden BBCode to members who have replied to the topic.",
  tier: 2,
  version: "0.1.0",
  capabilities: [
    {
      key: "hide.bypass",
      scope: "node",
      description: "Read hidden BBCode without replying",
      requires: ["node.read"],
      roles: { "core:moderator": "allow" },
    },
  ],
  setup: ({ repos }) => ({
    renderHoles: [
      {
        tag: "hide",
        key: "hide-until-reply:hidden",
        reveal({ topic, node, perms }) {
          const userId = perms.viewer.userId;
          if (userId === null) return false;
          if (perms.can("hide.bypass", node)) return true;
          return topic.firstPostId !== null && repos.posts.hasReply(topic.id, userId, topic.firstPostId);
        },
      },
    ],
  }),
};
