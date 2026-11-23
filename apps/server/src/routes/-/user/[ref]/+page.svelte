<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import Breadcrumbs from "#lib/components/Breadcrumbs.svelte";
  import { formatDate, isoDate } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const p = $derived(data.profile);
  const c = $derived(data.contact);
  const urls = $derived(links());
</script>

<svelte:head>
  <title>{t("profile-title", { name: p.username })} · {data.boardName}</title>
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<Breadcrumbs crumbs={[]} current={p.username} {t} />
<h1 class="page-title">{t("profile-title", { name: p.username })}</h1>

<div class="panel profile">
  {#if p.avatar}<img class="avatar" src={p.avatar} alt={t("profile-avatar", { name: p.username })} referrerpolicy="no-referrer" />{/if}
  <dl class="profile-facts">
    <div><dt>{t("post-author-joined")}</dt><dd><time datetime={isoDate(p.joined)}>{formatDate(p.joined, data.dates)}</time></dd></div>
    {#if p.lastSeen}
      <div><dt>{t("profile-last-seen")}</dt><dd><time datetime={isoDate(p.lastSeen)}>{formatDate(p.lastSeen, data.dates)}</time></dd></div>
    {/if}
    {#if p.rank}
      <div>
        <dt>{t("rank-label")}</dt>
        <dd class="rank">{#if p.rank.image}<img src={p.rank.image} alt="" referrerpolicy="no-referrer" />{/if}{p.rank.title}</dd>
      </div>
    {/if}
    <div><dt>{t("index-posts")}</dt><dd>{p.posts}</dd></div>
    {#if p.location}<div><dt>{t("post-author-from")}</dt><dd>{p.location}</dd></div>{/if}
    {#if p.website}
      <div><dt>{t("profile-website")}</dt><dd><a href={p.website} rel="nofollow ugc noopener">{p.website}</a></dd></div>
    {/if}
  </dl>
</div>

<div class="panel contact">
  <h2>{t("profile-contact", { name: p.username })}</h2>
  <ul>
    {#if !c.self && c.message}
      <li><a href={`/privmsg.php?mode=post&u=${encodeURIComponent(p.username)}`}>{t("profile-send-message")}</a></li>
    {/if}
    {#if !c.self && c.email}<li><a href={`/email/${p.id}`}>{t("profile-send-email")}</a></li>{/if}
    <li><a href={`/search.php?search_author=${encodeURIComponent(p.username)}`}>{t("profile-find-posts", { name: p.username })}</a></li>
  </ul>
</div>

{#if p.signature}
  <div class="panel">
    <h2>{t("account-signature")}</h2>
    <!-- Rendered by @postmodem/markup: allow-listed, sanitised HTML (ADR 0014). -->
    <div class="post-signature">{@html p.signature}</div>
  </div>
{/if}

<div class="panel recent">
  <h2>{t("profile-recent-topics")}</h2>
  {#if data.recentTopics.length}
    <ul class="recent-topics">
      {#each data.recentTopics as topic (topic.ref.id)}
        <li>
          <a href={urls.topic(topic.ref)}>{topic.title}</a>
          <span class="muted">· {topic.forum} · <time datetime={isoDate(topic.at)}>{formatDate(topic.at, data.dates)}</time></span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t("profile-no-topics")}</p>
  {/if}
</div>
