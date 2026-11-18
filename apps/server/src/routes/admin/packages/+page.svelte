<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-packages")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-packages")}</h1>
{#if form && "saved" in form}<p class="panel notice" role="status">{t("admin-saved", { count: 1 })}</p>{/if}
<p class="muted">{t("admin-packages-profile", { profile: data.profile })}{#if data.followsProfile} {t("admin-packages-follows")}{/if}</p>
<form method="POST" class="panel form">
  <fieldset>
    <legend>{t("admin-packages-enabled")}</legend>
    {#each data.packages as p (p.key)}
      <label class="check">
        <input type="checkbox" name="on" value={p.key} checked={p.on} />
        <span><strong>{p.name}</strong> <span class="muted">({p.key}, T{p.tier}, {p.version})</span><br />{p.description}</span>
      </label>
    {/each}
  </fieldset>
  <div class="actions"><button type="submit">{t("posting-save")}</button></div>
</form>
