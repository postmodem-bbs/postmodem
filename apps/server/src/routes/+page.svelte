<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import ForumTable from "#lib/components/ForumTable.svelte";

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{data.boardName}</title>
</svelte:head>

<h1 class="page-title">{t("nav-index")}</h1>

{#if data.welcome}
  <p class="panel notice" role="status">{t("register-welcome", { name: data.welcome })}</p>
{/if}

{#if data.categories.length === 0}
  <p class="panel">{t("board-empty")}</p>
{/if}

{#each data.categories as cat (cat.id)}
  <section class="category" id={cat.id ? `c${cat.id}` : undefined} aria-labelledby={`c${cat.id}-title`}>
    <h2 id={`c${cat.id}-title`} class="category-title">{cat.title || data.boardName}</h2>
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
  {#if data.stats.newest}<p>{t("stats-newest", { name: data.stats.newest.name })}</p>{/if}
</section>
