<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const errors = $derived((form?.errors ?? {}) as Record<string, string>);
  const p = $derived(data.profile);
  const v = $derived((form && "values" in form ? form.values : p) as { location: string; website: string; signature: string });
</script>

<svelte:head>
  <title>{t("account-title")} · {data.boardName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<h1 class="page-title">{t("account-title")}</h1>
<p>{t("account-intro", { name: p.username })}{#if p.email} ({p.email}){/if}</p>

<form method="POST" action="?/profile" class="panel form" novalidate>
  <h2>{t("account-profile")}</h2>
  {#if form?.section === "profile" && "saved" in form}<p class="notice" role="status">{t("account-saved")}</p>{/if}
  <label for="location">{t("post-author-from")}</label>
  <input id="location" name="location" maxlength="100" defaultValue={v.location} autocomplete="address-level2" />
  <label for="website">{t("profile-website")}</label>
  <input
    id="website"
    name="website"
    type="url"
    maxlength="200"
    defaultValue={v.website}
    autocomplete="url"
    aria-invalid={errors.website ? "true" : undefined}
    aria-describedby={errors.website ? "website-error" : undefined}
  />
  {#if errors.website}<p class="field-error" id="website-error">{t("account-error-website")}</p>{/if}
  <label for="signature">{t("account-signature")}</label>
  <textarea
    id="signature"
    name="signature"
    rows="4"
    maxlength={data.signatureMax}
    aria-invalid={errors.signature ? "true" : undefined}
    aria-describedby={errors.signature ? "signature-error signature-hint" : "signature-hint"}>{v.signature}</textarea>
  <p class="muted" id="signature-hint">{t("posting-bbcode-hint")}</p>
  {#if errors.signature}<p class="field-error" id="signature-error">{t("account-error-signature", { max: data.signatureMax })}</p>{/if}
  {#if data.signatureHtml}
    <div class="signature-preview">
      <p class="muted">{t("account-signature-now")}</p>
      <!-- Rendered by @postmodem/markup: allow-listed, sanitised HTML (ADR 0014). -->
      <div class="post-signature">{@html data.signatureHtml}</div>
    </div>
  {/if}
  <fieldset>
    <legend>{t("account-notifications")}</legend>
    <label class="check"><input type="checkbox" name="notifyPm" checked={p.notifyPm} /> {t("account-notify-pm")}</label>
    <label class="check"><input type="checkbox" name="autoWatch" checked={p.autoWatch} /> {t("account-auto-watch")}</label>
  </fieldset>
  <div class="actions"><button type="submit">{t("posting-save")}</button></div>
</form>

<form method="POST" action="?/password" class="panel form narrow" novalidate>
  <h2>{t("account-password")}</h2>
  {#if form?.section === "password" && "saved" in form}<p class="notice" role="status">{t("account-password-saved")}</p>{/if}
  <label for="current">{t("account-password-current")}</label>
  <input
    id="current"
    name="current"
    type="password"
    autocomplete="current-password"
    required
    aria-invalid={errors.current ? "true" : undefined}
    aria-describedby={errors.current ? "current-error" : undefined}
  />
  {#if errors.current}<p class="field-error" id="current-error">{t("account-error-current")}</p>{/if}
  <label for="password">{t("account-password-new")}</label>
  <input
    id="password"
    name="password"
    type="password"
    autocomplete="new-password"
    required
    minlength={data.passwordMin}
    aria-invalid={errors.password ? "true" : undefined}
    aria-describedby={errors.password ? "password-error" : undefined}
  />
  {#if errors.password}<p class="field-error" id="password-error">{t(`password-error-${errors.password}`)}</p>{/if}
  <div class="actions"><button type="submit">{t("account-password-change")}</button></div>
</form>

<!-- A plain block, not a <section aria-labelledby> landmark (the Firefox note in app.css). -->
<div class="panel your-data">
  <h2>{t("account-data")}</h2>
  <p>{t("account-data-intro")} <a href="/privacy">{t("privacy-title")}</a></p>
  <p><a class="button-link" href="/account/export" download>{t("account-export")}</a></p>
</div>

<form method="POST" action="?/delete" class="panel form narrow" novalidate>
  <h2>{t("account-delete")}</h2>
  <p>{data.postsKept ? t("account-delete-keeps-posts") : t("account-delete-removes-posts")}</p>
  <label for="delete-password">{t("account-password-current")}</label>
  <input
    id="delete-password"
    name="password"
    type="password"
    autocomplete="current-password"
    required
    aria-invalid={errors.deletePassword ? "true" : undefined}
    aria-describedby={errors.deletePassword ? "delete-password-error" : undefined}
  />
  {#if errors.deletePassword}<p class="field-error" id="delete-password-error">{t("account-error-current")}</p>{/if}
  <label class="check"><input type="checkbox" name="confirm" required aria-invalid={errors.confirm ? "true" : undefined} /> {t("account-delete-confirm")}</label>
  {#if errors.confirm}<p class="field-error">{t("account-delete-confirm-required")}</p>{/if}
  <div class="actions"><button type="submit" class="danger">{t("account-delete-submit")}</button></div>
</form>
