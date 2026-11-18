<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const parents = $derived(data.nodes.filter((n) => n.kind !== "link"));
</script>

<svelte:head><title>{t("admin-forums")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-forums")}</h1>
{#if form?.error}<p class="form-error" role="alert">{t(`admin-forums-error-${form.error}`)}</p>{/if}
{#if form && "done" in form}<p class="panel notice" role="status">{t("admin-saved", { count: 1 })}</p>{/if}

<ul class="admin-tree">
  {#each data.nodes as n (n.id)}
    <li class="panel" style:margin-inline-start={`${n.depth * 1.5}rem`}>
      <details>
        <summary>
          <strong>{n.title}</strong>
          <span class="muted">· {t(`admin-kind-${n.kind}`)} · #{n.id}{#if n.kind === "forum"} · {t("topics-count", { count: n.topics })}{/if}{#if n.locked} · {t("topic-locked")}{/if}</span>
        </summary>
        <form method="POST" action="?/update" class="form">
          <input type="hidden" name="id" value={n.id} />
          <label for={`title-${n.id}`}>{t("admin-title-field")}</label>
          <input id={`title-${n.id}`} name="title" value={n.title} maxlength="120" required />
          <label for={`desc-${n.id}`}>{t("admin-description")}</label>
          <textarea id={`desc-${n.id}`} name="description" rows="2">{n.description}</textarea>
          <label for={`parent-${n.id}`}>{t("admin-parent")}</label>
          <select id={`parent-${n.id}`} name="parent">
            <option value="" selected={n.parentId === null}>{t("admin-top-level")}</option>
            {#each parents as p (p.id)}{#if p.id !== n.id}<option value={p.id} selected={n.parentId === p.id}>{"— ".repeat(p.depth)}{p.title}</option>{/if}{/each}
          </select>
          <label for={`pos-${n.id}`}>{t("admin-position")}</label>
          <input id={`pos-${n.id}`} name="position" type="number" min="0" value={n.position} />
          <label class="check"><input type="checkbox" name="locked" checked={n.locked} /> {t("admin-locked")}</label>
          <div class="actions"><button type="submit">{t("posting-save")}</button></div>
        </form>
        <form method="POST" action="?/delete" class="form">
          <input type="hidden" name="id" value={n.id} />
          <div class="actions"><button type="submit" class="danger">{t("admin-delete-empty")}</button></div>
        </form>
      </details>
    </li>
  {/each}
</ul>

<form method="POST" action="?/create" class="panel form narrow">
  <h2>{t("admin-forums-create")}</h2>
  <label for="new-title">{t("admin-title-field")}</label>
  <input id="new-title" name="title" maxlength="120" required />
  <label for="new-kind">{t("admin-kind")}</label>
  <select id="new-kind" name="kind">
    <option value="forum">{t("admin-kind-forum")}</option>
    <option value="category">{t("admin-kind-category")}</option>
    <option value="link">{t("admin-kind-link")}</option>
  </select>
  <label for="new-parent">{t("admin-parent")}</label>
  <select id="new-parent" name="parent">
    <option value="">{t("admin-top-level")}</option>
    {#each parents as p (p.id)}<option value={p.id}>{"— ".repeat(p.depth)}{p.title}</option>{/each}
  </select>
  <label for="new-desc">{t("admin-description")}</label>
  <textarea id="new-desc" name="description" rows="2"></textarea>
  <label for="new-url">{t("admin-link-url")} <span class="muted">({t("posting-optional")})</span></label>
  <input id="new-url" name="url" type="url" />
  <div class="actions"><button type="submit">{t("admin-create")}</button></div>
</form>
