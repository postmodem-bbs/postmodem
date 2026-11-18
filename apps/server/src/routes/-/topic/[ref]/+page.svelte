<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import Breadcrumbs from "#lib/components/Breadcrumbs.svelte";
  import Pagination from "#lib/components/Pagination.svelte";
  import { formatDate, formatDateTime, isoDate } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
</script>

<svelte:head>
  <title>{data.topic.title} · {data.boardName}</title>
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<Breadcrumbs crumbs={data.breadcrumbs} current={data.topic.title} {t} />
<h1 class="page-title">
  {#if data.topic.type === "announcement"}<span class="badge">{t("topic-announcement")}</span>{/if}
  {#if data.topic.type === "sticky"}<span class="badge">{t("topic-sticky")}</span>{/if}
  {#if data.topic.locked}<span class="badge muted-badge">{t("topic-locked")}</span>{/if}
  {data.topic.title}
</h1>

<Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => urls.topic(data.topic, s)} {t} />

<div class="posts">
  {#each data.posts as post (post.id)}
    <article class="post" id={`p${post.id}`} aria-labelledby={`p${post.id}-author`}>
      <header class="post-author">
        <strong id={`p${post.id}-author`} class="author-name">
          {#if post.authorRef}<a href={urls.user(post.authorRef)}>{post.author}</a>{:else}{post.author || t("guest")}{/if}
        </strong>
        {#if post.authorRef !== null}
          <dl class="author-facts">
            {#if post.authorPosts !== null}<div><dt class="visually-hidden">{t("index-posts")}</dt><dd>{t("post-author-posts", { count: post.authorPosts })}</dd></div>{/if}
            {#if post.authorJoined !== null}
              <div><dt>{t("post-author-joined")}</dt><dd><time datetime={isoDate(post.authorJoined)}>{formatDate(post.authorJoined, data.locale)}</time></dd></div>
            {/if}
            {#if post.authorLocation}<div><dt>{t("post-author-from")}</dt><dd>{post.authorLocation}</dd></div>{/if}
          </dl>
        {/if}
      </header>
      <div class="post-main">
        <p class="post-meta">
          <a href={urls.postOnPage(data.topic, data.start, post.id)} aria-label={t("post-permalink")}>#</a>
          <time datetime={isoDate(post.at)}>{formatDateTime(post.at, data.locale)}</time>
        </p>
        <!-- Rendered by @postmodem/markup: allow-listed, sanitised HTML (ADR 0014). -->
        <div class="post-body">{@html post.html}</div>
      </div>
    </article>
  {/each}
</div>

<Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => urls.topic(data.topic, s)} {t} />
