<script lang="ts">
  // Comparaison des offres (retours UI5) : la taille maximale est toujours dite « par partage »
  // (« 10 Go par partage », « 50 Go par partage »), là où les offres sont comparées. Chiffres lus
  // dans les constantes (PAID, CONTENT_MAX…), jamais écrits dans les textes. `highlight` : colonne
  // de l'offre présentée (feuille Plus ou Pro).
  import { formatBytes, formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { CONTENT_MAX, MAX_OPENS, PAID, TTL_MAX_HOURS, type PaidTier } from "../limits";

  type Tier = "free" | PaidTier;
  let { highlight = null }: { highlight?: Tier | null } = $props();
  const lang = $derived(getLang());
  const TIERS: readonly Tier[] = ["free", "plus", "pro"];
  const eur = (v: number) => new Intl.NumberFormat(lang, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const name = (x: Tier) => (x === "free" ? t("offers.free") : t(`paid.badge.${x}`));
  const size = (x: Tier) => t("offers.size", { size: formatBytes(x === "free" ? CONTENT_MAX : PAID[x].bytes, lang) });
  const ttl = (x: Tier) => (x === "free" ? formatDuration(TTL_MAX_HOURS * 3600, lang) : t("paid.days", { n: Math.max(...PAID[x].ttlDays) }));
  const opens = (x: Tier) => String(x === "free" ? MAX_OPENS : PAID[x].opens);
  const price = (x: Tier) => (x === "free" ? t("offers.price.free") : t("offers.price", { month: eur(PAID[x].month), year: eur(PAID[x].year) }));
  const rows = $derived([
    { k: t("offers.row.size"), f: size },
    { k: t("offers.row.ttl"), f: ttl },
    { k: t("offers.row.opens"), f: opens },
    { k: t("offers.row.price"), f: price },
  ]);
</script>

<div class="wrap" data-offers>
  <table>
    <caption class="sr-only">{t("offers.caption")}</caption>
    <thead>
      <tr>
        <th scope="col"><span class="sr-only">{t("offers.row.label")}</span></th>
        {#each TIERS as x (x)}<th scope="col" class={[x, { hl: highlight === x }]}>{name(x)}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.k)}
        <tr>
          <th scope="row">{r.k}</th>
          {#each TIERS as x (x)}<td class={["num", x, { hl: highlight === x }]} data-tier={x}>{r.f(x)}</td>{/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    min-width: 0;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--fs-small);
  }
  th,
  td {
    padding: var(--sp-2) var(--sp-2);
    border-block-end: 1px solid var(--hair);
    text-align: start;
    vertical-align: top;
  }
  thead th {
    color: var(--text);
    font-weight: 640;
  }
  tbody th {
    color: var(--text-2);
    font-weight: 500;
  }
  td {
    color: var(--text);
  }
  /* Chaque colonne au bleu de SON offre (Plus ciel, Pro profond). */
  .plus {
    --tc: var(--plus);
    --tc-tint: var(--plus-tint);
  }
  .pro {
    --tc: var(--pro);
    --tc-tint: var(--pro-tint);
  }
  .plus,
  .pro {
    color: var(--tc);
  }
  td.plus,
  td.pro {
    color: var(--text);
  }
  .hl {
    background: var(--tc-tint);
  }
  thead .hl {
    border-start-start-radius: 10px;
    border-start-end-radius: 10px;
  }
  tbody tr:last-child .hl {
    border-end-start-radius: 10px;
    border-end-end-radius: 10px;
  }
  tbody tr:first-child td {
    font-weight: 640;
  }
</style>
