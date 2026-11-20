// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeping the search index (M2 slice 6) in step: posts are indexed when written, topics again
// after moderation moves them, and `postmodem search rebuild` (also run after an import)
// indexes everything. Only plain text goes in: quotes and [hide] content are left out
// (toPlainText), so search can't reveal hidden text.
import {
  foldForSearch,
  type Id,
  type PackageSearch,
  type Post,
  type Repositories,
  type SearchDocument,
} from "@postmodem/core";
import { excerpt, toPlainText } from "@postmodem/markup";

type Contributions = readonly (readonly [string, PackageSearch])[];

export function searchPlan(contributions: Contributions) {
  const omit = new Set(contributions.flatMap(([, part]) => part.omitTags ?? []));
  return {
    version: JSON.stringify(contributions.map(([key, part]) => [key, part.version]).sort()),
    omit,
    parts: contributions.map(([, part]) => part),
    filters: (params: URLSearchParams) => contributions.flatMap(([, part]) => part.filters?.(params) ?? []),
    excerpt: (source: string, max: number) => excerpt(source, max, omit),
  };
}

const basePlan = searchPlan([]);
type Plan = ReturnType<typeof searchPlan>;

/**
 * The core's search documents: public posts in public topics that haven't moved, as plain text
 * without the tags in `omit`. The external search provider (meilisearch.ts) builds the same
 * documents to index and to check its hits; packages' extra fields are added by `documents`.
 */
export function searchDocuments(
  posts: Post[],
  topics: Awaited<ReturnType<Repositories["topics"]["getMany"]>>,
  omit?: ReadonlySet<string>,
): SearchDocument[] {
  return posts.flatMap((post) => {
    const topic = topics.get(post.topicId);
    if (
      topic?.visibility !== "core:public" ||
      topic.movedToTopicId ||
      post.visibility !== "core:public" ||
      post.format !== "bbcode-phpbb2"
    )
      return [];
    return [
      {
        postId: post.id,
        topicId: post.topicId,
        nodeId: topic.nodeId,
        authorId: post.authorId,
        createdAt: post.createdAt,
        // The topic title belongs to its first post; the post's own subject to the post.
        title: foldForSearch(`${topic.firstPostId === post.id ? topic.title : ""} ${post.subject}`),
        body: foldForSearch(toPlainText(post.source, omit)),
      },
    ];
  });
}

/** The core's documents plus the fields enabled packages contribute (#39). */
async function documents(repos: Repositories, posts: Post[], plan: Plan): Promise<SearchDocument[]> {
  const topics = await repos.topics.getMany(posts.map((post) => post.topicId));
  const docs = searchDocuments(posts, topics, plan.omit);
  if (!docs.length) return docs;
  for (const part of plan.parts) {
    if (!part.fields) continue;
    const fields = await part.fields(
      docs.map((doc) => ({ ...doc })),
      repos,
    );
    for (const doc of docs) {
      const extra = fields.get(doc.postId);
      if (!extra) continue;
      if (extra.title) doc.title += ` ${foldForSearch(toPlainText(extra.title, plan.omit))}`;
      if (extra.body) doc.body += ` ${foldForSearch(toPlainText(extra.body, plan.omit))}`;
    }
  }
  return docs;
}

export async function indexPosts(repos: Repositories, posts: Post[], plan = basePlan): Promise<void> {
  if (!posts.length) return;
  await repos.transaction(async (tx) => {
    const ids = posts.map((post) => post.id);
    const current = await tx.posts.getMany(ids, { forUpdate: true });
    const docs = await documents(tx, [...current.values()], plan);
    const indexed = new Set(docs.map((doc) => doc.postId));
    await tx.search.remove(ids.filter((id) => !indexed.has(id)));
    await tx.search.index(docs);
  });
}

/** After a move, split or merge: the topic's posts may have a new topic, forum or first post. */
export async function reindexTopics(repos: Repositories, topicIds: Id[], plan = basePlan): Promise<void> {
  for (const id of new Set(topicIds)) {
    const posts = await repos.posts.allInTopic(id);
    for (let start = 0; start < posts.length; start += 500)
      await indexPosts(repos, posts.slice(start, start + 500), plan);
  }
}

export async function rebuildSearch(
  repos: Repositories,
  log: (done: number) => void = () => {},
  plan = basePlan,
  clear = true,
): Promise<number> {
  if (clear) await repos.search.clear();
  let done = 0;
  for (let after = 0; ; ) {
    const last = await repos.transaction(async (tx) => {
      const batch = await tx.posts.batchAfter(after, 500);
      if (!batch.length) return;
      await indexPosts(tx, batch, plan);
      return { count: batch.length, id: batch.at(-1)!.id };
    });
    if (!last) break;
    done += last.count;
    after = last.id;
    log(done);
  }
  await repos.search.finishRebuild(plan.version);
  return done;
}
