<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-groups")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-groups")}</h1>
{#if form?.error}<p class="form-error" role="alert">{t(`admin-groups-error-${form.error}`)}</p>{/if}
{#if form && "done" in form}<p class="panel notice" role="status">{t("admin-saved", { count: 1 })}</p>{/if}

{#each data.groups as g (g.id)}
  <section class="panel" aria-label={g.name}>
    <h2>{g.name} <span class="muted">· {t(`admin-group-kind-${g.kind}`)}</span></h2>
    {#if g.description}<p class="muted">{g.description}</p>{/if}
    <ul>
      {#each g.members as m (m.userId)}
        <li>
          {m.name}{#if m.role === "moderator"} · {t("admin-group-moderator")}{/if}{#if m.pending} · {t("admin-pending")}{/if}
          <form method="POST" action="?/remove" class="slot-form inline">
            <input type="hidden" name="group" value={g.id} /><input type="hidden" name="user" value={m.userId} />
            <button type="submit" class="link-button" aria-label={t("admin-remove-member", { name: m.name, group: g.name })}>{t("admin-remove")}</button>
          </form>
        </li>
      {:else}
        <li class="muted">{t("admin-no-members")}</li>
      {/each}
    </ul>
    <form method="POST" action="?/add" class="form">
      <input type="hidden" name="group" value={g.id} />
      <label for={`add-${g.id}`}>{t("admin-add-member")}</label>
      <input id={`add-${g.id}`} name="username" required autocomplete="off" />
      <label class="check"><input type="checkbox" name="moderator" /> {t("admin-group-moderator")}</label>
      <div class="actions"><button type="submit">{t("admin-add")}</button></div>
    </form>
  </section>
{/each}

<form method="POST" action="?/create" class="panel form narrow">
  <h2>{t("admin-groups-create")}</h2>
  <label for="g-name">{t("admin-name")}</label>
  <input id="g-name" name="name" maxlength="60" required />
  <label for="g-kind">{t("admin-kind")}</label>
  <select id="g-kind" name="kind">
    <option value="closed">{t("admin-group-kind-closed")}</option>
    <option value="open">{t("admin-group-kind-open")}</option>
    <option value="hidden">{t("admin-group-kind-hidden")}</option>
  </select>
  <label for="g-desc">{t("admin-description")}</label>
  <textarea id="g-desc" name="description" rows="2"></textarea>
  <div class="actions"><button type="submit">{t("admin-create")}</button></div>
</form>
