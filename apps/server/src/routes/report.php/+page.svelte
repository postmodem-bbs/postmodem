<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { page } from "$app/state";
  import { formatDateTime } from "#lib/format.ts";
  import { links } from "#lib/links.ts";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
  const action = (name: string) => `${page.url.search}&/${name}`;
</script>

<svelte:head>
  <title>{data.mode === "queue" ? t("reports-queue-title") : t("reports-title")} · {data.boardName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if data.mode === "queue"}
  <h1 class="page-title">{t("reports-queue-title")}</h1>
  {#if !data.reports.length}
    <p class="panel">{t("reports-queue-empty")}</p>
  {/if}
  <ul class="report-queue">
    {#each data.reports as r (r.id)}
      {#if form && "closed" in form && form.closed === r.id}{:else}
        <li class="panel">
          <p>
            <strong>{t("reports-by", { name: r.reporter })}</strong> · {formatDateTime(r.at, data.locale)} · {r.forum}
            {#if r.topic} · <a href={urls.topic(r.topic)}>{r.topic.title}</a>{/if}
          </p>
          <blockquote class="report-reason">{r.reason}</blockquote>
          <p class="muted">{r.author}: {r.excerpt}</p>
          <p><a href={urls.post(r.postId)}>{t("reports-view-post")}</a></p>
          <form method="POST" action={action("close")} class="form">
            <input type="hidden" name="id" value={r.id} />
            <label for={`outcome-${r.id}`}>{t("reports-outcome")} <span class="muted">({t("posting-optional")})</span></label>
            <input id={`outcome-${r.id}`} name="outcome" maxlength="500" autocomplete="off" />
            <div class="actions"><button type="submit">{t("reports-close")}</button></div>
          </form>
        </li>
      {/if}
    {/each}
  </ul>
{:else}
  <h1 class="page-title">{t("reports-title")}</h1>
  <p>{t("posting-in-topic")} <a href={urls.topic(data.topic)}>{data.topic.title}</a></p>
  <blockquote class="panel muted">{data.post.excerpt}</blockquote>
  {#if form && "sent" in form}
    <p class="panel notice" role="status">{t("reports-sent")}</p>
  {:else if data.already}
    <p class="panel notice" role="status">{t("reports-already")}</p>
  {:else}
    <form method="POST" action={action("report")} class="panel form narrow" novalidate>
      {#if form && "error" in form}<p class="form-error" role="alert" id="report-error">{t("reports-error-reason")}</p>{/if}
      <label for="reason">{t("reports-reason")}</label>
      <textarea
        id="reason"
        name="reason"
        rows="5"
        maxlength="1000"
        required
        aria-describedby={form && "error" in form ? "report-error" : undefined}>{form && "reason" in form ? form.reason : ""}</textarea>
      <div class="actions"><button type="submit">{t("reports-submit")}</button></div>
    </form>
  {/if}
{/if}
