<script lang="ts">
  import { t } from "../i18n/i18n.svelte";
  import { Lock } from "./Icon";

  // UI §20.4 (K10) : boucle de 6,4 s rangée dans l'ambiance : pause onglet caché et hors écran,
  // retirée en mouvement réduit (état fixe : paquet scellé au départ, trait plein).
  let el: HTMLDivElement | undefined = $state();
  let onscreen = $state(true);
  let hidden = $state(document.hidden);
  $effect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (onscreen = e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  });
</script>

<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<!--
  UI §9.1 : le mécanisme en une ligne. Votre appareil — chiffré — serveur (ne lit rien) —
  chiffré — destinataire. Un paquet scellé traverse le serveur sans jamais s'ouvrir.
  Le dessin ne porte que le nom accessible (role="img", aria-label). Les libellés visibles sont
  en HTML, en unités relatives : ils grandissent avec la taille de texte et passent à la ligne au
  lieu de se chevaucher (WCAG 1.4.4). Ils sont cachés aux lecteurs d'écran, qui lisent l'aria-label.
-->
<div class={["schema", { still: hidden || !onscreen }]} bind:this={el}>
  <div class="enc" aria-hidden="true">
    <span data-label>{t("schema.encrypted")}</span>
    <span data-label>{t("schema.encrypted")}</span>
  </div>

  <div class="track" role="img" aria-label={t("schema.label")} data-ambient>
    <span class="line"></span>
    <span class="trail"></span>
    <span class="node a"><i></i></span>
    <span class="node b"><i></i><i></i><i></i></span>
    <span class="node c"><i></i></span>
    <span class="packet"><Lock size={15} strokeWidth={2.2} aria-hidden="true" /></span>
  </div>

  <div class="nodes" aria-hidden="true">
    <span class="node-l start"><span data-label>{t("schema.device")}</span></span>
    <span class="node-l mid">
      <span data-label class="strong">{t("schema.server")}</span>
      <span data-label class="quiet">{t("schema.blind")}</span>
    </span>
    <span class="node-l end"><span data-label>{t("schema.recipient")}</span></span>
  </div>
</div>

<style>
  .schema {
    container-type: inline-size;
    display: grid;
    gap: var(--sp-2);
    max-width: 560px;
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    font-weight: var(--fw-small);
  }

  [data-label] {
    overflow-wrap: anywhere;
    hyphens: auto;
  }

  /* « chiffré » centré au-dessus de chaque moitié du trait (25 % et 75 %). */
  .enc {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-items: center;
    text-align: center;
    color: var(--accent);
    font-size: var(--fs-micro);
    line-height: var(--lh-micro);
    font-weight: var(--fw-micro);
  }

  .track {
    position: relative;
    height: 44px;
  }
  .line,
  .trail {
    position: absolute;
    left: 10px;
    right: 10px;
    top: 21px;
    height: 2px;
    border-radius: 2px;
  }
  .line {
    background: var(--hair-2);
  }
  .trail {
    background: var(--accent);
    transform-origin: left;
    opacity: 0.55;
  }
  .node {
    position: absolute;
    top: 10px;
    display: grid;
    place-items: center;
    height: 24px;
    border-radius: 8px;
    background: var(--surface-2);
    box-shadow: 0 0 0 1px var(--line-strong);
  }
  .a,
  .c {
    width: 18px;
  }
  .a {
    left: 0;
  }
  .c {
    right: 0;
  }
  .a i,
  .c i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--accent);
  }
  /* Serveur : capsule opaque, contenu masqué. */
  .b {
    left: 50%;
    top: 8px;
    width: 56px;
    height: 28px;
    margin-left: -28px;
    gap: 4px;
    grid-auto-flow: column;
    border-radius: 14px;
  }
  .b i {
    position: relative;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-3);
  }
  /* Les points s'allument en menthe au passage du paquet (opacité seulement). */
  .b i::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--accent);
    opacity: 0;
  }
  .packet {
    position: absolute;
    left: 0;
    top: 8px;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: 0 6px 14px -6px rgb(0 0 0 / 0.8);
    transform: translateX(-5px);
  }

  @media (prefers-reduced-motion: no-preference) {
    .packet {
      animation: packet 6.4s var(--ease-in-out) 1.2s infinite both;
    }
    .trail {
      animation: trail 6.4s var(--ease-in-out) 1.2s infinite both;
    }
    .b i::after {
      animation: blink 6.4s linear 1.2s infinite both;
    }
    .b i:nth-child(2)::after {
      animation-delay: 1.32s;
    }
    .b i:nth-child(3)::after {
      animation-delay: 1.44s;
    }
    .still .packet,
    .still .trail,
    .still .b i::after {
      animation-play-state: paused;
    }
  }
  @keyframes packet {
    0% {
      transform: translateX(-5px) scale(0.6);
      opacity: 0;
    }
    8% {
      transform: translateX(-5px) scale(1);
      opacity: 1;
    }
    38%,
    52% {
      transform: translateX(calc(50cqw - 14px)) scale(1);
    }
    88% {
      transform: translateX(calc(100cqw - 23px)) scale(1);
      opacity: 1;
    }
    96%,
    100% {
      transform: translateX(calc(100cqw - 23px)) scale(0.6);
      opacity: 0;
    }
  }
  @keyframes trail {
    0%,
    6% {
      transform: scaleX(0);
      opacity: 0.55;
    }
    88% {
      transform: scaleX(1);
      opacity: 0.55;
    }
    100% {
      transform: scaleX(1);
      opacity: 0;
    }
  }
  @keyframes blink {
    0%,
    38% {
      opacity: 0;
    }
    42%,
    50% {
      opacity: 1;
    }
    54%,
    100% {
      opacity: 0;
    }
  }

  /* Sous les trois nœuds : début, milieu, fin. Colonnes latérales égales : le milieu est centré. */
  .nodes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: var(--sp-2);
    color: var(--text-2);
  }
  .node-l {
    min-width: 0;
  }
  .end {
    text-align: end;
  }
  .mid {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .strong {
    color: var(--text);
    font-weight: 560;
  }
  /* --text-3 jamais sur l'aurore (K5). */
  .quiet {
    color: var(--text-2);
  }

  /* Texte agrandi (ou écran très étroit) : les libellés passent en liste, dans l'ordre du trait. */
  @container (max-width: 17.5rem) {
    .nodes {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--sp-1);
    }
    .end {
      text-align: start;
    }
    .mid {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 0.4em;
      text-align: start;
    }
  }

  @media (prefers-contrast: more) {
    .line {
      background: var(--line-strong);
    }
  }
  @media (forced-colors: active) {
    .line {
      background: CanvasText;
    }
    .trail,
    .packet {
      background: Highlight;
      color: HighlightText;
    }
    .node {
      background: Canvas;
      box-shadow: none;
      border: 1px solid CanvasText;
    }
    .a i,
    .c i {
      background: Highlight;
    }
    .b i {
      background: CanvasText;
    }
    .b i::after {
      display: none;
    }
  }
</style>
