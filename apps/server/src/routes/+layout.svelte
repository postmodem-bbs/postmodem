<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import "../app.css";
  import { SUPPORTED, translator } from "@postmodem/i18n";

  let { data, children } = $props();
  const t = $derived(translator(data.locale));
  const LANGUAGE_NAMES: Record<string, string> = { en: "English", pl: "Polski" };
</script>

<a class="skip-link" href="#main">{t("skip-to-content")}</a>

<header class="site-header">
  <div class="wrap">
    <a class="board-name" href="/">{data.boardName}</a>
    <nav aria-label={t("nav-label")}>
      <ul>
        <li><a href="/" aria-current="page">{t("nav-index")}</a></li>
      </ul>
    </nav>
  </div>
</header>

<main id="main" class="wrap" tabindex="-1">
  {@render children()}
</main>

<footer class="site-footer">
  <div class="wrap footer-grid">
    <p>
      {t("footer-powered", { product: "Postmodem", version: data.version })} ·
      <a href={data.sourceUrl} rel="noopener">{t("footer-source")}</a> ·
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener license">{t("footer-licence")}</a>
    </p>

    <form method="POST" action="/preferences" class="prefs">
      <input type="hidden" name="returnTo" value={data.returnTo} />
      <label>
        {t("language-label")}
        <select name="lang">
          {#each SUPPORTED as code (code)}
            <option value={code} selected={code === data.locale} lang={code}>{LANGUAGE_NAMES[code]}</option>
          {/each}
        </select>
      </label>
      <label>
        {t("theme-label")}
        <select name="theme">
          <option value="system" selected={data.theme === "system"}>{t("theme-system")}</option>
          <option value="light" selected={data.theme === "light"}>{t("theme-light")}</option>
          <option value="dark" selected={data.theme === "dark"}>{t("theme-dark")}</option>
        </select>
      </label>
      <button type="submit">OK</button>
    </form>
  </div>
</footer>
