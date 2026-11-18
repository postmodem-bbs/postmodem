<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import BoardIndex from "#lib/components/BoardIndex.svelte";
  import Slot from "#lib/components/Slot.svelte";

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{data.boardName}</title>
</svelte:head>

<h1 class="page-title">{t("nav-index")}</h1>

{#if data.notice}
  <p class="panel notice" role="status">
    {data.notice.kind === "welcome"
      ? t("register-welcome", { name: data.notice.name })
      : data.notice.kind === "verified"
        ? t("verified-notice", { name: data.notice.name })
        : t("reset-done-notice")}
  </p>
{/if}

{#if data.tools.length}<div class="topic-actions tools"><Slot items={data.tools} {t} inline /></div>{/if}
<BoardIndex {data} {t} />
