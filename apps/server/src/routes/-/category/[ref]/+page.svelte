<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import BoardIndex from "#lib/components/BoardIndex.svelte";
  import Breadcrumbs from "#lib/components/Breadcrumbs.svelte";

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{data.category?.title} · {data.boardName}</title>
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<Breadcrumbs crumbs={data.breadcrumbs} current={data.category?.title} {t} />
<h1 class="page-title">{data.category?.title}</h1>
{#if data.category?.description}<p class="forum-desc">{data.category.description}</p>{/if}
<BoardIndex {data} {t} />
