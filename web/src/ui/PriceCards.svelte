<script lang="ts">
  // Prix des formules (retours UI6, spec §38.8.2, D41-32) : le prix MENSUEL en grand, l'annuel
  // payé en une fois dessous (mois offerts calculés depuis PAID), puis les deux façons de payer
  // (paiement unique, ou renouvellement automatique facultatif résiliable en un clic, sans frais)
  // et « Aucun frais caché. ». Information seulement : rien n'est en vente, aucun bouton d'achat.
  import { getLang, t } from "../i18n/i18n.svelte";
  import { PAID, type PaidTier } from "../limits";
  import { Check } from "./Icon";

  let { tiers = ["plus", "pro"] }: { tiers?: readonly PaidTier[] } = $props();
  const lang = $derived(getLang());
  const eur = (v: number) => new Intl.NumberFormat(lang, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  /** Mois offerts par l'annuel : 12 mois au prix mensuel, moins le prix annuel. */
  const freeMonths = (x: PaidTier) => Math.round((12 * PAID[x].month - PAID[x].year) / PAID[x].month);
</script>

<div class="prices" data-prices>
  <ul class={["cards", { one: tiers.length === 1 }]}>
    {#each tiers as x (x)}
      <li class="card" data-price={x}>
        <p class="tier">{t(`paid.badge.${x}`)}</p>
        <p class="month num"><span class="big">{eur(PAID[x].month)}</span>{" "}<span class="unit">{t("price.month.unit")}</span></p>
        <p class="year num">{t("price.year", { year: eur(PAID[x].year) })}{#if freeMonths(x) > 0}{" "}<span class="gift">{t("price.freeMonths", { n: freeMonths(x) })}</span>{/if}</p>
      </li>
    {/each}
  </ul>
  <div class="modes">
    <p class="mh">{t("price.modes")}</p>
    <ul>
      <li><Check size={16} strokeWidth={2.2} aria-hidden="true" /><span><b>{t("price.once")}</b> {t("price.once.body")}</span></li>
      <li><Check size={16} strokeWidth={2.2} aria-hidden="true" /><span><b>{t("price.auto")}</b> {t("price.auto.body")}</span></li>
    </ul>
    <p class="hidden-fees">{t("price.noHidden")}</p>
  </div>
</div>

<style>
  .prices {
    display: grid;
    gap: var(--sp-4);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--sp-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card {
    display: grid;
    gap: var(--sp-1);
    padding: var(--sp-4);
    border: 1px solid var(--hair-2);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    box-shadow: inset 3px 0 0 var(--plus-line);
  }
  .card p {
    margin: 0;
  }
  .tier {
    color: var(--plus);
    font-weight: 680;
    font-size: var(--fs-small);
    letter-spacing: 0.02em;
  }
  .month {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--sp-2);
  }
  .big {
    color: var(--text);
    font-size: 2.25rem;
    font-weight: 680;
    font-stretch: 104%;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .unit {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .year {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px var(--sp-2);
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .gift {
    padding: 1px 8px;
    border-radius: var(--r-pill);
    background: var(--plus-tint);
    color: var(--plus);
    font-size: var(--fs-micro);
    font-weight: 620;
    white-space: nowrap;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .modes {
    display: grid;
    gap: var(--sp-2);
  }
  .modes p,
  .modes ul {
    margin: 0;
  }
  .mh {
    color: var(--text);
    font-weight: 640;
  }
  .modes ul {
    display: grid;
    gap: var(--sp-2);
    padding: 0;
    list-style: none;
  }
  .modes li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.5;
  }
  .modes li b {
    color: var(--text);
    font-weight: 620;
  }
  .modes li :global(svg) {
    flex: none;
    margin-top: 3px;
    color: var(--plus);
  }
  .hidden-fees {
    color: var(--text);
    font-size: var(--fs-small);
    font-weight: 600;
  }
</style>
