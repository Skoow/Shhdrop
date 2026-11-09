<script lang="ts">
  // Offres (pied de page « Offres Plus/Pro », retours UI5) : la comparaison Gratuit / Plus / Pro,
  // taille « par partage ». Rien n'est en vente : aucun bouton d'achat (D41-16, spec §38).
  import { t } from "../i18n/i18n.svelte";
  import { Clock } from "../ui/Icon";
  import OffersTable from "../ui/OffersTable.svelte";
</script>

<article class="offers" aria-labelledby="offers-title">
  <header class="hd">
    <h1 id="offers-title" class="title" tabindex="-1" data-large-title>{t("offers.title")}</h1>
    <p class="lede">{t("offers.lede")}</p>
  </header>
  <OffersTable />
  <p class="soon"><Clock size={16} strokeWidth={2} aria-hidden="true" /><span><b>{t("paid.soon")}</b> {t("paid.soon.body")}</span></p>
</article>

<style>
  .offers {
    display: grid;
    gap: var(--sp-5);
    max-width: 68ch;
    padding-block: var(--sp-5) var(--sp-7);
  }
  .hd {
    display: grid;
    gap: var(--sp-3);
  }
  .title {
    margin: 0;
    font-size: var(--fs-screen);
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .title:focus {
    outline: none;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    font-size: 1.125rem;
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
