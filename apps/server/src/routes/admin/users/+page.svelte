<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { formatDate } from "#lib/format.ts";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-users")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-users")}</h1>
{#if form?.error}<p class="form-error" role="alert">{t(`admin-users-error-${form.error}`)}</p>{/if}
{#if form && "done" in form}<p class="panel notice" role="status">{t("admin-user-done", { name: String(form.done ?? "") })}</p>{/if}

<form method="GET" class="panel form narrow" role="search">
  <label for="q">{t("admin-users-find")}</label>
  <input id="q" name="q" value={data.q} autocomplete="off" />
  <div class="actions"><button type="submit">{t("search-submit")}</button></div>
</form>

{#each data.users as u (u.id)}
  <section class="panel admin-user" aria-label={u.name}>
    {#if data.canViewIp && u.status !== "deleted"}
      <p><a href={`/admin/users/${u.id}/ips`}>{t("ip-logging-title")}</a></p>
    {/if}
    <h2>{u.name} <span class="muted">· #{u.id} · {t(`admin-status-${u.status}`)}{#if u.banned} · {t("admin-banned")}{/if}</span></h2>
    <p class="muted">{u.email || t("admin-no-email")} · {t("posts-count", { count: u.posts })} · {t("post-author-joined")} {formatDate(u.joined, data.locale)}</p>
    <div class="admin-actions">
      {#if u.banned}
        <form method="POST" action="?/unban" class="slot-form inline"><input type="hidden" name="id" value={u.id} /><button type="submit" class="secondary">{t("admin-unban")}</button></form>
      {:else}
        <form method="POST" action="?/ban" class="form inline-form">
          <input type="hidden" name="id" value={u.id} />
          <label for={`reason-${u.id}`}>{t("modcp-reason")}</label>
          <input id={`reason-${u.id}`} name="reason" maxlength="500" />
          <label for={`days-${u.id}`}>{t("admin-ban-days")}</label>
          <input id={`days-${u.id}`} name="days" type="number" min="0" value="0" />
          <button type="submit" class="danger">{t("admin-ban")}</button>
        </form>
      {/if}
      {#if u.status === "pending"}
        <form method="POST" action="?/activate" class="slot-form inline"><input type="hidden" name="id" value={u.id} /><button type="submit" class="secondary">{t("admin-activate")}</button></form>
      {/if}
      <form method="POST" action="?/reset" class="slot-form inline"><input type="hidden" name="id" value={u.id} /><button type="submit" class="secondary">{t("admin-force-reset")}</button></form>
    </div>
  </section>
{/each}
