<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-trash-view")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-trash-view")} · {data.forum.title}</h1>
<p><a href="/admin/forums">{t("admin-forums")}</a></p>
{#if form?.restored}<p role="status">{t("admin-trash-restored")}</p>{/if}
{#if form?.restored === false}<p role="alert">{t("admin-trash-restore-error")}</p>{/if}
{#if data.trash.length === 0}<p>{t("admin-trash-empty")}</p>{/if}
<ul>
  {#each data.trash as topic (topic.id)}
    <li class="panel">
      <form class="form" method="POST" action={`?/restore&forum=${data.forum.id}&page=${data.page}`}>
        <input type="hidden" name="topic" value={topic.id} />
        <label for={`restore-${topic.id}`}>{t("admin-trash-restore-to", { title: topic.title })}</label>
        <select id={`restore-${topic.id}`} name="destination" required>
          <option value="" selected disabled>{t("admin-trash-pick-forum")}</option>
          {#each data.forums as forum (forum.id)}
            <option value={forum.id}>{forum.title}</option>
          {/each}
        </select>
        <div class="actions"><button type="submit">{t("admin-trash-restore")}</button></div>
      </form>
    </li>
  {/each}
</ul>
{#if data.page > 1}<a href={`?forum=${data.forum.id}&page=${data.page - 1}`}>{t("pagination-prev")}</a>{/if}
{#if data.hasNext}<a href={`?forum=${data.forum.id}&page=${data.page + 1}`}>{t("pagination-next")}</a>{/if}
