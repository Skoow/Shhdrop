<script lang="ts">
  // Ligne discrète sous une limite gratuite atteinte (D41-16, spec §38.1 : « une ligne neutre
  // quand il atteint une limite ») : ce que Plus permettrait, et « En savoir plus » qui ouvre la
  // feuille d'information. Jamais de fenêtre imposée, d'urgence ni de compte à rebours.
  import { PAID } from "../limits";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";

  type Props = { onpaid: (tier: "plus") => void };
  let { onpaid }: Props = $props();
  const lang = $derived(getLang());
  const parts = $derived(t("paid.upsell", { size: "\u0000", days: t("paid.days", { n: Math.max(...PAID.plus.ttlDays) }) }).split("\u0000"));
</script>

<p class="upsell num" data-upsell>
  <!-- Le stockage maximal de l'offre ressort (retours UI4). -->
  <span>{parts[0]}<b class="size">{formatBytes(PAID.plus.bytes, lang)}</b>{parts[1]}</span>
  <button type="button" class="more" aria-haspopup="dialog" onclick={() => onpaid("plus")}>{t("paid.upsell.more")}</button>
</p>

<style>
  .upsell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: var(--sp-2);
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .size {
    color: var(--plus);
    font-weight: 680;
  }
  .more {
    min-height: 44px;
    padding: 0 2px;
    border: 0;
    background: none;
    color: var(--plus);
    font: inherit;
    font-weight: 560;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
</style>
