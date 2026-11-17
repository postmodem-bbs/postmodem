<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const error = $derived(form && "error" in form ? form.error : undefined);
  const linkGone = $derived(data.invalid || error === "invalid-link");
</script>

<svelte:head>
  <title>{t("reset-title")} · {data.boardName}</title>
</svelte:head>

<h1 class="page-title">{t("reset-title")}</h1>

{#if data.token && !linkGone}
  <!-- The token stays in the URL, so a rejected password re-renders this same form. -->
  <form method="POST" action={`?/set&token=${data.token}`} class="panel narrow form" novalidate>
    <input type="hidden" name="token" value={data.token} />
    <p>{t("reset-new-text", { name: data.name ?? "" })}</p>
    <label for="password">{t("reset-new-password")}</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="new-password"
      required
      minlength="10"
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? "password-hint password-error" : "password-hint"}
    />
    <p class="hint" id="password-hint">{t("register-password-hint")}</p>
    {#if error}<p class="field-error" id="password-error">{t(`password-error-${error}`)}</p>{/if}
    <button type="submit">{t("reset-submit")}</button>
  </form>
{:else if form && "requested" in form}
  <p class="panel narrow notice" role="status">{t("reset-requested")}</p>
{:else}
  <form method="POST" action="?/request" class="panel narrow form" novalidate>
    {#if linkGone}<p class="form-error" role="alert">{t("reset-invalid")}</p>{/if}
    {#if error === "throttled"}<p class="form-error" role="alert">{t("reset-error-throttled")}</p>{/if}
    <p>{t("reset-request-text")}</p>
    <label for="email">{t("register-email")}</label>
    <input
      id="email"
      name="email"
      type="email"
      autocomplete="email"
      required
      defaultValue={form && "email" in form ? form.email : ""}
      aria-invalid={error === "invalid-email" ? "true" : undefined}
      aria-describedby={error === "invalid-email" ? "email-error" : undefined}
    />
    {#if error === "invalid-email"}<p class="field-error" id="email-error">{t("email-error-invalid")}</p>{/if}
    <button type="submit">{t("reset-request-submit")}</button>
  </form>
{/if}
