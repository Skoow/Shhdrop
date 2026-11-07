<script lang="ts">
  // Jauge de capacité (UI §9.2.5) : taille (proportion de CONTENT_MAX) et nombre (proportion de MAX_ITEMS).
  // Les chiffres viennent des constantes, jamais des textes (benchmark M5). Le dépassement de
  // taille est permis dans la liste, pour voir quoi retirer ; l'envoi est alors bloqué.
  import { CONTENT_MAX, MAX_ITEMS } from "../index";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import Upsell from "./Upsell.svelte";

  /** `mini` : une ligne, pour la barre d'envoi du téléphone ; `head` : en-tête de la liste. */
  /** `onpaid` : sous le dépassement, la ligne « Avec Plus… » (D41-16). */
  type Props = { bytes: number; count: number; mini?: boolean; head?: boolean; onpaid?: (tier: "plus") => void };
  let { bytes, count, mini = false, head = false, onpaid }: Props = $props();

  const lang = $derived(getLang());
  const max = $derived(formatBytes(CONTENT_MAX, lang));
  const ratio = $derived(bytes / CONTENT_MAX);
  const level = $derived(bytes > CONTENT_MAX ? "over" : ratio >= 0.9 ? "near" : "ok");
  const sizeText = $derived(t("compose.gauge.size", { size: formatBytes(bytes, lang), max }));
  const countText = $derived(t("compose.gauge.count", { n: count, max: MAX_ITEMS }));
  const uid = $props.id();
  // « Trop gros : 2 Go sur 2 Go » ne dirait rien : quand les deux tailles s'arrondissent pareil,
  // seul l'excédent est donné (« 4 octets de trop, limite : 2 Go »).
  const overText = $derived.by(() => {
    const size = formatBytes(bytes, lang);
    const excess = formatBytes(bytes - CONTENT_MAX, lang);
    return size === max ? t("compose.tooBig.excess", { excess, max }) : t("compose.tooBig", { size, max, excess });
  });

  // Annonce polie aux seuls franchissements de seuil (90 %, dépassement, retour sous la limite) ;
  // le dépassement lui-même passe par role="alert".
  let prev: string | null = null;
  $effect(() => {
    const s = level;
    if (prev !== null && s !== prev && s !== "over") announce(s === "near" ? t("compose.gauge.near") : sizeText);
    prev = s;
  });
</script>

