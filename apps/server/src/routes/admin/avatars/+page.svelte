<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const limits = $derived({ kb: Math.round(data.limits.maxBytes / 1024), width: data.limits.maxWidth, height: data.limits.maxHeight });
  const error = $derived(form && "error" in form ? (form.error as string) : null);
</script>

<svelte:head><title>{t("admin-avatars")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-avatars")}</h1>
<p class="muted">{t("admin-avatars-intro")}</p>
{#if form && "done" in form}<p class="panel notice" role="status">{t("admin-saved", { count: 1 })}</p>{/if}
{#if error}
  <p class="form-error" role="alert">
    {error === "category" || error === "missing" ? t(`admin-avatars-error-${error}`) : t(`account-avatar-error-${error}`, limits)}
  </p>
{/if}

{#each data.categories as c (c.name)}
  <!-- Plain blocks, not landmarks: see the Firefox note in app.css (commit 03ee522). -->
  <div class="panel">
    <h2>{c.name}</h2>
    <ul class="avatar-gallery">
      {#each c.images as img (img.value)}
        <li>
          <img src={img.url} alt={img.file} loading="lazy" />
          {#if img.members}<span class="muted">{t("admin-avatars-in-use", { count: img.members })}</span>{/if}
          <form method="POST" action="?/delete" class="slot-form">
            <input type="hidden" name="image" value={img.value} />
            <button type="submit" class="danger">{t("admin-avatars-delete", { name: img.file })}</button>
          </form>
        </li>
      {/each}
    </ul>
  </div>
{:else}
  <p class="panel muted">{t("admin-avatars-none")}</p>
{/each}

<form method="POST" action="?/add" enctype="multipart/form-data" class="panel form narrow">
  <h2>{t("admin-avatars-add")}</h2>
  <label for="g-category">{t("admin-avatars-category")}</label>
  <input id="g-category" name="category" maxlength="40" required list="g-categories" aria-describedby="g-category-hint" />
  <datalist id="g-categories">{#each data.categories as c (c.name)}<option value={c.name}></option>{/each}</datalist>
  <p class="muted" id="g-category-hint">{t("admin-avatars-category-hint")}</p>
  <label for="g-file">{t("admin-avatars-image")}</label>
  <input id="g-file" name="file" type="file" required accept="image/png,image/gif,image/jpeg,image/webp" aria-describedby="g-limits" />
  <p class="muted" id="g-limits">{t("account-avatar-limits", limits)}</p>
  <div class="actions"><button type="submit">{t("admin-create")}</button></div>
</form>
