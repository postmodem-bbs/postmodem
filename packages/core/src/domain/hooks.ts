// SPDX-License-Identifier: AGPL-3.0-or-later
// Content hooks (EXTENSION-POINTS.md §3–4, M2b slice 11): how packages take part in the core's
// posting commands without touching their code. The package host collects every enabled
// package's contributions into one ContentHooks object, which the commands receive with
// their rules; with no packages it is empty and the commands behave as before.
//
//   policy ──► before-filters ──► persist ──► in-transaction hooks ──► commit ──► events
//   (EP-5)      (EP-3: change                  (EP-3: packages' own
//               or veto)                       tables, atomically)
import type { Permissions } from "./core-permissions.ts";
import type { Repositories } from "./ports.ts";
import type { Id, Millis, Node, Post, Topic, User } from "./types.ts";

/** A refusal a reader can understand: a message id (the package's) and its parameters. */
export interface Refusal {
  package: string;
  code: string;
  params?: Record<string, string | number>;
}

/** EP-5: what a package says about one action. `deny` wins; nothing else can widen the core. */
export type PolicyVote = { deny: Refusal } | "abstain";

export type PolicyAction = "post.edit" | "post.delete";

export interface PolicyQuestion {
  action: PolicyAction;
  perms: Permissions;
  /** The acting member (null: a guest, who can't edit or delete anyway). */
  userId: Id | null;
  node: Node;
  topic: Topic;
  post: Pick<Post, "id" | "authorId" | "createdAt">;
  /** The author's roles, for rules about whose posts are protected (loaded once per page). */
  authorIsAdmin: boolean;
  now: Millis;
}

/** EP-3 before-filter outcome: the (possibly changed) draft, or a veto. */
export type FilterResult<D> = { draft: D } | { veto: Refusal };

export interface EditDraft {
  source: string;
  subject: string;
  title: string | null;
}

export interface ContentHooks {
  /** EP-5 access filters, asked after the core's own grants allowed the action. */
  policy?(q: PolicyQuestion): PolicyVote;
  /** EP-3 before-filters on editing a post. */
  beforeUpdate?(e: {
    post: Post;
    topic: Topic;
    node: Node;
    actor: User;
    draft: EditDraft;
  }): Promise<FilterResult<EditDraft>>;
  /**
   * EP-3 in-transaction hooks: run in the command's transaction with repositories bound to it
   * (`tx.raw` for the package's own tables). They can't veto; throwing aborts the command.
   */
  postUpdated?(
    e: { before: Post; after: Post; topic: Topic; actor: User; now: Millis },
    tx: Repositories,
  ): Promise<void>;
}

export const NO_HOOKS: ContentHooks = {};

/** The first package that denies, if any (EXTENSION-POINTS §4: deny wins). */
export function firstDenial(
  voters: { key: string; vote: (q: PolicyQuestion) => PolicyVote }[],
  q: PolicyQuestion,
): Refusal | null {
  for (const v of voters) {
    const vote = v.vote(q);
    if (vote !== "abstain") return vote.deny;
  }
  return null;
}
