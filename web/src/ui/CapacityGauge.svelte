<script lang="ts">
  // Jauge de capacité (UI §9.2.5) : taille (proportion de CONTENT_MAX) et nombre (10 crans).
  // Les chiffres viennent des constantes, jamais des textes (benchmark M5). Le dépassement de
  // taille est permis dans la liste, pour voir quoi retirer ; l'envoi est alors bloqué.
  import { CONTENT_MAX, MAX_ITEMS } from "../index";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";

  type Props = { bytes: number; count: number };
  let { bytes, count }: Props = $props();

  const lang = $derived(getLang());
  const max = $derived(formatBytes(CONTENT_MAX, lang));
  const ratio = $derived(bytes / CONTENT_MAX);
  const level = $derived(bytes > CONTENT_MAX ? "over" : ratio >= 0.9 ? "near" : "ok");
  const sizeText = $derived(t("compose.gauge.size", { size: formatBytes(bytes, lang), max }));
  const countText = $derived(t("compose.gauge.count", { n: count, max: MAX_ITEMS }));
  const uid = $props.id();
  // « Trop gros : 1 Go sur 1 Go » ne dirait rien : quand les deux tailles s'arrondissent pareil,
  // elles sont données en Mo avec une décimale (1 024 Mo sur 1 023,9 Mo).
  const mo = (n: number) => `${new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.floor((n / 1048576) * 10) / 10)}${lang === "fr" ? "\u202fMo" : "\u00a0MB"}`;
  const overText = $derived.by(() => {
    const size = formatBytes(bytes, lang);
    const same = size === max;
    return t("compose.tooBig", { size: same ? mo(bytes) : size, max: same ? mo(CONTENT_MAX) : max, excess: formatBytes(bytes - CONTENT_MAX, lang) });
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
      <div class="ticks" role="meter" aria-labelledby="{uid}-c" aria-valuemin="0" aria-valuemax={MAX_ITEMS} aria-valuenow={count} aria-valuetext={countText}>
        {#each { length: MAX_ITEMS }, i (i)}<span class={["tick", { on: i < count }]}></span>{/each}
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
  .ticks {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 3px;
  }
  .tick {
    height: 4px;
    border-radius: 2px;
    background: rgb(233 236 242 / 0.12);
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .tick.on {
    background: var(--accent);
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
    .fill,
    .tick {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .bar,
    .tick {
      background: GrayText;
    }
    .fill,
    .tick.on {
      background: Highlight;
      forced-color-adjust: none;
    }
  }
</style>
