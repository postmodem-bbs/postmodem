<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { formatDate } from "#lib/format.ts";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-access")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-access")}</h1>
{#if form?.error}<p class="form-error" role="alert">{t("admin-access-error-pattern")}</p>{/if}

<h2>{t("admin-bans")}</h2>
<ul class="panel">
  {#each data.bans as b (b.id)}
    <li>
      <code>{b.kind}</code> {b.value}{#if b.expiresAt} · {t("admin-until", { date: formatDate(b.expiresAt, data.dates) })}{/if}{#if b.reason} · {b.reason}{/if}
      <form method="POST" action="?/unban" class="slot-form inline">
        <input type="hidden" name="id" value={b.id} />
        <button type="submit" class="link-button" aria-label={t("admin-remove-ban", { value: b.value })}>{t("admin-remove")}</button>
      </form>
    </li>
  {:else}
    <li class="muted">{t("admin-no-bans")}</li>
  {/each}
</ul>
<form method="POST" action="?/ban" class="panel form narrow">
  <h3>{t("admin-ban-add")}</h3>
  <label for="b-kind">{t("admin-kind")}</label>
  <select id="b-kind" name="kind"><option value="ip">IP</option><option value="email">E-mail</option></select>
  <label for="b-value">{t("admin-ban-pattern")}</label>
  <input id="b-value" name="value" required autocomplete="off" aria-describedby="b-hint" />
  <p class="muted" id="b-hint">{t("admin-ban-pattern-hint")}</p>
  <label for="b-reason">{t("modcp-reason")}</label>
  <input id="b-reason" name="reason" maxlength="500" />
  <label for="b-days">{t("admin-ban-days")}</label>
  <input id="b-days" name="days" type="number" min="0" value="0" />
  <div class="actions"><button type="submit" class="danger">{t("admin-ban")}</button></div>
</form>

<h2>{t("admin-invites")}</h2>
{#if form && "link" in form}
  <div class="panel notice" role="status">
    <p>{t("admin-invite-created")}</p>
    <p><code class="invite-link">{form.link}</code></p>
  </div>
{/if}
<ul class="panel">
  {#each data.invites as i (i.id)}
    <li>
      #{i.id} · {t("admin-invite-uses", { count: i.usesLeft })}{#if i.expiresAt} · {i.expired ? t("admin-expired") : t("admin-until", { date: formatDate(i.expiresAt, data.dates) })}{/if}{#if i.note} · {i.note}{/if}
      <form method="POST" action="?/revoke" class="slot-form inline">
        <input type="hidden" name="id" value={i.id} />
        <button type="submit" class="link-button" aria-label={t("admin-revoke-invite", { id: i.id })}>{t("admin-remove")}</button>
      </form>
    </li>
  {:else}
    <li class="muted">{t("admin-no-invites")}</li>
  {/each}
</ul>
<form method="POST" action="?/invite" class="panel form narrow">
  <h3>{t("admin-invite-create")}</h3>
  <label for="i-uses">{t("admin-invite-uses-field")}</label>
  <input id="i-uses" name="uses" type="number" min="1" value="1" />
  <label for="i-days">{t("admin-invite-days")}</label>
  <input id="i-days" name="days" type="number" min="1" value="14" />
  <label for="i-note">{t("admin-note")}</label>
  <input id="i-note" name="note" maxlength="200" />
  <div class="actions"><button type="submit">{t("admin-create")}</button></div>
</form>
