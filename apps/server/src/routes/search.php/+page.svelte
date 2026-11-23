<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import Pagination from "#lib/components/Pagination.svelte";
  import { formatDateTime, isoDate } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
  const query = $derived(
    `search_keywords=${encodeURIComponent(data.form.keywords)}&search_author=${encodeURIComponent(data.form.author)}${data.form.forum ? `&search_forum=${data.form.forum}` : ""}`,
  );
</script>

<svelte:head>
  <title>{t("search-title")} · {data.boardName}</title>
  {#if data.searched}<meta name="robots" content="noindex" />{/if}
</svelte:head>

<h1 class="page-title">{t("search-title")}</h1>
<form method="GET" action="/search.php" class="panel form search-form" role="search">
  <label for="search_keywords">{t("search-keywords")}</label>
  <input id="search_keywords" name="search_keywords" type="search" maxlength="200" defaultValue={data.form.keywords} aria-describedby="search-hint" />
  <p class="muted" id="search-hint">{t("search-hint")}</p>
  <label for="search_author">{t("search-author")} <span class="muted">({t("posting-optional")})</span></label>
  <input id="search_author" name="search_author" maxlength="100" defaultValue={data.form.author} autocomplete="off" />
  <label for="search_forum">{t("search-forum")}</label>
  <select id="search_forum" name="search_forum">
    <option value="">{t("search-all-forums")}</option>
    {#each data.forums as f (f.id)}<option value={f.id} selected={data.form.forum === f.id}>{f.title}</option>{/each}
  </select>
  <div class="actions"><button type="submit">{t("search-submit")}</button></div>
</form>

{#if data.searched}
  {#if data.problem}
    <p class="form-error" role="alert">{t(`search-error-${data.problem}`, { seconds: ("seconds" in data ? data.seconds : 0) ?? 0 })}</p>
  {:else}
    <p role="status">
      {"more" in data && data.more ? t("search-found-more", { count: data.total }) : t("search-found", { count: data.total })}
    </p>
    {#if data.results.length}
      <ol class="search-results">
        {#each data.results as r (r.postId)}
          <li class="panel">
            <p>
              <a class="topic-title" href={urls.post(r.postId)}>{r.topic.title}</a>
              <span class="muted"> · <a href={urls.forum(r.forum)}>{r.forum.title}</a></span>
            </p>
            <p class="muted">{r.author} · <time datetime={isoDate(r.at)}>{formatDateTime(r.at, data.dates)}</time></p>
            <p>{r.excerpt}</p>
          </li>
        {/each}
      </ol>
      <Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => `/search.php?${query}${s ? `&start=${s}` : ""}`} {t} />
    {/if}
  {/if}
{/if}
