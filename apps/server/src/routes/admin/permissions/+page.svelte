<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { translator } from "@postmodem/i18n";

  let { data, form } = $props();
  const t = $derived(translator(data.locale));
</script>

<svelte:head><title>{t("admin-permissions")} · {data.boardName}</title></svelte:head>

<h1 class="page-title">{t("admin-permissions")}</h1>
{#if form?.error}<p class="form-error" role="alert">{t(`admin-permissions-error-${form.error}`)}</p>{/if}

<form method="GET" class="panel form">
  <h2>{t("admin-simulator")}</h2>
  <label for="sim-who">{t("admin-sim-who")}</label>
  <input id="sim-who" name="who" value={data.simulator.who} required autocomplete="off" aria-describedby="sim-hint" />
  <p class="muted" id="sim-hint">{t("admin-sim-hint")}</p>
  <label for="sim-cap">{t("admin-sim-capability")}</label>
  <select id="sim-cap" name="cap">
    {#each data.capabilities as c (c)}<option value={c} selected={data.simulator.cap === c}>{c}</option>{/each}
  </select>
  <label for="sim-node">{t("admin-sim-where")}</label>
  <select id="sim-node" name="node">
    <option value="">{t("admin-board-wide")}</option>
    {#each data.nodes as n (n.id)}<option value={n.id} selected={data.simulator.node === String(n.id)}>{n.title}</option>{/each}
  </select>
  <div class="actions"><button type="submit">{t("admin-sim-check")}</button></div>
  {#if data.explanation}
    <div role="status" class={data.explanation.allowed ? "notice" : "form-error"}>
      <p><strong>{data.explanation.allowed ? t("admin-sim-allowed") : t("admin-sim-denied")}</strong></p>
      <pre class="explain">{data.explanation.text}</pre>
    </div>
  {/if}
</form>

<table class="forum-table">
  <caption>{t("admin-grants")}</caption>
  <thead><tr><th scope="col">{t("admin-sim-where")}</th><th scope="col">{t("admin-subject")}</th><th scope="col">{t("admin-role")}</th><th scope="col"><span class="visually-hidden">{t("admin-remove")}</span></th></tr></thead>
  <tbody>
    {#each data.grants as g (g.id)}
      <tr>
        <td>{g.node ?? t("admin-board-wide")}</td>
        <td>{g.subject}</td>
        <th scope="row">{g.role}</th>
        <td>
          <form method="POST" action="?/revoke" class="slot-form inline">
            <input type="hidden" name="id" value={g.id} />
            <button type="submit" class="link-button" aria-label={t("admin-revoke-grant", { role: g.role, subject: g.subject })}>{t("admin-remove")}</button>
          </form>
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<form method="POST" action="?/grant" class="panel form narrow">
  <h2>{t("admin-grant-add")}</h2>
  <label for="gr-role">{t("admin-role")}</label>
  <select id="gr-role" name="role">{#each data.roles as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</select>
  <label for="gr-subject">{t("admin-subject")}</label>
  <select id="gr-subject" name="subject">
    <option value="everyone">everyone</option><option value="guests">guests</option><option value="registered">registered</option>
    <option value="group">{t("admin-subject-group")}</option><option value="user">{t("admin-subject-user")}</option>
  </select>
  <label for="gr-group">{t("admin-subject-group")} <span class="muted">({t("posting-optional")})</span></label>
  <select id="gr-group" name="group"><option value="">—</option>{#each data.groups as g (g.id)}<option value={g.id}>{g.name}</option>{/each}</select>
  <label for="gr-user">{t("admin-subject-user")} <span class="muted">({t("posting-optional")})</span></label>
  <input id="gr-user" name="username" autocomplete="off" />
  <label for="gr-node">{t("admin-sim-where")}</label>
  <select id="gr-node" name="node"><option value="">{t("admin-board-wide")}</option>{#each data.nodes as n (n.id)}<option value={n.id}>{n.title}</option>{/each}</select>
  <div class="actions"><button type="submit">{t("admin-add")}</button></div>
</form>
