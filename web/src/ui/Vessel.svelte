<script lang="ts">
  // Réceptacle (UI §20.1, §20.4 « Accueil et composeur ») : la capsule ouverte du logo, en grand.
  // Verre statique (--vessel, sans backdrop-filter : K6), contour SVG sur la forme exacte (rayon 32)
  // qui part du milieu du bord haut, ouverture de 60° ; lumière qui parcourt le contour vide
  // (ambiance, arrêtée hors écran et onglet caché) ; projecteur au pointeur fin. Contenu : `children`.
  // Le dépôt (`drop`) et les catégories viennent en Task 10–11.
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { capPath } from "./motion";

  type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "class"> & {
    children: Snippet;
    /** Réceptacle vide : la lumière parcourt le contour. */
    empty?: boolean;
    /** Cible de dépôt active : fond menthe, ouverture resserrée de 60° à 14° (Task 11). */
    drop?: boolean;
    el?: HTMLDivElement | undefined;
  };
  let { children, empty = true, drop = false, el = $bindable(), ...rest }: Props = $props();

  const RADIUS = 32; // --r-2xl
  let w = $state(0);
  let h = $state(0);
  const d = $derived(w > 0 && h > 0 ? capPath(w, h, RADIUS) : "");

  // Lumière du contour : arrêtée hors écran et onglet caché (UI §20.6 point 5).
  let onscreen = $state(true);
  let hidden = $state(document.hidden);
  $effect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (onscreen = e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  });

  // Projecteur : une écriture de transform par image au plus (CSSOM, jamais d'attribut style).
  let spot: HTMLSpanElement | undefined = $state();
  let lit = $state(false);
  let raf = 0;
  let x = 0;
  let y = 0;
  function move(e: PointerEvent) {
    if (e.pointerType !== "mouse" || !el) return;
    const r = el.getBoundingClientRect();
    x = e.clientX - r.left;
    y = e.clientY - r.top;
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        spot?.style.setProperty("transform", `translate(${x}px, ${y}px)`);
      });
  }
  $effect(() => () => cancelAnimationFrame(raf));
</script>

<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<div
  bind:this={el}
  bind:clientWidth={w}
  bind:clientHeight={h}
  {...rest}
  class={["vessel", { empty, drop, lit, still: hidden || !onscreen }]}
  onpointerenter={(e) => (lit = e.pointerType === "mouse")}
  onpointerleave={() => (lit = false)}
  onpointermove={move}
>
  <svg class="line" viewBox="0 0 {w || 1} {h || 1}" aria-hidden="true" focusable="false">
    {#if d}
      <path class="track" {d} pathLength="100" />
      {#if empty}
        <g data-ambient>
          <path class="comet soft" {d} pathLength="100" />
          <path class="comet core" {d} pathLength="100" />
        </g>
      {/if}
    {/if}
  </svg>
  <span class="spot-clip" aria-hidden="true"><span class="spot" bind:this={spot}></span></span>
  {@render children()}
</div>

<style>
  .vessel {
    position: relative;
    isolation: isolate;
    border-radius: var(--r-2xl);
    /* Verre statique : remplissage seul, aucun backdrop-filter (K6). */
    background: var(--vessel);
    box-shadow: var(--e-vessel), var(--edge-hi);
    view-transition-name: capsule;
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .vessel.drop {
    background: rgb(16 42 35 / 0.72);
  }

  .line {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    fill: none;
  }
  .track {
    stroke: rgb(233 236 242 / 0.3);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-dasharray: 83.33 100;
    transition:
      stroke var(--dur-slow) var(--ease-out),
      stroke-dasharray var(--dur-slow) var(--ease-out);
  }
  .drop .track {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 96 100;
  }

  /* Lumière qui parcourt les 300° ouverts puis s'éteint dans l'ouverture (7,2 s, 62 % de course). */
  .comet {
    stroke-linecap: round;
    stroke-dasharray: 0 100;
    opacity: 0;
  }
  .soft {
    stroke: var(--accent);
    stroke-width: 4;
  }
  .core {
    stroke: var(--seal-light);
    stroke-width: 1.75;
  }
  @media (prefers-reduced-motion: no-preference) {
    .soft {
      animation: orbit-soft var(--dur-orbit) var(--ease-in-out) 1.2s infinite;
    }
    .core {
      animation: orbit var(--dur-orbit) var(--ease-in-out) 1.2s infinite;
    }
    .still .comet {
      animation-play-state: paused;
    }
    .drop .comet {
      animation: none;
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
  @keyframes orbit-soft {
    0% {
      stroke-dasharray: 0 100;
      stroke-dashoffset: 0;
      opacity: 0;
    }
    6% {
      stroke-dasharray: 14 100;
      stroke-dashoffset: 2;
      opacity: 0.22;
    }
    62% {
      stroke-dasharray: 14 100;
      stroke-dashoffset: -72;
      opacity: 0.22;
    }
    70%,
    100% {
      stroke-dasharray: 0 100;
      stroke-dashoffset: -83;
      opacity: 0;
    }
  }

  /* Projecteur : disque menthe à 7 %, 420 px, déplacé par transform. */
  .spot-clip {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
  }
  .spot {
    position: absolute;
    left: 0;
    top: 0;
    width: 420px;
    height: 420px;
    margin: -210px 0 0 -210px;
    border-radius: 50%;
    opacity: 0;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.07), transparent);
    transition: opacity var(--dur-slow) var(--ease-out);
  }
  @media (hover: hover) and (pointer: fine) {
    .lit .spot {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .comet,
    .spot {
      display: none;
    }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .vessel {
      background: var(--surface-1);
    }
  }
  @media (forced-colors: active) {
    .vessel {
      background: Canvas;
    }
    .track {
      stroke: CanvasText;
    }
    .comet,
    .spot-clip {
      display: none;
    }
  }
</style>
