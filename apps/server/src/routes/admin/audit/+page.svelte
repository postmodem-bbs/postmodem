<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { formatDateTime, isoDate } from "#lib/format.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-audit")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-audit")}</h1>
<table class="forum-table audit">
  <caption class="visually-hidden">{t("admin-audit")}</caption>
  <thead><tr><th scope="col">{t("pm-date")}</th><th scope="col">{t("admin-actor")}</th><th scope="col">{t("admin-action")}</th><th scope="col">{t("admin-target")}</th></tr></thead>
  <tbody>
    {#each data.entries as e (e.id)}
      <tr>
        <td><time datetime={isoDate(e.at)}>{formatDateTime(e.at, data.locale)}</time></td>
        <td>{e.actor ?? t("admin-system")}</td>
        <th scope="row"><code>{e.action}</code>{#if e.details}<br /><span class="muted audit-details">{e.details}</span>{/if}</th>
        <td>{e.target}</td>
      </tr>
    {/each}
  </tbody>
</table>
