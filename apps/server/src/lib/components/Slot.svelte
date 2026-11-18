<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- What packages add to a page (core packages.ts "slots"): data the core renders, so a package
     can't break the page's markup, accessibility or CSP. Labels are message ids. -->
<script lang="ts">
  import type { SlotItem } from "@postmodem/core";
  import type { Translate } from "@postmodem/i18n";

  let { items, t, inline = false }: { items: SlotItem[]; t: Translate; inline?: boolean } = $props();
</script>

{#each items as item (item.key)}
  {#if item.kind === "link"}
    <a class={`slot-link slot-${item.key}`} href={item.href}>
      {t(item.label)}{#if item.count !== undefined}{" "}<span class="count">{item.count}</span>{/if}
    </a>
  {:else}
    <form method="POST" action={item.action} class={inline ? `slot-form inline slot-${item.key}` : `panel form slot-form slot-${item.key}`}>
      {#if item.heading}<h2>{t(item.heading)}</h2>{/if}
      {#each item.fields as field (field.name)}
        {#if field.type === "hidden"}
          <input type="hidden" name={field.name} value={field.value ?? ""} />
        {:else}
          <label for={`${item.key}-${field.name}`}>{t(field.label)}</label>
          {#if field.type === "textarea"}
            <textarea id={`${item.key}-${field.name}`} name={field.name} rows="5" required={field.required}>{field.value ?? ""}</textarea>
          {:else}
            <input id={`${item.key}-${field.name}`} name={field.name} value={field.value ?? ""} required={field.required} />
          {/if}
        {/if}
      {/each}
      <div class="actions"><button type="submit" class={inline ? "secondary" : ""}>{t(item.submit)}</button></div>
    </form>
  {/if}
{/each}
