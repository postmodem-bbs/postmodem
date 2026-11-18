<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import Breadcrumbs from "#lib/components/Breadcrumbs.svelte";
  import ForumTable from "#lib/components/ForumTable.svelte";
  import Pagination from "#lib/components/Pagination.svelte";
  import { formatDateTime, isoDate } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
  const crumbs = $derived(data.breadcrumbs.slice(0, -1));
  const badge = (type: string) =>
    type === "announcement" ? t("topic-announcement") : type === "sticky" ? t("topic-sticky") : null;
</script>

<svelte:head>
  <title>{data.forum.title} · {data.boardName}</title>
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<Breadcrumbs {crumbs} current={data.forum.title} {t} />
<h1 class="page-title">{data.forum.title}</h1>
{#if data.forum.description}<p class="forum-desc">{data.forum.description}</p>{/if}

{#if data.subforums.length}
  <section aria-labelledby="subforums-title">
    <h2 id="subforums-title" class="category-title">{t("index-subforums")}</h2>
    <ForumTable rows={data.subforums} caption={t("index-subforums")} {t} locale={data.locale} />
  </section>
{/if}

{#if data.forum.kind !== "category"}
  <Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => urls.forum(data.forum, s)} {t} />

  {#if data.topics.length}
    <table class="board-table topics">
      <caption class="visually-hidden">{data.forum.title}</caption>
      <thead>
        <tr>
          <th scope="col">{t("forum-topic")}</th>
          <th scope="col">{t("forum-author")}</th>
          <th scope="col" class="num">{t("forum-replies")}</th>
          <th scope="col" class="num">{t("forum-views")}</th>
          <th scope="col">{t("index-last-post")}</th>
        </tr>
      </thead>
      <tbody>
        {#each data.topics as topic (topic.id)}
          <tr class:highlight={topic.type === "announcement" || topic.type === "sticky"}>
            <th scope="row">
              {#if badge(topic.type)}<span class="badge">{badge(topic.type)}</span>{/if}
              {#if topic.locked}<span class="badge muted-badge">{t("topic-locked")}</span>{/if}
              {#if topic.movedTo}
                <span class="badge muted-badge">{t("topic-moved")}</span>
                <a href={urls.topic(topic.movedTo)}>{topic.title}</a>
              {:else}
                <a class="topic-title" href={urls.topic(topic.ref)}>{topic.title}</a>
              {/if}
            </th>
            <td>{topic.author || t("guest")}</td>
            <td class="num">{topic.replyCount}</td>
            <td class="num">{topic.viewCount}</td>
            <td class="last-post">
              {#if topic.lastPost}
                <a href={urls.post(topic.lastPost.postId)}>
                  <time datetime={isoDate(topic.lastPost.at)}>{formatDateTime(topic.lastPost.at, data.locale)}</time>
                </a><br />
                <span class="muted">{t("by-author", { name: topic.lastPost.author || t("guest") })}</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="panel">{t("forum-no-topics")}</p>
  {/if}

  <Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => urls.forum(data.forum, s)} {t} />
{/if}
