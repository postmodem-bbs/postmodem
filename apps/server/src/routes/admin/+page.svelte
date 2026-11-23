<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { formatDateTime } from "#lib/format.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-title")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-title")}</h1>
<dl class="panel profile-facts">
  <div><dt>{t("admin-stat-users")}</dt><dd>{data.stats.users}</dd></div>
  <div><dt>{t("admin-stat-forums")}</dt><dd>{data.stats.forums}</dd></div>
  <div><dt>{t("admin-stat-topics")}</dt><dd>{data.stats.topics}</dd></div>
  <div><dt>{t("admin-stat-posts")}</dt><dd>{data.stats.posts}</dd></div>
  <div><dt>{t("admin-stat-bans")}</dt><dd>{data.stats.bans}</dd></div>
  <div><dt>{t("admin-stat-packages")}</dt><dd>{data.stats.packages}</dd></div>
  <div><dt>{t("admin-stat-version")}</dt><dd>{data.version} ({data.revision}) · {data.database} · {data.mail === "log" ? t("admin-mail-log") : "SMTP"}</dd></div>
</dl>
{#if data.mail === "log"}<p class="panel notice">{t("admin-mail-log-warning")}</p>{/if}
<h2>{t("admin-recent")}</h2>
<ul class="panel">
  {#each data.recent as e (e.id)}<li>{formatDateTime(e.at, data.dates)} · <code>{e.action}</code></li>{/each}
</ul>
