<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Refusal } from "@postmodem/core";
  import { translator } from "@postmodem/i18n";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import Breadcrumbs from "#lib/components/Breadcrumbs.svelte";
  import { links } from "#lib/links.ts";

  let { data, form } = $props();
  // A package's refusal (EP-3 veto, EP-5 denial), shown in its own words.
  const refusal = $derived((form as { refusal?: Refusal | null } | null)?.refusal ?? null);
  const t = $derived(translator(data.locale));
  const urls = $derived(links());
  const values = $derived(form?.values ?? data.values);
  const heading = $derived(
    data.mode === "newtopic"
      ? t("posting-new-topic")
      : data.mode === "editpost"
        ? t("posting-edit")
        : data.mode === "delete"
          ? t("posting-delete")
          : t("posting-reply"),
  );
  // Named actions keep the mode and ids in the query string (?mode=…&t=…&/submit).
  const action = (name: string) => `${page.url.search}&/${name}`;

  // BBCode toolbar: an enhancement, shown only once JavaScript runs.
  let enhanced = $state(false);
  let textarea: HTMLTextAreaElement | undefined = $state();
  onMount(() => (enhanced = true));
  const TAGS = [
    { tag: "b", label: "B" },
    { tag: "i", label: "I" },
    { tag: "u", label: "U" },
    { tag: "quote", label: "„”" },
    { tag: "code", label: "</>" },
    // Words, not "URL"/"IMG": the visible text must match the accessible name (WCAG 2.5.3).
    { tag: "url", label: null },
    { tag: "img", label: null },
  ];
  function wrap(tag: string) {
    const el = textarea;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const open = `[${tag}]`;
    const close = `[/${tag}]`;
    el.setRangeText(`${open}${value.slice(a, b)}${close}`, a, b, "select");
    el.setSelectionRange(a + open.length, b + open.length);
    el.focus();
  }
</script>

<svelte:head>
  <title>{heading} · {data.boardName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<Breadcrumbs
  crumbs={[{ id: data.forum.id, ref: data.forum, title: data.forum.title }]}
  current={data.topic?.title ?? heading}
  {t}
/>
<h1 class="page-title">{heading}</h1>
{#if data.topic && data.mode !== "delete"}<p class="muted">{t("posting-in-topic")} <a href={urls.topic(data.topic)}>{data.topic.title}</a></p>{/if}

{#if form?.problem}
  <p class="form-error" role="alert" id="posting-error">
    {#if form.problem === "refused" && refusal}
      {t(`${refusal.package}-${refusal.code}`, refusal.params ?? {})}
    {:else}
      {t(`posting-error-${form.problem}`, { seconds: form.waitSeconds ?? 0 })}
    {/if}
  </p>
{/if}

{#if data.mode === "delete"}
  <form method="POST" action={action("delete")} class="panel narrow actions">
    <p>{t("posting-delete-confirm")}</p>
    <button type="submit" class="danger">{t("posting-delete-submit")}</button>
    <a href={data.postId ? urls.post(data.postId) : "/"}>{t("posting-cancel")}</a>
  </form>
{:else}
  {#if form?.preview}
    <div class="panel preview">
      <h2>{t("posting-preview")}</h2>
      <!-- Rendered by @postmodem/markup: allow-listed, sanitised HTML (ADR 0014). -->
      <div class="post-body">{@html form.preview}</div>
    </div>
  {/if}

  <form method="POST" action={action("submit")} class="panel form posting" novalidate>
    {#if data.editsTitle}
      <label for="title">{t("posting-title")}</label>
      <input id="title" name="title" maxlength="100" required defaultValue={values.title} autocomplete="off" />
    {:else}
      <label for="subject">{t("posting-subject")} <span class="muted">({t("posting-optional")})</span></label>
      <input id="subject" name="subject" maxlength="100" defaultValue={values.subject} autocomplete="off" />
    {/if}
    {#if data.types.length > 1}
      <label for="type">{t("posting-type")}</label>
      <select id="type" name="type">
        {#each data.types as type (type)}
          <option value={type} selected={values.type === type}>{t(`posting-type-${type}`)}</option>
        {/each}
      </select>
    {/if}

    <label for="source">{t("posting-body")}</label>
    {#if enhanced}
      <div class="toolbar" role="toolbar" aria-label={t("posting-toolbar")} aria-controls="source">
        {#each TAGS as b (b.tag)}
          <button type="button" class="secondary" onclick={() => wrap(b.tag)} aria-label={b.label ? t(`posting-tag-${b.tag}`) : undefined}>{b.label ?? t(`posting-tag-${b.tag}`)}</button>
        {/each}
      </div>
    {/if}
    <textarea
      id="source"
      name="source"
      rows="14"
      required
      maxlength={data.maxLength}
      bind:this={textarea}
      defaultValue={values.source}
      aria-describedby={form?.problem ? "posting-error source-hint" : "source-hint"}
    ></textarea>
    <p class="muted" id="source-hint">{t("posting-bbcode-hint")}</p>

    <div class="actions">
      <button type="submit" name="intent" value="submit">{data.mode === "editpost" ? t("posting-save") : t("posting-submit")}</button>
      <button type="submit" name="intent" value="preview" class="secondary">{t("posting-preview")}</button>
    </div>
  </form>
{/if}
