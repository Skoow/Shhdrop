<script lang="ts">
  // Accueil, « Pourquoi Shhdrop » : tourné vers ce que Shhdrop permet. Une seule comparaison,
  // avec les services de transfert de fichiers habituels (même usage), SANS nom de marque
  // (publicité comparative). Chaque case est défendable pour toute la catégorie : une croix
  // seulement si c'est faux en général ; sinon « Parfois » ou « Rarement », en gris.
  // Ordinateur (≥ 900 px) : vrai <table> (<th scope>), Shhdrop d'abord ; téléphone : une carte par critère.
  import { t, type Key } from "../../i18n/i18n.svelte";
  import { reveal } from "../../ui/attach";

  type Level = "yes" | "some" | "no";
  type Col = "shh" | "xfer";
  const COLS: readonly Col[] = ["shh", "xfer"];
  const ROWS: readonly { k: string; lv: Record<Col, Level> }[] = [
    { k: "account", lv: { shh: "yes", xfer: "some" } },
    { k: "e2e", lv: { shh: "yes", xfer: "some" } },
    { k: "password", lv: { shh: "yes", xfer: "some" } },
    { k: "erase", lv: { shh: "yes", xfer: "some" } },
    { k: "quality", lv: { shh: "yes", xfer: "yes" } },
    { k: "trackers", lv: { shh: "yes", xfer: "some" } },
    { k: "code", lv: { shh: "yes", xfer: "some" } },
  ];
  const cell = (k: string, c: Col) => t(`home.cmp.${k}.${c}` as Key);
  const colName = (c: Col) => t(`home.cmp.col.${c}` as Key);
  const levelName = (lv: Level) => t(`home.cmp.level.${lv}` as Key);
</script>

<!-- Icônes maison ; jamais la couleur seule : « Oui », « Non », « Parfois » lus avant le texte. -->
{#snippet mark(lv: Level, shh: boolean)}
  <span class="sr-only">{levelName(lv)}, </span>
  <span class={["mk", lv, { shh }]} aria-hidden="true">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {#if lv === "yes"}<path d="M3 7.4 5.8 10 11 4" />{:else if lv === "no"}<path d="M4 4l6 6M10 4l-6 6" />{:else}<path d="M3.5 7h7" />{/if}
    </svg>
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
              <td class={{ shh: c === "shh" }}><span class="v">{@render mark(r.lv[c], c === "shh")}<span>{cell(r.k, c)}</span></span></td>
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
              <dt>{c === "xfer" ? t("home.cmp.col.xfer.short") : colName(c)}</dt>
              <dd>{@render mark(r.lv[c], c === "shh")}<span>{cell(r.k, c)}</span></dd>
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
    overflow-wrap: anywhere;
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
  /* Coche verte pour Shhdrop ; un « oui » d'ailleurs reste gris (sobre, toujours vrai). */
  .mk.yes {
    color: var(--text-2);
    background: rgb(233 236 242 / 0.08);
  }
  .mk.yes.shh {
    color: var(--accent);
    background: rgb(95 227 181 / 0.16);
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
    padding: var(--sp-4) var(--sp-2) var(--sp-2);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px var(--hair);
  }
  h3 {
    margin: 0 var(--sp-3) var(--sp-3);
    font-size: 1.0625rem;
  }
  dl {
    margin: 0;
    display: grid;
  }
  .line {
    display: grid;
    /* Libellé de colonne court, sur une ligne ; la valeur prend le reste. */
    grid-template-columns: minmax(0, min(8.75rem, 45%)) minmax(0, 1fr);
    gap: var(--sp-3);
    align-items: start;
    padding-block: var(--sp-3);
    border-block-start: 1px solid var(--hair);
  }
  /* Toutes les lignes ont le même retrait : la ligne Shhdrop (teintée) reste alignée. */
  .line {
    padding-inline: var(--sp-3);
    border-radius: var(--r-md);
  }
  .line.shh {
    background: var(--accent-tint);
    border-block-start-color: transparent;
  }
  .line.shh + .line {
    border-block-start-color: transparent;
  }
  dt {
    /* Centré sur la première ligne de la valeur (24 px) : 14 px × 1.45 + 2 + 2. */
    padding-block-start: 2px;
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
    gap: var(--sp-2);
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
      width: 38%;
    }
  }
  @media (forced-colors: active) {
    .shh {
      background: Canvas;
      outline: 1px solid CanvasText;
    }
  }
</style>
