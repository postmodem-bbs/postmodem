<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { page } from "$app/state";
  import Breadcrumbs from "#lib/components/Breadcrumbs.svelte";
  import { formatDateTime } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
  const action = (name: string) => `${page.url.search}&/${name}`;
</script>

<svelte:head>
  <title>{t("modcp-title")} · {data.topic.title} · {data.boardName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<Breadcrumbs crumbs={[{ id: data.forum.id, ref: data.forum, title: data.forum.title }]} current={data.topic.title} {t} />
<h1 class="page-title">{t("modcp-title")}</h1>
<p>{t("posting-in-topic")} <a href={urls.topic(data.topic)}>{data.topic.title}</a></p>

{#if form?.problem}
  <p class="form-error" role="alert">{t(`modcp-error-${form.problem}`)}</p>
{/if}

{#snippet reason(id: string)}
  <label for={`reason-${id}`}>{t("modcp-reason")} <span class="muted">({t("posting-optional")})</span></label>
  <input id={`reason-${id}`} name="reason" maxlength="500" autocomplete="off" />
{/snippet}

<div class="modcp">
  {#if data.can.lock}
    <form method="POST" action={action("lock")} class="panel form">
      <h2>{data.topic.locked ? t("modcp-unlock") : t("modcp-lock")}</h2>
      <input type="hidden" name="locked" value={data.topic.locked ? "0" : "1"} />
      {@render reason("lock")}
      <div class="actions"><button type="submit">{data.topic.locked ? t("modcp-unlock") : t("modcp-lock")}</button></div>
    </form>
  {/if}

  {#if data.can.sticky || data.can.announce}
    <form method="POST" action={action("type")} class="panel form">
      <h2>{t("posting-type")}</h2>
      <label for="type">{t("posting-type")}</label>
      <select id="type" name="type">
        <option value="normal" selected={data.topic.type === "normal"}>{t("posting-type-normal")}</option>
        {#if data.can.sticky}<option value="sticky" selected={data.topic.type === "sticky"}>{t("posting-type-sticky")}</option>{/if}
        {#if data.can.announce}<option value="announcement" selected={data.topic.type === "announcement"}>{t("posting-type-announcement")}</option>{/if}
      </select>
      {@render reason("type")}
      <div class="actions"><button type="submit">{t("posting-save")}</button></div>
    </form>
  {/if}

  {#if data.can.move}
    <form method="POST" action={action("move")} class="panel form">
      <h2>{t("modcp-move")}</h2>
      <label for="move-forum">{t("modcp-move-to")}</label>
      <select id="move-forum" name="forum">
        {#each data.forums as f (f.id)}<option value={f.id} disabled={f.current}>{f.title}</option>{/each}
      </select>
      <label class="check"><input type="checkbox" name="shadow" checked /> {t("modcp-move-shadow")}</label>
      {@render reason("move")}
      <div class="actions"><button type="submit">{t("modcp-move")}</button></div>
    </form>
  {/if}

  {#if data.can.split}
    <form method="POST" action={action("merge")} class="panel form">
      <h2>{t("modcp-merge")}</h2>
      <label for="merge-target">{t("modcp-merge-target")}</label>
      <input id="merge-target" name="target" required autocomplete="off" aria-describedby="merge-hint" />
      <p class="muted" id="merge-hint">{t("modcp-merge-hint")}</p>
      {@render reason("merge")}
      <div class="actions"><button type="submit">{t("modcp-merge")}</button></div>
    </form>

    <form method="POST" action={action("split")} class="panel form">
      <h2>{t("modcp-split")}</h2>
      <fieldset>
        <legend>{t("modcp-split-posts")}</legend>
        {#each data.posts as p (p.id)}
          <label class="check split-post">
            <input type="checkbox" name="post" value={p.id} disabled={p.first} />
            <span><strong>{p.author}</strong> · {formatDateTime(p.at, data.dates)}<br /><span class="muted">{p.text}</span></span>
          </label>
        {/each}
      </fieldset>
      <label for="split-title">{t("modcp-split-title")}</label>
      <input id="split-title" name="title" maxlength="100" required autocomplete="off" />
      <label for="split-forum">{t("modcp-split-forum")}</label>
      <select id="split-forum" name="forum">
        {#each data.forums as f (f.id)}<option value={f.id} selected={f.current}>{f.title}</option>{/each}
      </select>
      {@render reason("split")}
      <div class="actions"><button type="submit">{t("modcp-split")}</button></div>
    </form>
  {/if}

  {#if data.can.delete}
    <form method="POST" action={action("delete")} class="panel form">
      <h2>{t("modcp-delete")}</h2>
      <label class="check"><input type="checkbox" name="confirm" required /> {t("modcp-delete-confirm")}</label>
      {@render reason("delete")}
      <div class="actions"><button type="submit" class="danger">{t("modcp-delete")}</button></div>
    </form>
  {/if}
</div>
