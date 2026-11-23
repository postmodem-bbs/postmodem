<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { LANGUAGE_NAMES, translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const errors = $derived((form?.errors ?? {}) as Record<string, string>);
  const p = $derived(data.profile);
  const r = $derived(data.regional);
  const rErrors = $derived((form?.section === "regional" ? errors : {}) as Record<string, string>);
  const v = $derived((form?.section === "profile" && "values" in form ? form.values : p) as { location: string; website: string; signature: string });
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
    {#each data.notifications as pref (pref.key)}
      {#if pref.options}
        <fieldset class="choices">
          <legend>{t(pref.label)}</legend>
          {#each pref.options as option (option)}
            <label class="check"><input type="radio" name={pref.key} value={option} checked={pref.value === option} /> {t(`${pref.label}-${option}`)}</label>
          {/each}
        </fieldset>
      {:else}
        <label class="check"><input type="checkbox" name={pref.key} checked={pref.value === true} /> {t(pref.label)}</label>
      {/if}
    {/each}
  </fieldset>
  <div class="actions"><button type="submit">{t("posting-save")}</button></div>
</form>

<form method="POST" action="?/regional" class="panel form" novalidate>
  <h2 id="regional">{t("account-regional")}</h2>
  {#if form?.section === "regional" && "saved" in form}<p class="notice" role="status">{t("account-saved")}</p>{/if}
  {#if Object.keys(rErrors).length}<p class="form-error" role="alert">{t("form-has-errors")}</p>{/if}
  <label for="language">{t("language-label")}</label>
  <select id="language" name="language" aria-invalid={rErrors.language ? "true" : undefined}>
    <option value="auto" selected={r.language === "auto"}>{t("account-language-auto")}</option>
    {#each r.languages as code (code)}
      <option value={code} selected={r.language === code} lang={code}>{LANGUAGE_NAMES[code]}</option>
    {/each}
  </select>
  <p class="muted" id="language-hint">{t("account-language-hint")}</p>
  <label for="timezone">{t("account-timezone")}</label>
  <select id="timezone" name="timezone" aria-describedby="timezone-hint" aria-invalid={rErrors.timezone ? "true" : undefined}>
    <option value="" selected={r.timezone === ""}>{t("account-timezone-board", { zone: r.boardTimeZone })}</option>
    {#each r.zoneGroups as g (g.region)}
      {#if g.region}
        <optgroup label={g.region}>
          {#each g.zones as zone (zone)}<option value={zone} selected={r.timezone === zone}>{zone.slice(g.region.length + 1).replaceAll("_", " ")}</option>{/each}
        </optgroup>
      {:else}
        {#each g.zones as zone (zone)}<option value={zone} selected={r.timezone === zone}>{zone}</option>{/each}
      {/if}
    {/each}
  </select>
  <p class="muted" id="timezone-hint">{t("account-timezone-hint")}</p>
  <fieldset class="choices">
    <legend>{t("account-date-format")}</legend>
    <label class="check"><input type="radio" name="dateFormat" value="board" checked={r.dateFormat === "board"} /> {t("account-date-format-board")} ({r.boardDateExample})</label>
    {#each r.dateExamples as d (d.style)}
      <label class="check"><input type="radio" name="dateFormat" value={d.style} checked={r.dateFormat === d.style} /> {d.example}</label>
    {/each}
  </fieldset>
  <div class="actions"><button type="submit">{t("posting-save")}</button></div>
</form>

{#if data.emailChanged}
  <p class="notice" role="status">{t("account-email-changed")}</p>
{/if}
{#if data.emailConfirmation}
  <div class="panel form narrow">
    <h2>{t("account-email-confirm")}</h2>
    {#if form?.section === "confirmEmail" && "emailError" in form}
      <p class="form-error" role="alert">{t(form.emailError === "invalid" ? "verify-invalid" : `email-error-${form.emailError}`)}</p>
    {:else if !data.emailConfirmation.token}
      <p class="form-error" role="alert">{t("verify-invalid")}</p>
    {/if}
    {#if data.emailConfirmation.token}
      <form method="POST" action={`?email-token=${data.emailConfirmation.token}&/confirmEmail`}>
        <input type="hidden" name="token" value={data.emailConfirmation.token} />
        <p>{t("account-email-confirm-text", { email: data.emailConfirmation.targetEmail ?? "" })}</p>
        <button type="submit">{t("account-email-confirm")}</button>
      </form>
    {/if}
  </div>
{/if}

<form method="POST" action="?/email" class="panel form narrow">
  <h2>{t("account-email-title")}</h2>
  <p>{t("account-email-help")}</p>
  {#if form?.section === "email" && "sent" in form}
    <p class="notice" role="status">{t("account-email-sent")}</p>
  {/if}
  {#if form?.section === "email" && "emailError" in form}
    <p class="form-error" role="alert">{t(form.emailError === "wrong" ? "account-error-current" : `email-error-${form.emailError}`)}</p>
  {/if}
  <label for="new-email">{t("account-email-new")}</label>
  <input
    id="new-email"
    name="email"
    type="email"
    autocomplete="email"
    maxlength="254"
    required
    defaultValue={form?.emailValue ?? ""}
  />
  <label for="email-current">{t("account-password-current")}</label>
  <input id="email-current" name="current" type="password" autocomplete="current-password" required />
  <div class="actions"><button type="submit">{t("account-email-send")}</button></div>
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
