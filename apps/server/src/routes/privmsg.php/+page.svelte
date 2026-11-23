<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { page } from "$app/state";
  import Pagination from "#lib/components/Pagination.svelte";
  import { formatDateTime, isoDate } from "#lib/format.ts";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const sent = $derived(page.url.searchParams.get("sent") === "1");
</script>

<svelte:head>
  <title>{t("pm-title")} · {data.boardName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<h1 class="page-title">{t("pm-title")}</h1>
<nav class="pm-folders" aria-label={t("pm-folders")}>
  <a href="/privmsg.php?folder=inbox" aria-current={data.mode === "folder" && data.folder === "inbox" ? "page" : undefined}>{t("pm-inbox")}</a>
  <a href="/privmsg.php?folder=sent" aria-current={data.mode === "folder" && data.folder === "sent" ? "page" : undefined}>{t("pm-sent")}</a>
  <a class="button-link" href="/privmsg.php?mode=post" aria-current={data.mode === "post" ? "page" : undefined}>{t("pm-new")}</a>
</nav>

{#if data.mode === "folder"}
  {#if sent}<p class="panel notice" role="status">{t("pm-sent-notice")}</p>{/if}
  {#if !data.messages.length}
    <p class="panel">{t("pm-empty")}</p>
  {:else}
    <table class="forum-table pm-list">
      <caption class="visually-hidden">{data.folder === "inbox" ? t("pm-inbox") : t("pm-sent")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("pm-subject")}</th>
          <th scope="col">{data.folder === "inbox" ? t("pm-from") : t("pm-to")}</th>
          <th scope="col">{t("pm-date")}</th>
        </tr>
      </thead>
      <tbody>
        {#each data.messages as m (m.id)}
          <tr class={m.unread ? "pm-unread" : ""}>
            <th scope="row">
              <a href={`/privmsg.php?mode=read&p=${m.id}`}>{m.subject}</a>
              {#if m.unread}<span class="badge pkg-badge pkg-unread">{data.folder === "inbox" ? t("unread-new") : t("pm-not-read")}</span>{/if}
            </th>
            <td>{m.other}</td>
            <td><time datetime={isoDate(m.at)}>{formatDateTime(m.at, data.dates)}</time></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <Pagination total={data.total} perPage={data.perPage} start={data.start} href={(s) => `/privmsg.php?folder=${data.folder}${s ? `&start=${s}` : ""}`} {t} />
  {/if}
{:else if data.mode === "read"}
  <article class="panel pm-message">
    <h2>{data.message.subject}</h2>
    <p class="muted">
      {t("pm-from")}: <strong>{data.message.from}</strong> · {t("pm-to")}: {data.message.to} ·
      <time datetime={isoDate(data.message.at)}>{formatDateTime(data.message.at, data.dates)}</time>
    </p>
    <!-- Rendered by @postmodem/markup: allow-listed, sanitised HTML (ADR 0014). -->
    <div class="post-body">{@html data.message.html}</div>
    <div class="actions pm-actions">
      {#if data.message.canReply}<a class="button-link" href={`/privmsg.php?mode=post&reply=${data.message.id}`}>{t("pm-reply")}</a>{/if}
      <form method="POST" action="?/delete" class="slot-form inline">
        <input type="hidden" name="id" value={data.message.id} />
        <input type="hidden" name="folder" value={data.message.incoming ? "inbox" : "sent"} />
        <button type="submit" class="link-button">{t("pm-delete")}</button>
      </form>
    </div>
  </article>
{:else}
  {#if form?.problem}
    <p class="form-error" role="alert" id="pm-error">{t(`pm-error-${form.problem}`, { seconds: form.waitSeconds ?? 0 })}</p>
  {/if}
  {#if form?.preview}
    <div class="panel preview">
      <h2>{t("posting-preview")}</h2>
      <!-- Rendered by @postmodem/markup: allow-listed, sanitised HTML (ADR 0014). -->
      <div class="post-body">{@html form.preview}</div>
    </div>
  {/if}
  <!-- Named actions keep the query (mode, reply), so a refused message stays on this form. -->
  <form method="POST" action={`${page.url.search}&/send`} class="panel form posting" novalidate>
    <label for="to">{t("pm-to")}</label>
    <input id="to" name="to" required autocomplete="off" defaultValue={form?.values?.to ?? data.values.to} />
    <label for="subject">{t("pm-subject")}</label>
    <input id="subject" name="subject" maxlength="100" required autocomplete="off" defaultValue={form?.values?.subject ?? data.values.subject} />
    <label for="source">{t("posting-body")}</label>
    <textarea id="source" name="source" rows="12" required maxlength={data.maxLength} defaultValue={form?.values?.source ?? data.values.source}></textarea>
    <p class="muted">{t("posting-bbcode-hint")}</p>
    <div class="actions">
      <button type="submit" name="intent" value="submit">{t("pm-send")}</button>
      <button type="submit" name="intent" value="preview" class="secondary">{t("posting-preview")}</button>
    </div>
  </form>
{/if}
