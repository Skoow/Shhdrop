<script lang="ts">
  // Accueil, « Pourquoi Shhdrop » : comparaison PAR CATÉGORIES, sans aucun nom de marque. Seul
  // ce qui est vrai aujourd'hui est affirmé (le nettoyage des métadonnées n'y figure pas).
  // Ordinateur (≥ 900 px) : vrai <table> (<th scope>) ; téléphone : une carte par critère.
  import { getLang, t, type Key } from "../../i18n/i18n.svelte";
  import { limitParams } from "../../i18n/limit-params";
  import { reveal } from "../../ui/attach";
  import { Check, Minus, X } from "../../ui/Icon";

  type Level = "yes" | "some" | "no";
  type Col = "msg" | "xfer" | "shh";
  const COLS: readonly Col[] = ["msg", "xfer", "shh"];
  // Niveau de chaque case (icône) ; le texte dit toujours la nuance, l'icône n'est jamais seule.
  const ROWS: readonly { k: string; lv: Record<Col, Level> }[] = [
    { k: "account", lv: { msg: "no", xfer: "some", shh: "yes" } },
    { k: "e2e", lv: { msg: "some", xfer: "no", shh: "yes" } },
    { k: "quality", lv: { msg: "no", xfer: "yes", shh: "yes" } },
    { k: "password", lv: { msg: "no", xfer: "some", shh: "yes" } },
    { k: "erase", lv: { msg: "some", xfer: "some", shh: "yes" } },
    { k: "code", lv: { msg: "some", xfer: "some", shh: "yes" } },
    { k: "size", lv: { msg: "some", xfer: "some", shh: "yes" } },
  ];
  const cell = (k: string, c: Col) => t(`home.cmp.${k}.${c}` as Key, limitParams(getLang()));
  const colName = (c: Col) => t(`home.cmp.col.${c}` as Key);
</script>

{#snippet mark(lv: Level)}
  <span class={["mk", lv]} aria-hidden="true">
    {#if lv === "yes"}<Check size={16} strokeWidth={2.4} />{:else if lv === "some"}<Minus size={16} strokeWidth={2.4} />{:else}<X size={16} strokeWidth={2.4} />{/if}
  </span>
{/snippet}

<section class="cmp" aria-labelledby="cmp-title" data-compare>
  <div class="head rv" {@attach reveal}>
    <h2 id="cmp-title">{t("home.cmp.title")}</h2>
    <p class="lede">{t("home.cmp.lede")}</p>
  </div>

  <div class="table-wrap rv" {@attach reveal}>
    <table>
      <caption class="sr-only">{t("home.cmp.caption")}</caption>
      <thead>
        <tr>
          <th scope="col"><span class="sr-only">{t("home.cmp.col.feature")}</span></th>
          {#each COLS as c (c)}<th scope="col" class={{ shh: c === "shh" }}>{colName(c)}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each ROWS as r (r.k)}
          <tr>
            <th scope="row">{t(`home.cmp.${r.k}` as Key)}</th>
            {#each COLS as c (c)}
              <td class={{ shh: c === "shh" }}><span class="v">{@render mark(r.lv[c])}<span>{cell(r.k, c)}</span></span></td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <ul class="cards">
    {#each ROWS as r (r.k)}
      <li class="card rv" {@attach reveal}>
        <h3>{t(`home.cmp.${r.k}` as Key)}</h3>
        <dl>
          {#each COLS as c (c)}
            <div class={["line", { shh: c === "shh" }]}>
              <dt>{colName(c)}</dt>
              <dd>{@render mark(r.lv[c])}<span>{cell(r.k, c)}</span></dd>
            </div>
          {/each}
        </dl>
      </li>
    {/each}
  </ul>

  <p class="note">{t("home.cmp.note")}</p>
</section>

<style>
  .cmp {
    display: grid;
    gap: var(--sp-6);
    padding-block: 96px;
    min-width: 0;
  }
  .head {
    display: grid;
    gap: var(--sp-3);
  }
  h2,
  .lede,
  .note {
    min-width: 0;
    overflow-wrap: break-word;
  }
  h3 {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  h2 {
    font-size: var(--fs-section);
    line-height: 1.04;
    font-weight: 620;
    font-stretch: 110%;
    letter-spacing: -0.03em;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    font-size: 1.125rem;
  }

  /* ---------- Ordinateur : tableau ---------- */
  .table-wrap {
    display: none;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }
  th,
  td {
    padding: 16px 18px;
    text-align: start;
    vertical-align: top;
    border-block-end: 1px solid var(--hair);
  }
  thead th {
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
    letter-spacing: 0.02em;
    border-block-end-color: var(--hair-2);
  }
  tbody th {
    font-weight: 600;
    color: var(--text);
  }
  td {
    color: var(--text-2);
  }
  /* Colonne Shhdrop : bande teintée continue, de l'en-tête à la dernière ligne. */
  .shh {
    background: var(--accent-tint);
    color: var(--text);
  }
  thead th.shh {
    color: var(--accent);
    border-start-start-radius: var(--r-lg);
    border-start-end-radius: var(--r-lg);
  }
  tbody tr:last-child td.shh {
    border-end-start-radius: var(--r-lg);
    border-end-end-radius: var(--r-lg);
  }
  tbody tr:last-child > * {
    border-block-end: 0;
  }
  .v {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .mk {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    border-radius: var(--r-pill);
  }
  .mk.yes {
    color: var(--accent);
    background: rgb(95 227 181 / 0.14);
  }
  .mk.some {
    color: var(--text-2);
    background: rgb(233 236 242 / 0.08);
  }
  .mk.no {
    color: var(--danger);
    background: rgb(255 138 128 / 0.12);
  }

  /* ---------- Téléphone : cartes empilées ---------- */
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-3);
  }
  .card {
    min-width: 0;
    padding: 18px 18px 8px;
    border-radius: var(--r-lg);
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px var(--hair);
  }
  h3 {
    margin-bottom: var(--sp-2);
    font-size: 1.0625rem;
  }
  dl {
    margin: 0;
    display: grid;
  }
  .line {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: var(--sp-3);
    align-items: start;
    padding-block: 10px;
    border-block-start: 1px solid var(--hair);
  }
  .line.shh {
    padding-inline: 10px;
    border-radius: var(--r-md);
    border-block-start-color: transparent;
  }
  dt {
    color: var(--text-2);
    font-size: var(--fs-small);
    overflow-wrap: anywhere;
  }
  .line.shh dt {
    color: var(--accent);
    font-weight: 600;
  }
  dd {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .note {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-small);
  }

  @media (min-width: 900px) {
    .table-wrap {
      display: block;
    }
    .cards {
      display: none;
    }
    thead th:first-child {
      width: 28%;
    }
  }
  @media (forced-colors: active) {
    .shh {
      background: Canvas;
      outline: 1px solid CanvasText;
    }
  }
</style>
