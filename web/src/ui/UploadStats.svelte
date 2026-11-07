<script lang="ts">
  // Mesures de l'envoi (UI §9.4.1, hiérarchie A28) : octets du paquet chiffré, vitesse, temps
  // restant (mis à jour au plus toutes les 2 s), puis le bloc en cours. Chiffres tabulaires.
  import { formatBytes, formatDuration, formatRate } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";

  type Props = { sent: number; total: number; rate: number | null; eta: number | null; done: number; segments: number };
  let { sent, total, rate, eta, done, segments }: Props = $props();
  const lang = $derived(getLang());

  let shownEta = $state<number | null>(null);
  let etaAt = 0;
  $effect(() => {
    const e = eta;
    if (e === null) {
      shownEta = null;
      return;
    }
    const now = Date.now();
    if (shownEta === null || now - etaAt >= 2000) {
      shownEta = e;
      etaAt = now;
    }
  });
</script>

<div class="stats num">
  <p class="main">
    <span><strong>{formatBytes(sent, lang)}</strong> / {formatBytes(total, lang)}</span>
    {#if rate !== null}<span class="dot" aria-hidden="true">·</span><strong>{formatRate(rate, lang)}</strong>{/if}
    {#if shownEta !== null}<span class="dot" aria-hidden="true">·</span><span>{shownEta < 60 ? formatDuration(shownEta, lang, { coarse: true }) : t("seal.eta", { duration: formatDuration(shownEta, lang, { coarse: true }) })}</span>{/if}
  </p>
  {#if segments > 0}<p class="detail">{t("seal.block", { done, total: segments })}</p>{/if}
</div>

<style>
  .stats {
    display: grid;
    gap: var(--sp-2);
    font-variant-numeric: tabular-nums;
  }
  p {
    margin: 0;
  }
  .main {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--sp-2);
    color: var(--text-2);
  }
  strong {
    color: var(--text);
    font-weight: 620;
  }
  .dot {
    color: var(--text-3);
  }
  .detail {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    color: var(--text-2);
  }
</style>
