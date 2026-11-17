<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Translate } from "@postmodem/i18n";
  import { urls } from "#lib/urls.ts";

  interface Crumb {
    id: number;
    title: string;
    kind: string;
  }
  let { crumbs, current, t }: { crumbs: Crumb[]; current?: string; t: Translate } = $props();
</script>

<nav class="breadcrumbs" aria-label={t("breadcrumb-label")}>
  <ol>
    <li><a href={urls.index()}>{t("nav-index")}</a></li>
    {#each crumbs as c (c.id)}
      <li><a href={c.kind === "category" ? urls.category(c.id) : urls.forum(c.id)}>{c.title}</a></li>
    {/each}
    {#if current}<li aria-current="page">{current}</li>{/if}
  </ol>
</nav>
