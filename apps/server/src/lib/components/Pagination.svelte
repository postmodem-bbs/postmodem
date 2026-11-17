<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Translate } from "@postmodem/i18n";
  import { paginate } from "#lib/pagination.ts";

  let {
    total,
    perPage,
    start,
    href,
    t,
  }: { total: number; perPage: number; start: number; href: (start: number) => string; t: Translate } = $props();
  const p = $derived(paginate(total, perPage, start));
</script>

{#if p.total > 1}
  <nav class="pagination" aria-label={t("pagination-label")}>
    <span class="pagination-status">{t("pagination-status", { current: p.current, total: p.total })}</span>
    <ul>
      {#if p.prev}<li><a href={href(p.prev.start)} rel="prev">{t("pagination-prev")}</a></li>{/if}
      {#each p.links as link, i (link ? link.number : `gap-${i}`)}
        {#if link === null}
          <li aria-hidden="true">…</li>
        {:else if link.number === p.current}
          <li><span aria-current="page">{link.number}</span></li>
        {:else}
          <li><a href={href(link.start)} aria-label={t("pagination-goto", { n: link.number })}>{link.number}</a></li>
        {/if}
      {/each}
      {#if p.next}<li><a href={href(p.next.start)} rel="next">{t("pagination-next")}</a></li>{/if}
    </ul>
  </nav>
{/if}
