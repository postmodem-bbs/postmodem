<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Translate } from "@postmodem/i18n";
  import { links } from "#lib/links.ts";
  import type { NodeRef } from "#lib/urls.ts";

  interface Crumb {
    id: number;
    ref: NodeRef;
    title: string;
  }
  let { crumbs, current, t }: { crumbs: Crumb[]; current?: string; t: Translate } = $props();
  const urls = $derived(links());
</script>

<nav class="breadcrumbs" aria-label={t("breadcrumb-label")}>
  <ol>
    <li><a href={urls.index()}>{t("nav-index")}</a></li>
    {#each crumbs as c (c.id)}
      <li><a href={urls.node(c.ref)}>{c.title}</a></li>
    {/each}
    {#if current}<li aria-current="page">{current}</li>{/if}
  </ol>
</nav>
