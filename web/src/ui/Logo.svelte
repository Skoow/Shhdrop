<script lang="ts">
  // Logo « Trame » (scripts/gen-logo.mjs) : « shh » plein, « gone » en trame de points.
  // Statique à l'arrivée : le logo au repos s'affiche tout de suite, rien ne s'anime.
  // Animations (écran de destruction seulement) : opacity et transform (Web Animations API, aucun attribut style),
  // rien en mouvement réduit (UI §7.5). Chronologie de la gomme dans logoMotion.ts.
  import { tick } from "svelte";
  import { LOGO_DOTS, LOGO_HEAD, LOGO_STROKE, LOGO_TAIL, LOGO_VIEWBOX, MARK_PATH } from "./logo-paths";
  import { CRUMBS, ERASE, ERASER_RUBBER, ERASER_SLEEVE, eraseTimeline, type Timeline } from "./logoMotion";
  import { reducedMotion } from "./motion";

  type Props = {
    /** Mot-symbole complet, ou marque seule (o rayé, celui du favicon). */
    variant?: "wordmark" | "mark";
  };
  let { variant = "wordmark" }: Props = $props();

  const uid = $props.id();
  let svg: SVGSVGElement | undefined = $state();
  let gone = $state(false);
  /** Vrai pendant l'effacement : masque, gomme, miettes et trame fantôme n'existent que pendant ce temps. */
  let erasing = $state(false);
  let running: Animation[] = [];

  const parts = (sel: string) => [...(svg?.querySelectorAll<SVGElement>(sel) ?? [])];
  const canAnimate = () => !reducedMotion() && typeof svg?.animate === "function";

  /** Interrompt l'animation en cours : état final immédiat. */
  function skip() {
    for (const a of running) a.finish();
  }

  /** Joue une chronologie ; un clic ou une touche n'importe où la termine (jamais bloquante). */
  async function play({ duration, tracks }: Timeline): Promise<void> {
    running = tracks.flatMap((t) => {
      const els = parts(t.target);
      return (t.nth === undefined ? els : els.slice(t.nth, t.nth + 1)).map((el) =>
        el.animate(t.frames, { duration, easing: t.easing ?? "linear", fill: t.fill ?? "none" }),
      );
    });
    const opts = { capture: true, passive: true } as const;
    addEventListener("pointerdown", skip, opts);
    addEventListener("keydown", skip, opts);
    try {
      await Promise.allSettled(running.map((a) => a.finished));
    } finally {
      removeEventListener("pointerdown", skip, opts);
      removeEventListener("keydown", skip, opts);
      running = [];
    }
  }

  /** Écran de destruction : la gomme efface le mot, qui reste effacé ; résolue à la fin (tout de suite en mouvement réduit). */
  export async function erase(): Promise<void> {
    if (!canAnimate()) {
      gone = true;
      return;
    }
    erasing = true;
    await tick();
    try {
      await play(eraseTimeline());
    } finally {
      gone = true;
      erasing = false;
    }
  }

  /** Écran de destruction (variante sobre) : la trame s'efface tranche par tranche. */
  export async function dissolve(): Promise<void> {
    const dots = parts(".dots");
    if (!canAnimate()) {
      gone = true;
      return;
    }
    const runs = dots.map((el, k) =>
      el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.3)" }], {
        duration: 420,
        delay: k * 90,
        easing: "ease-in",
        fill: "forwards",
      }).finished,
    );
    await Promise.allSettled(runs);
    gone = true;
  }
</script>

{#if variant === "mark"}
  <svg bind:this={svg} class="logo mark" viewBox="4 4 22 22" role="img" aria-label="Shhgone" focusable="false">
    <path class="stripes" d={MARK_PATH} />
  </svg>
{:else}
  <svg bind:this={svg} class={["logo", "word", gone && "gone"]} viewBox={LOGO_VIEWBOX} role="img" aria-label="Shhgone" focusable="false">
    {#if erasing}
      <defs>
        <linearGradient id="{uid}-g1" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity="0.94" />
          <stop offset={1 - ERASE.soft} stop-color="#000" stop-opacity="0.94" />
          <stop offset="1" stop-color="#000" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="{uid}-g2" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity="0" />
          <stop offset={ERASE.soft} stop-color="#000" stop-opacity="0.94" />
          <stop offset="1" stop-color="#000" stop-opacity="0.94" />
        </linearGradient>
        <mask id="{uid}-m" maskUnits="userSpaceOnUse" x="-40" y="-50" width="270" height="80">
          <rect x="-40" y="-50" width="270" height="80" fill="#fff" />
          <rect class="m1" x={ERASE.x0 - ERASE.maskW * (1 - ERASE.soft / 2)} y={ERASE.band1.y} width={ERASE.maskW} height={ERASE.band1.h} fill="url(#{uid}-g1)" />
          <rect class="m2" x={ERASE.x1 - ERASE.maskW * (ERASE.soft / 2)} y={ERASE.band2.y} width={ERASE.maskW} height={ERASE.band2.h} fill="url(#{uid}-g2)" />
        </mask>
      </defs>
      <path class="fx ghost" d={LOGO_HEAD + LOGO_TAIL} />
    {/if}
    <g class="ink" mask={erasing ? `url(#${uid}-m)` : undefined}>
      <path class="head" d={LOGO_HEAD} stroke-width={LOGO_STROKE} />
      <path class="tail" d={LOGO_TAIL} stroke-width={LOGO_STROKE} />
      {#each LOGO_DOTS as d, k (k)}
        <path class="dots" {d} />
      {/each}
    </g>
    {#if erasing}
      {#each CRUMBS as c, i (i)}
        <circle class="fx crumb crumb{i}" cx={c.x} cy={c.y} r={1.1 - i * 0.1} />
      {/each}
      <g class="fx eraser">
        <path class="sleeve" d={ERASER_SLEEVE} />
        <path class="rubber" d={ERASER_RUBBER} />
      </g>
    {/if}
  </svg>
{/if}

<style>
  .logo {
    display: block;
    color: var(--text);
    overflow: visible;
  }
  .word {
    height: 30px;
    width: auto;
  }
  @media (min-width: 600px) {
    .word {
      height: 34px;
    }
  }
  .mark {
    width: 24px;
    height: 24px;
  }
  .head,
  .tail {
    fill: none;
    stroke: currentColor;
  }
  /* État statique : « shh » plein, « gone » en trame. */
  .tail {
    opacity: 0;
  }
  .dots,
  .stripes {
    fill: var(--accent);
  }
  .ink,
  .dots,
  .eraser,
  .crumb {
    transform-box: fill-box;
    transform-origin: center;
  }
  .gone .ink {
    opacity: 0;
  }
  /* Effets de la gomme : invisibles hors effacement ; jamais cibles du pointeur. */
  .fx {
    opacity: 0;
    pointer-events: none;
  }
  .ghost {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-dasharray: 0 5;
  }
  .crumb {
    fill: var(--text-2);
  }
  .sleeve {
    fill: var(--accent);
  }
  .rubber {
    fill: var(--seal-light);
  }
  /* Couleurs forcées : Chromium ne force pas les couleurs dans le SVG ; on suit donc la couleur système. */
  @media (forced-colors: active) {
    .logo {
      color: CanvasText;
    }
    .dots,
    .stripes,
    .crumb {
      fill: currentColor;
    }
    .ghost {
      stroke: currentColor;
    }
    .sleeve {
      fill: CanvasText;
    }
    .rubber {
      fill: Canvas;
      stroke: CanvasText;
      stroke-width: 1;
    }
  }
</style>
