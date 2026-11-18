// SPDX-License-Identifier: AGPL-3.0-or-later
// quick-reply (tier 1, PACKAGES.md §2.2): a reply box under the posts, posting to the core
// reply endpoint. No data of its own: everything (rules, flood, throttle) is the core's.
import { may, type PackageDefinition } from "@postmodem/core";

export const quickReply: PackageDefinition = {
  key: "quick-reply",
  name: "Quick reply",
  description: "A reply box under the posts of a topic.",
  tier: 1,
  version: "0.1.0",
  setup: () => ({
    slots: {
      "topic.afterPosts": ({ user, perms, topic, node }) => {
        if (!user || !topic || !node || !may.reply(perms, node, topic)) return [];
        return [
          {
            kind: "form",
            key: "quick-reply",
            heading: "quick-reply-heading",
            action: `/posting.php?mode=reply&t=${topic.id}&/submit`,
            fields: [
              { name: "source", label: "posting-body", type: "textarea", required: true },
              { name: "intent", label: "", type: "hidden", value: "submit" },
            ],
            submit: "posting-submit",
          },
        ];
      },
    },
  }),
};
