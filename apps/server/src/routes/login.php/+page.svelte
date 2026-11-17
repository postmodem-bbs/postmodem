<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{t("login-title")} · {data.boardName}</title>
</svelte:head>

<h1 class="page-title">{t("login-title")}</h1>

{#if data.signedInAs}
  <div class="panel narrow">
    <p>{t("login-signed-in-as", { name: data.signedInAs })}</p>
    <form method="POST" action="?/logout" class="actions">
      <button type="submit">{t("logout")}</button>
    </form>
    <form method="POST" action="?/logoutAll" class="actions">
      <button type="submit" class="secondary">{t("logout-everywhere")}</button>
      <p class="muted">{t("logout-everywhere-hint", { count: data.otherSessions })}</p>
    </form>
  </div>
{:else}
  <form method="POST" action="?/login" class="panel narrow form" novalidate>
    {#if form?.error}
      <p class="form-error" role="alert" id="login-error">
        {form.error === "throttled"
          ? t("login-error-throttled", { seconds: form.seconds })
          : form.error === "inactive"
            ? t("login-error-inactive")
            : t("login-error-invalid")}
      </p>
    {/if}
    <input type="hidden" name="redirect" value={form?.redirectTo ?? data.redirectTo} />
    <label for="login">{t("login-name")}</label>
    <input
      id="login"
      name="login"
      autocomplete="username"
      required
      value={form?.login ?? ""}
      aria-describedby={form?.error ? "login-error" : undefined}
    />
    <label for="password">{t("login-password")}</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">{t("login-submit")}</button>
    {#if data.registrationOpen}
      <p class="muted">{t("login-no-account")} <a href="/register">{t("register-link")}</a></p>
    {/if}
  </form>
{/if}
