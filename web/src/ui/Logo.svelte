<script lang="ts" module>
  // L'introduction se joue une fois par chargement de page, pas à chaque retour sur l'accueil.
  let introPlayed = false;
</script>

<script lang="ts">
  // Logo « Trame » (scripts/gen-logo.mjs) : « shhd » plein, « rop » en trame de points qui s'efface.
  // Tracés générés par scripts/gen-logo.mjs (logo-paths.ts). Animation : opacity et transform
  // seulement (Web Animations API, aucun attribut style), rien en mouvement réduit (UI §7.5).
  import { LOGO_DOTS, LOGO_HEAD, LOGO_STROKE, LOGO_TAIL, LOGO_VIEWBOX, MARK_PATH } from "./logo-paths";
  import { reducedMotion } from "./motion";

  type Props = {
    /** Joue l'introduction (le mot s'assemble, puis « rop » se défait en trame) au premier affichage. */
    animated?: boolean;
    /** Mot-symbole complet, ou marque seule (o rayé, celui du favicon). */
    variant?: "wordmark" | "mark";
  };
  let { animated = false, variant = "wordmark" }: Props = $props();

  let svg: SVGSVGElement | undefined = $state();
  let gone = $state(false);

  const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
  const parts = (sel: string) => [...(svg?.querySelectorAll<SVGPathElement>(sel) ?? [])];

  // Toute l'entrée tient en 900 ms (budget K1 de l'accueil) : tête 0–400, trame 380–890.
  function intro() {
    for (const el of parts(".head"))
      el.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], {
        duration: 400,
        easing: EASE,
        fill: "backwards",
      });
    // « rop » plein le temps de lire le mot, puis il cède la place à la trame.
    for (const el of parts(".tail"))
      el.animate(
        [
          { opacity: 0, transform: "translateY(4px)", offset: 0 },
          { opacity: 1, transform: "none", offset: 0.36 },
          { opacity: 1, transform: "none", offset: 0.6 },
          { opacity: 0, transform: "none", offset: 0.86 },
          { opacity: 0, transform: "none", offset: 1 },
        ],
        { duration: 860, easing: "ease-out" },
      );
    parts(".dots").forEach((el, k) =>
      el.animate([{ opacity: 0, transform: "scale(1.5)" }, { opacity: 1, transform: "none" }], {
        duration: 260,
        delay: 380 + k * 50,
        easing: EASE,
        fill: "backwards",
      }),
    );
  }

  $effect(() => {
    if (!svg || variant !== "wordmark" || !animated || introPlayed) return;
    introPlayed = true;
    if (!reducedMotion() && typeof svg.animate === "function") intro();
  });

  /** Écran de destruction : la trame s'efface tranche par tranche ; résolue à la fin (tout de suite en mouvement réduit). */
  export async function dissolve(): Promise<void> {
    const dots = parts(".dots");
    if (reducedMotion() || dots.some((d) => typeof d.animate !== "function")) {
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
  <svg bind:this={svg} class="logo mark" viewBox="4 4 22 22" role="img" aria-label="Shhdrop" focusable="false">
    <path class="stripes" d={MARK_PATH} />
  </svg>
{:else}
  <svg bind:this={svg} class={["logo", "word", gone && "gone"]} viewBox={LOGO_VIEWBOX} role="img" aria-label="Shhdrop" focusable="false">
    <path class="head" d={LOGO_HEAD} stroke-width={LOGO_STROKE} />
    <path class="tail" d={LOGO_TAIL} stroke-width={LOGO_STROKE} />
    {#each LOGO_DOTS as d, k (k)}
      <path class="dots" {d} />
    {/each}
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
  /* État statique (et mouvement réduit) : le logo final, « rop » en trame. */
  .tail {
    opacity: 0;
  }
  .dots,
  .stripes {
    fill: var(--accent);
  }
  .head,
  .tail,
  .dots {
    transform-box: fill-box;
    transform-origin: center;
  }
  .gone .dots {
    opacity: 0;
  }
  /* Couleurs forcées : Chromium ne force pas les couleurs dans le SVG ; on suit donc la couleur système. */
  @media (forced-colors: active) {
    .logo {
      color: CanvasText;
    }
    .dots,
    .stripes {
      fill: currentColor;
    }
  }
</style>
