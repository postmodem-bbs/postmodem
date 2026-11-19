<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { formatDateTime } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
</script>

<svelte:head>
  <title>{t("revisions-title")} · {data.topic.title} · {data.boardName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<h1 class="page-title">{t("revisions-title")}</h1>
<p>
  <a href={urls.post(data.post.id)}>{t("revisions-back")}</a> · <a href={urls.topic(data.topic)}>{data.topic.title}</a>
</p>

<div class="panel revision">
  <h2>{t("revisions-current")}</h2>
  {#if data.post.subject}<p><strong>{data.post.subject}</strong></p>{/if}
  <div class="post-body">{@html data.post.html}</div>
</div>

{#each data.versions as v (v.id)}
  <div class="panel revision">
    <h2>
      {t("revisions-replaced", { when: formatDateTime(v.replacedAt, data.locale) })}{#if v.editor}
        · {t("revisions-by", { name: v.editor })}{/if}
    </h2>
    {#if v.subject}<p><strong>{v.subject}</strong></p>{/if}
    <div class="post-body">{@html v.html}</div>
  </div>
{/each}
