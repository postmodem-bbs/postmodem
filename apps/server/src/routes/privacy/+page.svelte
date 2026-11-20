<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const paragraphs = $derived((data.custom || t("privacy-default", { board: data.boardName })).split(/\n\s*\n/));
</script>

<svelte:head><title>{t("privacy-title")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("privacy-title")}</h1>
<div class="panel privacy">
  {#each paragraphs as p, i (i)}<p>{p}</p>{/each}
  {#each data.packages as pkg (pkg.purpose)}
    <p>{t(pkg.purpose, pkg.retentionDays === undefined ? undefined : { days: pkg.retentionDays })}</p>
  {/each}
</div>
