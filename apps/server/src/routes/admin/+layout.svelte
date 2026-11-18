<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";
  import { page } from "$app/state";

  let { data, children } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

<div class="admin">
  <nav class="admin-nav" aria-label={t("admin-nav")}>
    <ul>
      {#each data.adminSections as s (s.path)}
        <li><a href={s.path} aria-current={page.url.pathname === s.path ? "page" : undefined}>{t(s.label)}</a></li>
      {/each}
    </ul>
  </nav>
  <div class="admin-main">{@render children()}</div>
</div>
