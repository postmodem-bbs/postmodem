<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import Pagination from "#lib/components/Pagination.svelte";
  import { formatDate, isoDate } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
  const href = (mode: string, order: string, start = 0) =>
    `/memberlist.php?mode=${mode}&order=${order.toUpperCase()}${start ? `&start=${start}` : ""}`;
  const sortLink = (mode: string) => href(mode, data.mode === mode && data.order === "asc" ? "desc" : mode === "posts" ? "desc" : "asc");
  const sorted = (mode: string) => (data.mode === mode ? (data.order === "asc" ? "ascending" : "descending") : undefined);
</script>

<svelte:head>
  <title>{t("members-title")} · {data.boardName}</title>
</svelte:head>

<h1 class="page-title">{t("members-title")}</h1>
<p>{t("users-count", { count: data.total })}</p>
<table class="forum-table">
  <caption class="visually-hidden">{t("members-title")}</caption>
  <thead>
    <tr>
      <th scope="col" aria-sort={sorted("username")}><a href={sortLink("username")}>{t("members-name")}</a></th>
      <th scope="col" aria-sort={sorted("joined")}><a href={sortLink("joined")}>{t("post-author-joined")}</a></th>
      <th scope="col" class="num" aria-sort={sorted("posts")}><a href={sortLink("posts")}>{t("index-posts")}</a></th>
      <th scope="col">{t("post-author-from")}</th>
    </tr>
  </thead>
  <tbody>
    {#each data.members as m (m.ref.id)}
      <tr>
        <th scope="row"><a href={urls.user(m.ref)}>{m.name}</a></th>
        <td><time datetime={isoDate(m.joined)}>{formatDate(m.joined, data.dates)}</time></td>
        <td class="num">{m.posts}</td>
        <td>{m.location}</td>
      </tr>
    {/each}
  </tbody>
</table>
<Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => href(data.mode, data.order, s)} {t} />
