<script lang="ts">
  // Accueil v4, appel final (UI §9.1, §20.11) : la capsule du logo, en grand, remplie de texte
  // chiffré décoratif (S1) ; quand elle entre dans l'écran, un sceau guilloché vient fermer son
  // ouverture et le contour se referme. Titre et bouton « Commencer » (anse du cadenas qui se ferme
  // au survol et au focus), au centre de la capsule ; rien n'y redit ce que la page a déjà dit.
  import { t } from "../../i18n/i18n.svelte";
  import { ambient, reveal } from "../../ui/attach";
  import { cipherText, rosette } from "../../ui/decor";
  import { capPath } from "../../ui/motion";
  import SectionBg from "../../ui/SectionBg.svelte";

  let { onstart }: { onstart: () => void } = $props();
  let w = $state(0);
  let h = $state(0);
  // Même rayon que le CSS (200 px, 56 px sous 600 px de large).
  const d = $derived(w > 0 && h > 0 ? capPath(w, h, Math.min(h / 2, w < 560 ? 56 : 200)) : "");
  const glyphs = cipherText(8191, 120, 18);
  const ring = rosette(30, 1.5, 5, 48);
  const ring2 = rosette(33, 1.5, 3.5, 48, 1.02);
</script>

<section class="end" aria-labelledby="end-title">
  <SectionBg kind="dawn" />
  <div class="capsule rv" bind:clientWidth={w} bind:clientHeight={h} {@attach reveal}>
    <div class="cipher" aria-hidden="true">{glyphs}</div>
    <svg class="cap" viewBox="0 0 {w || 1} {h || 1}" aria-hidden="true" focusable="false">
      {#if d}
        <path class="track" {d} pathLength="100" />
        <path class="seal-line" {d} pathLength="100" />
        <g data-ambient {@attach ambient}><path class="comet" {d} pathLength="100" /></g>
      {/if}
    </svg>
    <span class="stamp" aria-hidden="true">
      <svg viewBox="0 0 96 96" focusable="false">
        <circle class="wax" cx="48" cy="48" r="38" />
        <path class="ring" d={ring} />
        <path class="ring2" d={ring2} />
        <g class="glyph">
          <path d="M40 46v-6a8 8 0 0 1 16 0v6" />
          <rect x="35" y="46" width="26" height="19" rx="4" />
          <path d="M48 53v5" />
        </g>
      </svg>
    </span>

    <div class="say">
      <h2 id="end-title">{t("home.end.title")}</h2>
      <button type="button" class="cta" aria-haspopup="dialog" onclick={onstart}>
        <span class="seal" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path class="shackle" d="M8 11V8a4 4 0 0 1 8 0v3" />
            <rect x="5" y="11" width="14" height="10" rx="2.5" />
            <path class="hole" d="M12 15v2.5" />
          </svg>
        </span>
        <span>{t("home.end.cta")}</span>
      </button>
    </div>
  </div>
</section>

<style>
  .end {
    position: relative;
    isolation: isolate;
    padding-block: 140px 120px;
  }

  /* La capsule : verre sombre, texte chiffré en filigrane sur les bords, centre dégagé. */
  .capsule {
    position: relative;
    isolation: isolate;
    display: grid;
    place-items: center;
    min-height: 420px;
    padding: 88px clamp(20px, 6vw, 96px) 64px;
    border-radius: 200px;
    background:
      radial-gradient(60% 70% at 50% 55%, rgb(95 227 181 / 0.08), transparent 70%),
      linear-gradient(180deg, rgb(15 19 25 / 0.9), rgb(9 11 15 / 0.92));
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.05),
      0 60px 120px -60px rgb(0 0 0 / 0.95);
  }
  .cipher {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: clip;
    border-radius: inherit;
    padding: 28px 40px;
    white-space: pre;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 24px;
    letter-spacing: 0.12em;
    color: rgb(95 227 181 / 0.12);
    -webkit-mask-image: radial-gradient(50% 55% at 50% 52%, transparent 45%, #000 100%);
    mask-image: radial-gradient(50% 55% at 50% 52%, transparent 45%, #000 100%);
  }
  .cap {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    fill: none;
    pointer-events: none;
  }
  /* Ouverture du logo centrée sur le haut (décalage de 8,33) : le sceau vient la fermer. */
  .track {
    stroke: rgb(233 236 242 / 0.34);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-dasharray: 83.33 100;
    stroke-dashoffset: -8.33;
  }
  .seal-line {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 100 100;
    opacity: 0.55;
  }
  .comet {
    stroke: var(--seal-light);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 0 100;
    opacity: 0;
  }

  /* Le sceau, posé sur l'ouverture. */
  .stamp {
    position: absolute;
    left: 50%;
    top: 0;
    width: 96px;
    height: 96px;
    margin: -48px 0 0 -48px;
  }
  .stamp svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .wax {
    fill: #0f2a22;
    stroke: rgb(95 227 181 / 0.6);
    stroke-width: 1.2;
  }
  .ring {
    fill: none;
    stroke: rgb(95 227 181 / 0.55);
    stroke-width: 0.6;
  }
  .ring2 {
    fill: none;
    stroke: rgb(95 227 181 / 0.3);
    stroke-width: 0.5;
  }
  .glyph {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .say {
    display: grid;
    justify-items: center;
    gap: var(--sp-4);
    width: 100%;
    max-width: 40rem;
    text-align: center;
  }
  h2 {
    width: 100%;
    min-width: 0;
    overflow-wrap: break-word;
    font-size: var(--fs-section);
    line-height: 1;
    font-weight: 680;
    font-stretch: 116%;
    letter-spacing: -0.04em;
  }

  /* Bouton-sceau : papier sur encre, pastille menthe dont l'anse se ferme. */
  .cta {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    max-width: 100%;
    min-height: 60px;
    text-align: start;
    overflow-wrap: anywhere;
    margin-top: var(--sp-2);
    padding: 0 28px 0 8px;
    border: 0;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 1.0625rem;
    font-weight: 640;
    cursor: pointer;
    box-shadow:
      0 16px 36px -18px rgb(95 227 181 / 0.5),
      inset 0 -2px 0 rgb(11 13 18 / 0.12);
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .seal {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: inset 0 0 0 1px rgb(5 20 15 / 0.2);
    transition: transform 520ms var(--ease-settle);
  }
  .seal svg {
    width: 22px;
    height: 22px;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .shackle {
    transform: translateY(-2.5px) rotate(-20deg);
    transform-origin: 16px 11px;
    transition: transform 420ms var(--ease-settle);
  }
  .hole {
    opacity: 0;
    transition: opacity 200ms var(--ease-out) 160ms;
  }
  .cta:hover .shackle,
  .cta:focus-visible .shackle,
  .cta:active .shackle {
    transform: none;
  }
  .cta:hover .hole,
  .cta:focus-visible .hole {
    opacity: 1;
  }
  @media (hover: hover) {
    .cta:hover {
      background: #fff;
      box-shadow:
        0 20px 44px -18px rgb(95 227 181 / 0.65),
        inset 0 -2px 0 rgb(11 13 18 / 0.12);
    }
    .cta:hover .seal {
      transform: rotate(-12deg) scale(1.05);
    }
  }
  .cta:active {
    transform: scale(0.97);
  }

  /* Au défilement : le sceau descend sur l'ouverture, le contour se referme, la lumière tourne. */
  @media (prefers-reduced-motion: no-preference) {
    .comet {
      animation: orbit var(--dur-orbit) var(--ease-in-out) infinite;
    }
    g:global(.still) .comet {
      animation-play-state: paused;
    }
    @supports (animation-timeline: view()) {
      .capsule {
        view-timeline: --capsule;
      }
      .stamp {
        animation: stamp linear both;
        animation-timeline: --capsule;
        animation-range: entry 30% cover 45%;
      }
      .seal-line {
        animation: seal-close linear both;
        animation-timeline: --capsule;
        animation-range: entry 40% cover 50%;
      }
      .cipher {
        animation: cipher-drift linear both;
        animation-timeline: --capsule;
        animation-range: cover;
      }
    }
    .capsule:global(.rv-wait:not(.in)) .stamp {
      transform: translateY(-40px) scale(1.4) rotate(-30deg);
      opacity: 0;
    }
    .capsule:global(.rv-wait) .stamp {
      transition:
        transform 700ms var(--ease-settle) 250ms,
        opacity 300ms var(--ease-out) 250ms;
    }
  }
  @keyframes stamp {
    from {
      transform: translateY(-40px) scale(1.4) rotate(-30deg);
      opacity: 0;
    }
    70% {
      opacity: 1;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes seal-close {
    from {
      opacity: 0;
    }
    to {
      opacity: 0.55;
    }
  }
  @keyframes cipher-drift {
    from {
      transform: translateY(-14px);
    }
    to {
      transform: translateY(14px);
    }
  }
  @keyframes orbit {
    0% {
      stroke-dasharray: 0 100;
      stroke-dashoffset: 0;
      opacity: 0;
    }
    6% {
      stroke-dasharray: 9 100;
      opacity: 1;
    }
    62% {
      stroke-dasharray: 9 100;
      stroke-dashoffset: -74;
      opacity: 1;
    }
    70%,
    100% {
      stroke-dasharray: 0 100;
      stroke-dashoffset: -83;
      opacity: 0;
    }
  }

  @media (max-width: 599px) {
    .end {
      padding-block: 96px 80px;
    }
    .capsule {
      min-height: 0;
      padding: 84px 20px 48px;
      border-radius: 56px;
    }
    .cipher {
      font-size: 11px;
      line-height: 20px;
      padding: 20px;
      color: rgb(95 227 181 / 0.08);
      -webkit-mask-image: radial-gradient(70% 60% at 50% 50%, transparent 55%, #000 100%);
      mask-image: radial-gradient(70% 60% at 50% 50%, transparent 55%, #000 100%);
    }
  }
  @media (min-width: 1024px) {
    .end {
      padding-block: 200px 160px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cta,
    .seal,
    .shackle,
    .hole {
      transition: none;
    }
    .cta:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .capsule {
      background: Canvas;
    }
    .cipher,
    .comet,
    .seal-line {
      display: none;
    }
    .track {
      stroke: CanvasText;
    }
    .wax {
      fill: Canvas;
      stroke: CanvasText;
    }
    .ring,
    .ring2,
    .glyph {
      stroke: CanvasText;
    }
    .cta {
      border: 2px solid ButtonText;
    }
    .seal {
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
