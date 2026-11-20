// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeping the search index (M2 slice 6) in step: posts are indexed when written, topics again
// after moderation moves them, and `postmodem search rebuild` (also run after an import)
// indexes everything. Only plain text goes in: quotes and [hide] content are left out
// (toPlainText), so search can't reveal hidden text.
import { foldForSearch, type Id, type Post, type Repositories, type SearchDocument } from "@postmodem/core";
import { toPlainText } from "@postmodem/markup";

export function searchDocuments(
  posts: Post[],
  topics: Awaited<ReturnType<Repositories["topics"]["getMany"]>>,
): SearchDocument[] {
  return posts.flatMap((p) => {
    const t = topics.get(p.topicId);
    if (t?.visibility !== "core:public" || p.visibility !== "core:public" || p.format !== "bbcode-phpbb2")
      return [];
    return [
      {
        postId: p.id,
        topicId: p.topicId,
        nodeId: t.nodeId,
        authorId: p.authorId,
        createdAt: p.createdAt,
        // The topic title belongs to its first post; the post's own subject to the post.
        title: foldForSearch(`${t.firstPostId === p.id ? t.title : ""} ${p.subject}`),
        body: foldForSearch(toPlainText(p.source)),
      },
    ];
  });
}

export async function indexPosts(repos: Repositories, posts: Post[]): Promise<void> {
  const topics = await repos.topics.getMany(posts.map((p) => p.topicId));
  await repos.search.index(searchDocuments(posts, topics));
}

/** After a move, split or merge: the topic's posts may have a new topic, forum or first post. */
export async function reindexTopics(repos: Repositories, topicIds: Id[]): Promise<void> {
  for (const id of new Set(topicIds)) await indexPosts(repos, await repos.posts.allInTopic(id));
}

export async function rebuildSearch(
  repos: Repositories,
  log: (done: number) => void = () => {},
): Promise<number> {
  await repos.search.clear();
  let done = 0;
  for (let after = 0; ; ) {
    const batch = await repos.posts.batchAfter(after, 500);
    if (!batch.length) break;
    await repos.transaction((r) => indexPosts(r, batch));
    done += batch.length;
    after = batch.at(-1)!.id;
    log(done);
  }
  return done;
}
