<script lang="ts">
  // Accueil v4 (UI §20.11) : fond propre à chaque section, sur toute la largeur de la fenêtre
  // (100cqw du conteneur « page » posé sur <body>, sans 100vw ni barre de défilement), avec ses
  // coutures (fondu, biais ou courbe) et un léger parallaxe au défilement (transform seulement,
  // animation-timeline: view(), rien en mouvement réduit). Purement décoratif.
  import { cipherText } from "./decor";
  import Guilloche from "./Guilloche.svelte";

  type Kind = "night" | "tide" | "vault" | "cipher" | "dawn";
  let { kind }: { kind: Kind } = $props();
  const glyphs = $derived(kind === "cipher" ? cipherText(4099, 160, 40) : "");
</script>

<div class={["sec-bg", kind]} aria-hidden="true">
  <div class="field"></div>
  {#if kind === "vault"}
    <div class="tex"><Guilloche lines={30} /></div>
  {:else if kind === "cipher"}
    <div class="tex glyphs">{glyphs}</div>
  {:else}
    <div class="tex"></div>
  {/if}
  <div class="light"></div>
</div>

<style>
  .sec-bg {
    position: absolute;
    z-index: -1;
    top: 0;
    bottom: 0;
    left: calc(50% - 50cqw);
    width: 100cqw;
    /* clip et non hidden : pas de conteneur de défilement, view() suit la page. */
    overflow: clip;
    pointer-events: none;
    /* Coutures douces en haut et en bas : on passe d'une ambiance à l'autre sans filet. */
    -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 140px, #000 calc(100% - 140px), transparent 100%);
    mask-image: linear-gradient(180deg, transparent 0, #000 140px, #000 calc(100% - 140px), transparent 100%);
  }
  .field,
  .tex,
  .light {
    position: absolute;
    inset: -8% 0;
  }

  /* Héros : nuit, trame de points autour du coffre. */
  .night .tex {
    inset: 0;
    background-image: radial-gradient(circle at 1px 1px, rgb(233 236 242 / 0.09) 1px, transparent 1.5px);
    background-size: 22px 22px;
    -webkit-mask-image: radial-gradient(60% 70% at 72% 45%, #000, transparent 75%);
    mask-image: radial-gradient(60% 70% at 72% 45%, #000, transparent 75%);
  }

  /* Comment ça marche (retours HOME5) : lueur de la DA derrière le panneau de verre — menthe au
     centre, bleu profond qui monte du bas, filet de lumière au bord haut. Sous le plafond K5. */
  .tide .field {
    background:
      radial-gradient(46% 42% at 50% 62%, rgb(95 227 181 / 0.17), transparent 72%),
      radial-gradient(55% 50% at 18% 85%, rgb(52 86 170 / 0.2), transparent 70%),
      radial-gradient(40% 40% at 86% 30%, rgb(40 128 154 / 0.16), transparent 70%),
      linear-gradient(180deg, #0b0e13, #0a0d12);
  }
  .tide .tex {
    inset: 0;
    background-image: radial-gradient(circle at 1px 1px, rgb(233 236 242 / 0.07) 1px, transparent 1.5px);
    background-size: 26px 26px;
    -webkit-mask-image: radial-gradient(60% 55% at 50% 55%, #000, transparent 80%);
    mask-image: radial-gradient(60% 55% at 50% 55%, #000, transparent 80%);
  }
  .tide .light {
    background: radial-gradient(30% 30% at 50% 50%, rgb(201 251 232 / 0.06), transparent 70%);
  }

  /* Pourquoi c'est sûr : le coffre, encre profonde, guilloché, lumière qui tombe d'en haut. */
  .vault .field {
    background:
      radial-gradient(50% 45% at 30% 0%, rgb(95 227 181 / 0.07), transparent 70%),
      linear-gradient(180deg, #07090d, #090b11);
  }
  .vault .tex {
    opacity: 0.9;
  }
  .vault .light {
    background: radial-gradient(40% 30% at 80% 100%, rgb(52 86 170 / 0.14), transparent 70%);
  }

  /* Questions : texte chiffré décoratif en filigrane (S1 : générateur à graine fixe). */
  .cipher .field {
    background: linear-gradient(180deg, #0a0c11, #0b0e13);
  }
  .glyphs {
    inset: 0;
    padding: 24px;
    overflow: clip;
    white-space: pre;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 22px;
    letter-spacing: 0.08em;
    color: rgb(95 227 181 / 0.06);
    -webkit-mask-image: radial-gradient(70% 60% at 50% 50%, transparent 30%, #000 80%);
    mask-image: radial-gradient(70% 60% at 50% 50%, transparent 30%, #000 80%);
  }

  /* Appel final : aube, courbe en haut, lueur au centre. */
  .dawn {
    border-radius: 50% 50% 0 0 / 160px 160px 0 0;
    -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 160px), transparent);
    mask-image: linear-gradient(180deg, #000 calc(100% - 160px), transparent);
  }
  .dawn .field {
    background:
      radial-gradient(45% 55% at 50% 55%, rgb(95 227 181 / 0.10), transparent 70%),
      radial-gradient(70% 60% at 50% 100%, rgb(52 86 170 / 0.18), transparent 70%),
      linear-gradient(180deg, #0c1016, #080a0e);
  }
  .dawn .light {
    background: linear-gradient(180deg, rgb(201 251 232 / 0.05), transparent 120px);
  }

  /* Parallaxe : les couches glissent à des vitesses différentes au défilement. */
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .field,
      .tex,
      .light {
        animation: bg-shift linear both;
        animation-timeline: view();
        animation-range: cover;
      }
      .tex {
        animation-name: bg-shift-tex;
      }
      .light {
        animation-name: bg-shift-light;
      }
    }
  }
  @keyframes bg-shift {
    from {
      transform: translateY(-3%);
    }
    to {
      transform: translateY(3%);
    }
  }
  @keyframes bg-shift-tex {
    from {
      transform: translateY(-6%);
    }
    to {
      transform: translateY(6%);
    }
  }
  @keyframes bg-shift-light {
    from {
      transform: translateY(5%);
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
    to {
      transform: translateY(-5%);
      opacity: 0.6;
    }
  }

  @media (prefers-contrast: more), (forced-colors: active) {
    .sec-bg {
      display: none;
    }
  }
</style>
