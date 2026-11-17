<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { type SupportedLocale, translator } from "@postmodem/i18n";
  import { page } from "$app/state";

  // Layout data is present unless the layout itself failed.
  const locale = $derived((page.data.locale as SupportedLocale | undefined) ?? "en");
  const t = $derived(translator(locale));
  const kind = $derived(page.status === 404 ? "404" : page.status === 403 ? "403" : "other");
</script>

<svelte:head>
  <title>{t(`error-${kind}-title`)}</title>
</svelte:head>

<h1 class="page-title">{t(`error-${kind}-title`)}</h1>
<div class="panel">
  <p>{t(`error-${kind}-body`)}</p>
  <p><a href="/">{t("error-back")}</a></p>
</div>