{#if count === 0}
  <p class="empty num">{t("compose.gauge.empty", { size: max, n: MAX_ITEMS })}</p>
{:else if head}
  <div class={["gh", level]}>
    <span id="{uid}-s" class="sr-only">{t("compose.gauge.sizeLabel")}</span>
    <span id="{uid}-c" class="sr-only">{t("compose.gauge.countLabel")}</span>
    <p class="ht num">
      <span role="meter" aria-labelledby="{uid}-c" aria-valuemin="0" aria-valuemax={MAX_ITEMS} aria-valuenow={count} aria-valuetext={countText}
        ><b>{count}</b>{t("compose.capacity.count", { n: "", max: MAX_ITEMS })}</span
      ><span class="dot" aria-hidden="true">{" · "}</span><span aria-hidden="true"><b>{formatBytes(bytes, lang)}</b> / {max}</span>
    </p>
    <div class="bar" role="meter" aria-labelledby="{uid}-s" aria-valuemin="0" aria-valuemax={CONTENT_MAX} aria-valuenow={Math.min(bytes, CONTENT_MAX)} aria-valuetext={sizeText}>
      <span class="fill" style:--r={Math.min(1, ratio)}></span>
    </div>
    {#if level === "near"}<span class="near">{t("compose.gauge.near")}</span>{/if}
  </div>
  {#if level === "over"}<p class="over-msg" role="alert">{overText}</p>{#if onpaid}<Upsell {onpaid} />{/if}{/if}
{:else if mini}
  <!-- Rappel visuel de la barre du téléphone : les mesures accessibles sont dans l'en-tête. -->
  <div class={["mini", level]} aria-hidden="true">
    <div class="bar">
      <span class="fill" style:--r={Math.min(1, ratio)}></span>
    </div>
    <span class="v num" aria-hidden="true"><b>{formatBytes(bytes, lang)}</b> / {max}</span>
    <span class="v num c"><b>{count}</b> / {MAX_ITEMS}</span>
  </div>
{:else}
  <div class={["gauge", level]}>
    <div class="m">
      <span id="{uid}-s" class="sr-only">{t("compose.gauge.sizeLabel")}</span>
      <span class="v num" aria-hidden="true"><b>{formatBytes(bytes, lang)}</b> / {max}</span>
      <div
        class="bar"
        role="meter"
        aria-labelledby="{uid}-s"
        aria-valuemin="0"
        aria-valuemax={CONTENT_MAX}
        aria-valuenow={Math.min(bytes, CONTENT_MAX)}
        aria-valuetext={sizeText}
      >
        <span class="fill" style:--r={Math.min(1, ratio)}></span>
      </div>
      {#if level === "near"}<span class="near">{t("compose.gauge.near")}</span>{/if}
    </div>
    <div class="m">
      <span id="{uid}-c" class="sr-only">{t("compose.gauge.countLabel")}</span>
      <span class="v num" aria-hidden="true"><b>{count}</b> / {MAX_ITEMS}</span>
      <!-- Barre et non plus un cran par élément : MAX_ITEMS vaut 200 (D41-17). -->
      <div class="bar count" role="meter" aria-labelledby="{uid}-c" aria-valuemin="0" aria-valuemax={MAX_ITEMS} aria-valuenow={count} aria-valuetext={countText}>
        <span class="fill" style:--r={Math.min(1, count / MAX_ITEMS)}></span>
      </div>
    </div>
  </div>
  {#if level === "over"}
    <p class="over-msg" role="alert">
      {overText}
    </p>
  {/if}
{/if}

<style>
  .gh {
    display: grid;
    gap: 6px;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .ht {
    margin: 0;
    color: var(--text-2);
    font-size: 0.9375rem;
  }
  .ht b {
    color: var(--text);
    font-weight: 640;
  }
  .gh .bar {
    height: 6px;
    border-radius: 3px;
  }
  .gh.near .fill {
    background: var(--warn);
  }
  .gh.over .fill {
    background: var(--danger);
  }
  .gh.over .ht b {
    color: var(--danger);
  }
  .mini {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--sp-3);
    font-variant-numeric: tabular-nums;
  }
  .mini .c {
    padding-inline-start: var(--sp-3);
    border-inline-start: 1px solid var(--hair-2);
  }
  .mini.near .fill {
    background: var(--warn);
  }
  .mini.over .fill {
    background: var(--danger);
  }
  .mini.over .v b {
    color: var(--danger);
  }
  .empty {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .gauge {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: var(--sp-4);
    font-variant-numeric: tabular-nums;
  }
  .m {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--sp-3);
    row-gap: 2px;
    min-width: 0;
  }
  .v {
    color: var(--text-2);
    font-size: var(--fs-small);
    white-space: nowrap;
  }
  .v b {
    color: var(--text);
    font-weight: 620;
  }
  .bar {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: rgb(233 236 242 / 0.12);
  }
  .fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--accent);
    transform-origin: left center;
    transform: scaleX(var(--r));
    transition:
      transform 600ms var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }
  .near .fill {
    background: var(--warn);
  }
  .over .fill {
    background: var(--danger);
  }
  .over .v b {
    color: var(--danger);
    font-weight: 700;
  }
  .near {
    grid-column: 1 / -1;
    color: var(--warn);
    font-size: var(--fs-micro);
  }
  .over-msg {
    margin: var(--sp-2) 0 0;
    color: var(--danger);
    font-size: var(--fs-small);
    font-weight: 560;
  }
  @media (max-width: 380px) {
    .gauge {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--sp-2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .bar {
      background: GrayText;
    }
    .fill {
      background: Highlight;
      forced-color-adjust: none;
    }
  }
</style>
