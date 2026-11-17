<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const errors = $derived((form?.errors ?? {}) as Record<string, string | undefined>);
  const rules = $derived((data.rules || t("rules-default")).split(/\n\s*\n/));
  const describedBy = (field: string, hint?: string) =>
    [hint, errors[field] ? `${field}-error` : undefined].filter(Boolean).join(" ") || undefined;
</script>

<svelte:head>
  <title>{t("register-title")} · {data.boardName}</title>
</svelte:head>

<h1 class="page-title">{t("register-title")}</h1>

<form method="POST" class="panel narrow form" novalidate>
  {#if form?.throttled}
    <p class="form-error" role="alert">{t("register-error-throttled", { minutes: form.throttled })}</p>
  {:else if Object.keys(errors).length}
    <p class="form-error" role="alert">{t("form-has-errors")}</p>
  {/if}

  <label for="username">{t("register-username")}</label>
  <input
    id="username"
    name="username"
    autocomplete="username"
    required
    minlength="2"
    maxlength="25"
    value={form?.values?.username ?? ""}
    aria-invalid={errors.username ? "true" : undefined}
    aria-describedby={describedBy("username", "username-hint")}
  />
  <p class="hint" id="username-hint">{t("register-username-hint")}</p>
  {#if errors.username}<p class="field-error" id="username-error">{t(`username-error-${errors.username}`)}</p>{/if}

  <label for="email">{t("register-email")}</label>
  <input
    id="email"
    name="email"
    type="email"
    autocomplete="email"
    required
    value={form?.values?.email ?? ""}
    aria-invalid={errors.email ? "true" : undefined}
    aria-describedby={describedBy("email", "email-hint")}
  />
  <p class="hint" id="email-hint">{t("register-email-hint")}</p>
  {#if errors.email}<p class="field-error" id="email-error">{t(`email-error-${errors.email}`)}</p>{/if}

  <label for="password">{t("register-password")}</label>
  <input
    id="password"
    name="password"
    type="password"
    autocomplete="new-password"
    required
    minlength="10"
    aria-invalid={errors.password ? "true" : undefined}
    aria-describedby={describedBy("password", "password-hint")}
  />
  <p class="hint" id="password-hint">{t("register-password-hint")}</p>
  {#if errors.password}<p class="field-error" id="password-error">{t(`password-error-${errors.password}`)}</p>{/if}

  <section class="rules" aria-labelledby="rules-title" tabindex="-1">
    <h2 id="rules-title">{t("register-rules")}</h2>
    {#each rules as paragraph, i (i)}<p>{paragraph}</p>{/each}
  </section>
  <label class="check">
    <input
      type="checkbox"
      name="rules"
      required
      aria-invalid={errors.rules ? "true" : undefined}
      aria-describedby={errors.rules ? "rules-error" : undefined}
    />
    {t("register-accept-rules")}
  </label>
  {#if errors.rules}<p class="field-error" id="rules-error">{t("rules-error-required")}</p>{/if}

  <button type="submit">{t("register-submit")}</button>
  <p class="muted">{t("register-have-account")} <a href="/login.php">{t("login-link")}</a></p>
</form>
