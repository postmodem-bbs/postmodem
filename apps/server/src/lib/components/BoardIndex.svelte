<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Categories with their forums and the board statistics: the index, and one category of it. -->
<script lang="ts">
  import type { Translate } from "@postmodem/i18n";
  import ForumTable from "#lib/components/ForumTable.svelte";
  import { links } from "#lib/links.ts";
  import type { ForumRow } from "#lib/server/board.ts";
  import type { NodeRef, UserRef } from "#lib/urls.ts";

  interface IndexData {
    boardName: string;
    locale: string;
    categories: { id: number; ref: NodeRef | null; title: string; forums: ForumRow[] }[];
    stats: {
      posts: number;
      topics: number;
      users: number;
      newest: { ref: UserRef; name: string } | null;
      online: { count: number; users: { ref: UserRef; name: string }[]; minutes: number };
    };
  }
  let { data, t }: { data: IndexData; t: Translate } = $props();
  const urls = $derived(links());
</script>

{#if data.categories.length === 0}
  <p class="panel">{t("board-empty")}</p>
{/if}

{#each data.categories as cat (cat.id)}
  <section class="category" id={cat.id ? `c${cat.id}` : undefined} aria-labelledby={`c${cat.id}-title`}>
    <h2 id={`c${cat.id}-title`} class="category-title">
      {#if cat.ref}<a href={urls.category(cat.ref)}>{cat.title}</a>{:else}{data.boardName}{/if}
    </h2>
    <ForumTable rows={cat.forums} caption={cat.title || data.boardName} {t} locale={data.locale} />
  </section>
{/each}

<section class="panel stats" aria-labelledby="stats-title">
  <h2 id="stats-title">{t("stats-heading")}</h2>
  <p>
    {t("stats-totals", {
      posts: t("posts-count", { count: data.stats.posts }),
      topics: t("topics-count", { count: data.stats.topics }),
      users: t("users-count", { count: data.stats.users }),
    })}
  </p>
  {#if data.stats.newest}
    <p>
      {t("stats-newest-label")}
      <a href={urls.user(data.stats.newest.ref)}>{data.stats.newest.name}</a>
    </p>
  {/if}
  <p class="online">
    {t("stats-online", { count: data.stats.online.count, minutes: data.stats.online.minutes })}{#if data.stats.online.users.length}&nbsp;—
      {#each data.stats.online.users as u, i (u.ref.id)}{#if i > 0}{", "}{/if}<a href={urls.user(u.ref)}>{u.name}</a>{/each}
    {/if}
  </p>
</section>
