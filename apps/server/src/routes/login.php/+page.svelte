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
            : form.error === "banned"
              ? `${t("banned-title")}${"reason" in form && form.reason ? ` ${t("banned-reason")} ${form.reason}` : ""}`
            : form.error === "unverified"
              ? t("login-error-unverified")
              : t("login-error-invalid")}
      </p>
    {/if}
    {#if form && "resent" in form}
      <p class="panel notice" role="status">{t("login-resent")}</p>
    {/if}
    <input type="hidden" name="redirect" value={form?.redirectTo ?? data.redirectTo} />
    <label for="login">{t("login-name")}</label>
    <input
      id="login"
      name="login"
      autocomplete="username"
      required
      defaultValue={form?.login ?? ""}
      aria-describedby={form?.error ? "login-error" : undefined}
    />
    <label for="password">{t("login-password")}</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">{t("login-submit")}</button>
    <p><a href="/reset">{t("login-forgot")}</a></p>
    {#if data.registrationOpen}
      <p class="muted">{t("login-no-account")} <a href="/register">{t("register-link")}</a></p>
    {/if}
  </form>
  {#if data.demo}
    <section class="panel narrow demo-accounts" aria-labelledby="demo-title">
      <h2 id="demo-title">{t("login-demo-title")}</h2>
      <p>{t("login-demo-intro", { password: data.demo.password })}</p>
      <ul>
        {#each data.demo.accounts as account (account.username)}
          <li>
            <form method="POST" action="?/login">
              <input type="hidden" name="login" value={account.username} />
              <input type="hidden" name="password" value={data.demo.password} />
              <input type="hidden" name="redirect" value={form?.redirectTo ?? data.redirectTo} />
              <button type="submit" class="demo-signin">{t("login-demo-as", { name: account.username })}</button>
              <span class="muted">{t(`login-demo-${account.role}`)}</span>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
  {#if form && "error" in form && form.error === "unverified"}
    <form method="POST" action="?/resend" class="panel narrow actions">
      <input type="hidden" name="login" value={form.login} />
      <button type="submit" class="secondary">{t("login-resend")}</button>
    </form>
  {/if}
{/if}
