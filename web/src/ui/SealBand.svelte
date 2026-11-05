<script lang="ts">
  // Volet de scellement de l'accueil (UI §9.1, §20.4 ; benchmark motif 2) : des lignes en clair
  // passent la ligne de scellement, se brouillent juste avant, et deviennent du texte chiffré
  // décoratif (S1 : `scramble`, générateur à graine fixe, jamais de crypto ni de vraie donnée).
  // Quatre couches qui ne bougent qu'en `transform` (unités cqw), boucle de 7,2 s rangée dans
  // l'ambiance (pause hors écran et onglet caché) ; image fixe à mi-course en mouvement réduit.
  import { t } from "../i18n/i18n.svelte";
  import { ambient } from "./attach";
  import { scramble } from "./decor";
  import { Lock } from "./Icon";

  const plain = $derived(t("home.band"));
  const cipher = $derived(
    plain
      .split("\n")
      .map((line, i) => scramble(line, 1, 1301 + i * 7))
      .join("\n"),
  );
</script>

<div class="band" aria-hidden="true" data-ambient {@attach ambient}>
  <div class="pv"><div class="pv-in"><div class="ln plain">{plain}</div></div></div>
  <div class="bv"><div class="bv-in"><div class="ln blur">{plain}</div></div></div>
  <div class="cv"><div class="cv-in"><div class="ln ciph">{cipher}</div></div></div>
  <span class="front"><span class="chip"><Lock size={15} strokeWidth={2.2} aria-hidden="true" /></span></span>
</div>

<style>
  .band {
    --strip: 56px;
    position: relative;
    container-type: inline-size;
    height: 92px;
    overflow: hidden;
    border-radius: 18px;
    background: rgb(4 6 9 / 0.62);
    box-shadow:
      inset 0 0 0 1px var(--hair),
      inset 0 14px 24px -14px rgb(0 0 0 / 0.85);
    font-family: var(--font-mono);
    font-size: 0.78125rem;
    line-height: 1.25rem;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
  }
  /* Filets de réglure, comme une page de registre. */
  .band::before {
    content: "";
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(180deg, transparent 0 calc(1.25rem - 1px), rgb(233 236 242 / 0.035) calc(1.25rem - 1px) 1.25rem);
    background-position: 0 14px;
    pointer-events: none;
  }
  .pv,
  .pv-in,
  .bv-in,
  .cv,
  .cv-in {
    position: absolute;
    inset: 0;
  }
  .pv,
  .bv,
  .cv {
    overflow: hidden;
  }
  .bv {
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--strip);
  }
  .bv-in {
    right: auto;
    width: 100cqw;
  }
  .ln {
    position: absolute;
    inset: 14px 0 0;
    padding-inline: 20px;
    white-space: pre;
  }
  .plain {
    color: rgb(233 236 242 / 0.66);
  }
  .blur {
    color: rgb(233 236 242 / 0.5);
    filter: blur(2.4px);
  }
  .ciph {
    color: rgb(95 227 181 / 0.8);
  }
  .front {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0;
  }
  .front::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: -0.5px;
    width: 1px;
    background: var(--accent);
    box-shadow: 0 0 12px 1px var(--seal-halo);
  }
  .chip {
    position: absolute;
    left: -15px;
    top: 50%;
    width: 30px;
    height: 30px;
    margin-top: -15px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: 0 6px 16px -6px rgb(0 0 0 / 0.85);
  }

  /* Image fixe (mouvement réduit, et avant toute animation) : ligne à 56 %. */
  .front,
  .bv {
    transform: translateX(56cqw);
  }
  .bv-in {
    transform: translateX(-56cqw);
  }
  .cv {
    transform: translateX(-44cqw);
  }
  .cv-in {
    transform: translateX(44cqw);
  }
  .pv {
    transform: translateX(calc(56cqw + var(--strip)));
  }
  .pv-in {
    transform: translateX(calc(-56cqw - var(--strip)));
  }

  @media (prefers-reduced-motion: no-preference) {
    .front {
      animation: sweep-front 7.2s var(--ease-in-out) -0.8s infinite both;
    }
    .bv {
      animation: sweep 7.2s var(--ease-in-out) -0.8s infinite both;
    }
    .bv-in {
      animation: sweep-back 7.2s var(--ease-in-out) -0.8s infinite both;
    }
    .cv {
      animation: veil 7.2s var(--ease-in-out) -0.8s infinite both;
    }
    .cv-in {
      animation: veil-back 7.2s var(--ease-in-out) -0.8s infinite both;
    }
    .pv {
      animation: plain 7.2s var(--ease-in-out) -0.8s infinite both;
    }
    .pv-in {
      animation: plain-back 7.2s var(--ease-in-out) -0.8s infinite both;
    }
    .ln {
      animation: reset 7.2s linear -0.8s infinite both;
    }
    .band:global(.still) * {
      animation-play-state: paused;
    }
  }
  /* 0–55 % : la ligne traverse ; 55–88 % : tout est scellé ; 88–100 % : retour en fondu. */
  @keyframes sweep-front {
    0% {
      transform: translateX(0);
      opacity: 1;
    }
    55% {
      transform: translateX(100cqw);
      opacity: 1;
    }
    62%,
    100% {
      transform: translateX(100cqw);
      opacity: 0;
    }
  }
  @keyframes sweep {
    0% {
      transform: translateX(0);
    }
    55%,
    100% {
      transform: translateX(100cqw);
    }
  }
  @keyframes sweep-back {
    0% {
      transform: translateX(0);
    }
    55%,
    100% {
      transform: translateX(-100cqw);
    }
  }
  @keyframes veil {
    0% {
      transform: translateX(-100cqw);
    }
    55%,
    100% {
      transform: translateX(0);
    }
  }
  @keyframes veil-back {
    0% {
      transform: translateX(100cqw);
    }
    55%,
    100% {
      transform: translateX(0);
    }
  }
  @keyframes plain {
    0% {
      transform: translateX(var(--strip));
    }
    55%,
    100% {
      transform: translateX(calc(100cqw + var(--strip)));
    }
  }
  @keyframes plain-back {
    0% {
      transform: translateX(calc(-1 * var(--strip)));
    }
    55%,
    100% {
      transform: translateX(calc(-100cqw - var(--strip)));
    }
  }
  @keyframes reset {
    0%,
    88% {
      opacity: 1;
    }
    96% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }

  @media (min-width: 600px) {
    .band {
      height: 120px;
    }
  }
  @media (forced-colors: active) {
    .band {
      -webkit-mask-image: none;
      mask-image: none;
      border: 1px solid CanvasText;
    }
    .band::before,
    .bv,
    .front::before {
      display: none;
    }
    .chip {
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
