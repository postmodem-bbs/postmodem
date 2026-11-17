<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head>
  <title>{t("verify-title")} · {data.boardName}</title>
</svelte:head>

<h1 class="page-title">{t("verify-title")}</h1>

<div class="panel narrow">
  {#if data.sent}
    <p role="status">{t("verify-sent")}</p>
  {:else if data.token && !form?.invalid}
    <form method="POST" class="form">
      <input type="hidden" name="token" value={data.token} />
      <p>{t("verify-confirm-text", { name: data.name ?? "" })}</p>
      <button type="submit">{t("verify-confirm-submit")}</button>
    </form>
  {:else}
    <p class="form-error" role="alert">{t("verify-invalid")}</p>
    <p><a href="/login.php">{t("login-link")}</a></p>
  {/if}
</div>
