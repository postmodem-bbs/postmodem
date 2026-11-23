<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const special = $derived(data.ranks.filter((r) => r.special));
  const errorFor = (action: string, id?: number) =>
    form && "error" in form && form.action === action && (id === undefined || ("id" in form && form.id === id))
      ? (form.error as string)
      : null;
</script>

<svelte:head><title>{t("admin-ranks")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-ranks")}</h1>
<p class="muted">{t("admin-ranks-intro")}</p>
{#if form && "done" in form}
  <p class="panel notice" role="status">
    {#if form.done === "assign" && "username" in form && form.username}
      {form.rank ? t("admin-rank-assigned", { name: form.username, rank: form.rank }) : t("admin-rank-unassigned", { name: form.username })}
    {:else}
      {t("admin-saved", { count: 1 })}
    {/if}
  </p>
{/if}

{#snippet fields(prefix: string, rank: { title: string; translated?: boolean; special: boolean; minPosts: number | null; imageUrl?: string | null } | null)}
  <label for={`${prefix}-title`}>{t("admin-rank-title")}</label>
  <input
    id={`${prefix}-title`}
    name="title"
    maxlength="50"
    required
    value={rank?.title ?? ""}
    aria-describedby={rank?.translated ? `${prefix}-title-hint` : undefined}
  />
  {#if rank?.translated}<p class="muted" id={`${prefix}-title-hint`}>{t("admin-rank-translated-hint")}</p>{/if}
  <fieldset class="choices">
    <legend>{t("admin-rank-kind")}</legend>
    <label class="check"><input type="radio" name="kind" value="posts" checked={!rank?.special} /> {t("admin-rank-kind-posts")}</label>
    <label class="check"><input type="radio" name="kind" value="special" checked={!!rank?.special} /> {t("admin-rank-kind-special")}</label>
  </fieldset>
  <label for={`${prefix}-min`}>{t("admin-rank-min-posts")}</label>
  <input id={`${prefix}-min`} name="minPosts" type="number" min="0" value={rank?.minPosts ?? 0} aria-describedby={`${prefix}-min-hint`} />
  <p class="muted" id={`${prefix}-min-hint`}>{t("admin-rank-min-posts-hint")}</p>
  <label for={`${prefix}-image`}>{t("admin-rank-image")}</label>
  <input id={`${prefix}-image`} name="image" type="file" accept="image/png,image/gif,image/jpeg,image/webp" aria-describedby={`${prefix}-image-hint`} />
  <p class="muted" id={`${prefix}-image-hint`}>{t("admin-rank-image-hint")}</p>
  {#if rank?.imageUrl}
    <label class="check"><input type="checkbox" name="removeImage" /> {t("admin-rank-remove-image")}</label>
  {/if}
{/snippet}

{#each data.ranks as r (r.id)}
  {@const error = errorFor("update", r.id)}
  <section class="panel" aria-label={r.title}>
    <h2>
      {r.title}
      <span class="muted">· {r.special ? t("admin-rank-special-members", { count: r.members ?? 0 }) : t("admin-rank-from-posts", { count: r.minPosts ?? 0 })}</span>
    </h2>
    {#if r.imageUrl}<p class="rank"><img src={r.imageUrl} alt={t("admin-rank-image-of", { rank: r.title })} referrerpolicy="no-referrer" /></p>{/if}
    {#if error}<p class="form-error" role="alert">{t(`admin-rank-error-${error}`)}</p>{/if}
    <details open={error ? true : undefined}>
      <summary>{t("admin-rank-edit")}</summary>
      <form method="POST" action="?/update" enctype="multipart/form-data" class="form">
        <input type="hidden" name="id" value={r.id} />
        {@render fields(`rank-${r.id}`, r)}
        <div class="actions"><button type="submit">{t("posting-save")}</button></div>
      </form>
    </details>
    <form method="POST" action="?/delete" class="slot-form">
      <input type="hidden" name="id" value={r.id} />
      <button type="submit" class="danger" aria-label={t("admin-rank-delete-named", { rank: r.title })}>{t("admin-rank-delete")}</button>
    </form>
  </section>
{:else}
  <p class="panel muted">{t("admin-ranks-none")}</p>
{/each}

<form method="POST" action="?/create" enctype="multipart/form-data" class="panel form narrow">
  <h2>{t("admin-rank-create")}</h2>
  {#if errorFor("create")}<p class="form-error" role="alert">{t(`admin-rank-error-${errorFor("create")}`)}</p>{/if}
  {@render fields("new", null)}
  <div class="actions"><button type="submit">{t("admin-create")}</button></div>
</form>

<form method="POST" action="?/assign" class="panel form narrow">
  <h2>{t("admin-rank-assign")}</h2>
  {#if errorFor("assign")}<p class="form-error" role="alert">{t(`admin-rank-error-${errorFor("assign")}`)}</p>{/if}
  <label for="assign-user">{t("admin-rank-assign-user")}</label>
  <input id="assign-user" name="username" required autocomplete="off" />
  <label for="assign-rank">{t("admin-rank-assign-rank")}</label>
  <select id="assign-rank" name="rank">
    <option value="none">{t("admin-rank-assign-none")}</option>
    {#each special as r (r.id)}<option value={r.id}>{r.title}</option>{/each}
  </select>
  <div class="actions"><button type="submit">{t("admin-rank-assign-submit")}</button></div>
</form>
