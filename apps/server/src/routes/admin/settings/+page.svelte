<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
  const id = (key: string) => key.replace(/\./g, "-");
  const errors = $derived((form?.errors ?? {}) as Record<string, string>);
</script>

<svelte:head><title>{t("admin-settings")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-settings")}</h1>
{#if form && !Object.keys(errors).length}<p class="panel notice" role="status">{t("admin-saved", { count: form.saved })}</p>{/if}
{#if Object.keys(errors).length}<p class="form-error" role="alert">{t("form-has-errors")}</p>{/if}

<form method="POST" class="admin-form" novalidate>
  {#each data.groups as g (g.label)}
    <fieldset class="panel form">
      <legend>{t(g.label)}</legend>
      {#each g.fields as f (f.key)}
        {#if f.type === "boolean"}
          <label class="check"><input type="checkbox" name={f.key} checked={f.value === true} /> {t(`setting-${id(f.key)}`)}</label>
        {:else}
          <label for={id(f.key)}>{t(`setting-${id(f.key)}`)}</label>
          {#if f.type === "textarea" || f.type === "list"}
            <textarea id={id(f.key)} name={f.key} rows={f.type === "list" ? 4 : 8} aria-invalid={errors[f.key] ? "true" : undefined}>{String(f.value ?? "")}</textarea>
          {:else if f.type === "select"}
            <select id={id(f.key)} name={f.key}>
              {#each f.options as o (o)}<option value={o} selected={f.value === o}>{o}</option>{/each}
            </select>
          {:else}
            <input id={id(f.key)} name={f.key} type={f.type === "number" ? "number" : "text"} value={String(f.value ?? "")} aria-invalid={errors[f.key] ? "true" : undefined} />
          {/if}
        {/if}
        {#if errors[f.key]}<p class="field-error">{t("admin-invalid-value")}</p>{/if}
      {/each}
    </fieldset>
  {/each}
  <div class="actions"><button type="submit">{t("posting-save")}</button></div>
</form>
