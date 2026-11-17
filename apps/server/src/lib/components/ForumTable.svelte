<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Translate } from "@postmodem/i18n";
  import { formatDateTime, isoDate } from "#lib/format.ts";
  import type { ForumRow } from "#lib/server/board.ts";
  import { urls } from "#lib/urls.ts";

  let { rows, caption, t, locale }: { rows: ForumRow[]; caption: string; t: Translate; locale: string } = $props();
</script>

<table class="board-table forums">
  <caption class="visually-hidden">{caption}</caption>
  <thead>
    <tr>
      <th scope="col">{t("index-forum")}</th>
      <th scope="col" class="num">{t("index-topics")}</th>
      <th scope="col" class="num">{t("index-posts")}</th>
      <th scope="col">{t("index-last-post")}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as f (f.id)}
      <tr>
        <th scope="row">
          <a class="forum-title" href={urls.forum(f.id)}>{f.title}</a>
          {#if f.locked}<span class="muted">{t("index-locked")}</span>{/if}
          {#if f.description}<p class="forum-desc">{f.description}</p>{/if}
          {#if f.subforums.length}
            <p class="subforums">
              {t("index-subforums")}:
              {#each f.subforums as s, i (s.id)}{#if i > 0},{/if} <a href={urls.forum(s.id)}>{s.title}</a>{/each}
            </p>
          {/if}
        </th>
        <td class="num">{f.topicCount}</td>
        <td class="num">{f.postCount}</td>
        <td class="last-post">
          {#if f.lastPost}
            <a href={urls.post(f.lastPost.postId)}>{f.lastPost.topicTitle}</a><br />
            <span class="muted">
              {t("by-author", { name: f.lastPost.author || t("guest") })},
              <time datetime={isoDate(f.lastPost.at)}>{formatDateTime(f.lastPost.at, locale)}</time>
            </span>
          {:else}
            <span class="muted">{t("index-no-posts")}</span>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
