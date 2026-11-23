<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import Breadcrumbs from "#lib/components/Breadcrumbs.svelte";
  import Pagination from "#lib/components/Pagination.svelte";
  import Slot from "#lib/components/Slot.svelte";
  import { formatDate, formatDateTime, isoDate } from "#lib/format.ts";
  import { links } from "#lib/links.ts";
  import { follow } from "#lib/live.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());

  // Live updates: replies others post while this page is open. Shown as a link, never
  // inserted into the page, so nothing moves under the reader.
  let fresh = $state<{ count: number; first: number } | null>(null);
  $effect(() => {
    const topicId = data.topic.id;
    const me = data.user?.id ?? null;
    fresh = null;
    return follow("core.topic", topicId, (m) => {
      const postId = Number(m.data.postId);
      if (m.event !== "post.created" || m.data.authorId === me || data.posts.some((p) => p.id === postId)) return;
      fresh = fresh ? { count: fresh.count + 1, first: fresh.first } : { count: 1, first: postId };
    });
  });
</script>

<svelte:head>
  <title>{data.topic.title} · {data.boardName}</title>
  <link rel="canonical" href={data.canonical} />
  {#if data.description}<meta name="description" content={data.description} />{/if}
  {#if data.jsonLd}{@html data.jsonLd}{/if}
</svelte:head>

<Breadcrumbs crumbs={data.breadcrumbs} current={data.topic.title} {t} />
<h1 class="page-title">
  {#if data.topic.type === "announcement"}<span class="badge">{t("topic-announcement")}</span>{/if}
  {#if data.topic.type === "sticky"}<span class="badge">{t("topic-sticky")}</span>{/if}
  {#if data.topic.locked}<span class="badge muted-badge">{t("topic-locked")}</span>{/if}
  {data.topic.title}
</h1>

<div class="topic-actions">
  {#if data.topic.canReply}<a class="button-link" href={urls.posting.reply(data.topic.id)}>{t("posting-reply")}</a>{:else if data.topic.locked}<p class="muted">{t("topic-locked-hint")}</p>{/if}
  {#if data.topic.canModerate}<a href={urls.modcp(data.topic.id)}>{t("modcp-link")}</a>{/if}
  {#if data.watching !== null}
    <form method="POST" action={`/watch?t=${data.topic.id}&on=${data.watching ? "0" : "1"}`} class="slot-form inline">
      <button type="submit" class="link-button">{data.watching ? t("watch-stop") : t("watch-start")}</button>
    </form>
  {/if}
</div>
<Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => urls.topic(data.topic, s)} {t} />

{#if data.poll}
  {@const poll = data.poll}
  <!-- A plain block, not a <section aria-labelledby> landmark (see the Firefox note in app.css). -->
  <div class="panel poll">
    <h2>{poll.question}</h2>
    {#if poll.showResults}
      <table class="poll-results">
        <caption class="visually-hidden">{t("poll-results")}</caption>
        <tbody>
          {#each poll.options as option, i (i)}
            <tr>
              <th scope="row">{option.text}</th>
              <td><meter min="0" max="100" value={option.percent} aria-label={t("poll-percent", { percent: option.percent })}></meter></td>
              <td class="num">{option.percent}%</td>
              <td class="num">{t("poll-votes", { count: option.votes })}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="muted">{t("poll-total", { count: poll.totalVotes })}</p>
    {:else}
      <ul>{#each poll.options as option, i (i)}<li>{option.text}</li>{/each}</ul>
      <p class="muted">{t("poll-hidden")}</p>
    {/if}
    {#if poll.endsAt}
      <p class="muted">
        {poll.ended ? t("poll-ended") : t("poll-ends")} <time datetime={isoDate(poll.endsAt)}>{formatDateTime(poll.endsAt, data.locale)}</time>
      </p>
    {/if}
  </div>
{/if}

<div class="posts">
  {#each data.posts as post (post.id)}
    <article class="post" id={`p${post.id}`} aria-labelledby={`p${post.id}-author`}>
      <header class="post-author">
        <strong id={`p${post.id}-author`} class="author-name">
          {#if post.authorRef}<a href={urls.user(post.authorRef)}>{post.author}</a>{:else}{post.author || t("guest")}{/if}
        </strong>
        {#if post.authorRank}
          <p class="rank">
            <span class="visually-hidden">{t("rank-label")}: </span>{post.authorRank.title}
            {#if post.authorRank.image}<img src={post.authorRank.image} alt="" referrerpolicy="no-referrer" />{/if}
          </p>
        {/if}
        {#if post.authorAvatar}
          <img class="avatar" src={post.authorAvatar} alt="" width="80" height="80" loading="lazy" referrerpolicy="no-referrer" />
        {/if}
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
          {#if post.subject}<span class="post-subject">{post.subject}</span>{/if}
        </p>
        <!-- Rendered by @postmodem/markup: allow-listed, sanitised HTML (ADR 0014). -->
        <div class="post-body">{@html post.html}</div>
        {#if post.signature}<div class="post-signature">{@html post.signature}</div>{/if}
        {#if post.editedAt && post.editCount > 0}
          <p class="muted post-edited">{t("post-edited", { count: post.editCount })} <time datetime={isoDate(post.editedAt)}>{formatDateTime(post.editedAt, data.locale)}</time></p>
        {/if}
        {#if data.topic.canReply || post.canEdit || post.canDelete || post.slots.length}
          <p class="post-actions">
            {#if data.topic.canReply}<a href={urls.posting.quote(post.id)}>{t("posting-quote")}</a>{/if}
            {#if post.canEdit}<a href={urls.posting.edit(post.id)}>{t("posting-edit-link")}</a>{/if}
            {#if post.canDelete}<a href={urls.posting.delete(post.id)}>{t("posting-delete-link")}</a>{/if}
            <Slot items={post.slots} {t} />
          </p>
        {/if}
      </div>
    </article>
  {/each}
</div>

<p class="live-notice" role="status">
  {#if fresh}<a href={urls.post(fresh.first)} data-sveltekit-reload>{t("topic-new-replies", { count: fresh.count })}</a>{/if}
</p>

<Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => urls.topic(data.topic, s)} {t} />
{#if data.afterPosts.length}<Slot items={data.afterPosts} {t} />{/if}
<div class="topic-actions">
  {#if data.topic.canReply}<a class="button-link" href={urls.posting.reply(data.topic.id)}>{t("posting-reply")}</a>{:else if data.topic.locked}<p class="muted">{t("topic-locked-hint")}</p>{/if}
  {#if data.topic.canModerate}<a href={urls.modcp(data.topic.id)}>{t("modcp-link")}</a>{/if}
</div>
