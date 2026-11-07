<script lang="ts">
  // Contour de temps (benchmark S3) : le contour de la capsule se raccourcit avec le temps
  // restant, mis à jour à la minute (aucune boucle d'animation) ; les ouvertures restantes sont
  // de petites encoches. Décoratif : le texte complet est porté par le parent (Countdown, état).
  import { untrack } from "svelte";
  import { capPath } from "./motion";
  import { notches, rimOffset } from "./rim";

  type Props = {
    /** Secondes restantes au montage. */
    remainingS: number;
    /** Durée de référence (le contour plein). */
    totalS: number;
    opensLeft?: number | null;
    /** Rayon des coins (px). */
    radius?: number;
    /** Horloge en ms (tests). */
    now?: () => number;
  };
  let { remainingS, totalS, opensLeft = null, radius = 24, now = () => Date.now() }: Props = $props();

  let w = $state(0);
  let h = $state(0);
  const d = $derived(w > 4 && h > 4 ? capPath(w - 2, h - 2, radius) : "");

  // Échéance fixée au montage (remainingS est relatif à ce moment).
  let deadline = 0;
  // Valeur de départ posée tout de suite : aucune transition de « vide » à « plein » au montage.
  let left = $state(untrack(() => remainingS));
  $effect(() => {
    const r = remainingS;
    const t0 = now();
    deadline = t0 + r * 1000;
    left = r;
    const id = setInterval(() => (left = Math.max(0, Math.ceil((deadline - now()) / 1000))), 60_000);
    return () => clearInterval(id);
  });
  function visible() {
    if (document.visibilityState === "visible" && deadline > 0) left = Math.max(0, Math.ceil((deadline - now()) / 1000));
  }

  const offset = $derived(rimOffset(left, totalS));
  // Encoches : traits de 0,8 unité aux positions données, sur le même tracé.
  const notchDash = $derived.by(() => {
    const at = notches(opensLeft);
    if (at.length === 0) return "";
    const out: number[] = [0, at[0]!];
    for (let k = 0; k < at.length; k++) {
      const next = k + 1 < at.length ? at[k + 1]! : 100 + at[0]!;
      out.push(0.8, Math.max(0, next - at[k]! - 0.8));
    }
    return out.map((x) => Math.round(x * 100) / 100).join(" ");
  });
</script>

<svelte:document onvisibilitychange={visible} />

<div class="rim" aria-hidden="true" bind:clientWidth={w} bind:clientHeight={h} data-rim-offset={offset} data-notches={notches(opensLeft).length}>
  {#if d}
    <svg width={w} height={h} focusable="false">
      <g transform="translate(1 1)">
        <path class="track" {d} pathLength="100" />
        <path class="time" {d} pathLength="100" stroke-dasharray="100 100" stroke-dashoffset={offset} />
        {#if notchDash}<path class="notch" {d} pathLength="100" stroke-dasharray={notchDash} />{/if}
      </g>
    </svg>
  {/if}
</div>

<style>
  .rim {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  svg {
    display: block;
    overflow: visible;
  }
  path {
    fill: none;
  }
  .track {
    stroke: var(--hair-2);
    stroke-width: 1;
  }
  .time {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    transition: stroke-dashoffset var(--dur-slow) var(--ease-out);
  }
  .notch {
    stroke: var(--seal-light);
    stroke-width: 5;
  }
  @media (prefers-reduced-motion: reduce) {
    .time {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .time,
    .notch {
      stroke: CanvasText;
    }
    .track {
      stroke: GrayText;
    }
  }
</style>
