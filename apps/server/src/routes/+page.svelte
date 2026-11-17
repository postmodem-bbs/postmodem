<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{data.boardName}</title>
</svelte:head>

<section class="panel">
  <h1>{t("welcome-title", { board: data.boardName })}</h1>
  <p>{t("welcome-body")}</p>
</section>
