<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const format = $derived(new Intl.DateTimeFormat(data.locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }));
</script>

<svelte:head><title>{t("ip-logging-title")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("ip-logging-title")} · {data.name}</h1>
<p><a href={`/admin/users?q=${encodeURIComponent(data.name)}`}>{t("admin-users")}</a></p>
{#if data.entries.length}
  <table class="board-table">
    <thead><tr><th scope="col">{t("ip-logging-address")}</th><th scope="col">{t("ip-logging-event")}</th><th scope="col">{t("ip-logging-time")}</th></tr></thead>
    <tbody>
      {#each data.entries as entry}
        <tr>
          <td>{entry.ip}</td>
          <td>{t(`ip-logging-kind-${entry.kind}`)}</td>
          <td><time datetime={new Date(entry.at).toISOString()}>{format.format(entry.at)}</time></td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <p>{t("ip-logging-empty")}</p>
{/if}
