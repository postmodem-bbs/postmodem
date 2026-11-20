<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import Slot from "#lib/components/Slot.svelte";
  import "../app.css";
  import { SUPPORTED, translator } from "@postmodem/i18n";
  import { invalidate } from "$app/navigation";
  import { page } from "$app/state";
  import { follow } from "#lib/live.ts";

  let { data, children } = $props();
  const t = $derived(translator(data.locale));
  const LANGUAGE_NAMES: Record<string, string> = { en: "English", pl: "Polski" };

  // Live header counts: a new private message, or a change in the reports queue (the server
  // drops subscriptions this reader may not have, so asking for the queue is harmless).
  $effect(() => {
    const id = data.user?.id;
    if (!id) return;
    const refresh = () => invalidate("pm:header");
    const stops = [follow("core.user", id, refresh), follow("reports.queue", null, refresh)];
    return () => stops.forEach((stop) => stop());
  });
</script>

<a class="skip-link" href="#main">{t("skip-to-content")}</a>

<header class="site-header">
  <div class="wrap">
    <a class="board-name" href="/">{data.boardName}</a>
    <nav aria-label={t("nav-label")}>
      <ul>
        <li><a href="/" aria-current={page.url.pathname === "/" ? "page" : undefined}>{t("nav-index")}</a></li>
        <li><a href="/search.php" aria-current={page.url.pathname === "/search.php" ? "page" : undefined}>{t("nav-search")}</a></li>
        <li><a href="/memberlist.php" aria-current={page.url.pathname === "/memberlist.php" ? "page" : undefined}>{t("nav-members")}</a></li>
      </ul>
    </nav>
    <div class="account">
      {#if data.user}
        <a href="/account" aria-current={page.url.pathname === "/account" ? "page" : undefined}>{t("signed-in-as", { name: data.user.username })}</a>
        <a href="/privmsg.php" class="slot-link" aria-current={page.url.pathname === "/privmsg.php" ? "page" : undefined}
          >{t("pm-header")}{#if data.unreadMessages}{" "}<span class="count">{data.unreadMessages}</span>{/if}</a
        >
        <Slot items={data.headerBadges} {t} />
        {#if data.isAdmin}<a href="/admin">{t("admin-link")}</a>{/if}
        <form method="POST" action="/login.php?/logout">
          <button type="submit" class="link-button">{t("logout")}</button>
        </form>
      {:else}
        <a
          href={`/login.php?redirect=${encodeURIComponent(data.returnTo)}`}
          aria-current={page.url.pathname === "/login.php" ? "page" : undefined}>{t("login-link")}</a
        >
        {#if data.registrationOpen}
          <a href="/register" aria-current={page.url.pathname === "/register" ? "page" : undefined}
            >{t("register-link")}</a
          >
        {/if}
      {/if}
    </div>
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
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener license">{t("footer-licence")}</a> ·
      <a href="/privacy">{t("privacy-link")}</a>
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
      <button type="submit" class="secondary">OK</button>
    </form>
  </div>
</footer>
