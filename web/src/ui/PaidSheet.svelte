<script lang="ts">
  // Feuille d'information d'une formule payante (D41-16, spec §38.1, §38.8) : ce qu'elle
  // ajoute, son prix prévu et « Bientôt disponible ». Rien n'est en vente : aucun bouton
  // d'achat, aucun formulaire, aucune urgence ; « Compris » ferme. Chiffres lus dans PAID et
  // dans les constantes du gratuit, jamais écrits dans les textes.
  import { MAX_OPENS, PAID, TTL_MAX_HOURS, type PaidTier } from "../limits";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import Button from "./Button.svelte";
  import { Check, Clock } from "./Icon";
  import OffersTable from "./OffersTable.svelte";
  import Sheet from "./Sheet.svelte";

  type Props = { open: boolean; tier: PaidTier };
  let { open = $bindable(false), tier }: Props = $props();

  const lang = $derived(getLang());
  const name = $derived(t(`paid.badge.${tier}`));
  const p = $derived(PAID[tier]);
  const eur = (v: number) => new Intl.NumberFormat(lang, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const lines = $derived([
    t("paid.ttl", { max: t("paid.days", { n: Math.max(...p.ttlDays) }), free: formatDuration(TTL_MAX_HOURS * 3600, lang) }),
    t("paid.firstOpen.effect"),
    t("paid.opens.effect", { n: p.opens, free: MAX_OPENS }),
  ]);
</script>

<Sheet bind:open title={t("paid.title", { tier: name })}>
  <div class="paid" data-paid={tier}>
    <p class="lead">{t("paid.lead")}</p>
    <!-- Retours UI5 : la taille dite « par partage », dans la comparaison des offres (plus de chiffre seul en grand). -->
    <OffersTable highlight={tier} />
    <h3 class="h">{t("paid.unlocks", { tier: name })}</h3>
    <ul class="list">
      {#each lines as l, i (i)}<li><Check size={16} strokeWidth={2.2} aria-hidden="true" /><span class="num">{l}</span></li>{/each}
    </ul>
    <p class="price num">{t("paid.price", { month: eur(p.month), year: eur(p.year) })}</p>
    <p class="soon"><Clock size={16} strokeWidth={2} aria-hidden="true" /><span><b>{t("paid.soon")}</b> {t("paid.soon.body")}</span></p>
    <Button variant="secondary" onpress={() => void (open = false)}>{t("common.understood")}</Button>
  </div>
</Sheet>

<style>
  .paid {
    display: grid;
    gap: var(--sp-4);
  }
  .lead,
  .price {
    margin: 0;
    color: var(--text-2);
    text-wrap: pretty;
  }
  .h {
    margin: 0;
    font-size: 1rem;
    font-weight: 640;
  }
  .list {
    display: grid;
    gap: var(--sp-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .list :global(svg) {
    flex: none;
    margin-top: 3px;
    color: var(--plus);
  }
  .soon {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 0;
    padding: var(--sp-3);
    border-radius: 12px;
    background: var(--plus-tint);
    font-size: var(--fs-small);
  }
  .soon :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--plus);
  }
</style>
