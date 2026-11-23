<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { links } from "#lib/links.ts";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
  const r = $derived(data.recipient);
  const values = $derived((form && "values" in form && form.values) || { subject: "", body: "", copy: false });
  const problem = $derived(form && "problem" in form ? (form.problem as string) : null);
  const on = (field: "subject" | "body") => !!problem?.startsWith(field === "body" ? "body" : "subject");
</script>

<svelte:head>
  <title>{t("member-mail-title", { name: r.username })} · {data.boardName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<p><a href={urls.user(r)}>{t("member-mail-back", { name: r.username })}</a></p>
<h1 class="page-title">{t("member-mail-title", { name: r.username })}</h1>

{#if form && "sent" in form}
  <p class="panel notice" role="status">{t("member-mail-sent", { name: r.username })}</p>
{:else}
  <form method="POST" class="panel form" novalidate>
    <p class="muted">{t("member-mail-intro", { name: r.username })}</p>
    {#if problem}<p class="form-error" role="alert">{t(`member-mail-error-${problem}`)}</p>{/if}
    <label for="mm-subject">{t("posting-subject")}</label>
    <input id="mm-subject" name="subject" maxlength="100" required value={values.subject} aria-invalid={on("subject") ? "true" : undefined} />
    <label for="mm-message">{t("posting-body")}</label>
    <textarea id="mm-message" name="message" rows="10" maxlength="5000" required aria-invalid={on("body") ? "true" : undefined}>{values.body}</textarea>
    {#if data.senderHasEmail}
      <label class="check"><input type="checkbox" name="copy" checked={values.copy} /> {t("member-mail-copy")}</label>
    {/if}
    <div class="actions"><button type="submit">{t("member-mail-send")}</button></div>
  </form>
{/if}
