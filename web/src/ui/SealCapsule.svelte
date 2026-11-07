<script lang="ts">
  // Capsule de scellement (UI §7.3, §20.4) : verre statique, encoche au milieu du bord haut,
  // trait qui part de l'encoche et suit les octets envoyés, volet de texte chiffré DÉCORATIF
  // (graine fixe, benchmark M2), noms brouillés en proportion (couche aria-hidden, vrais noms
  // en liste masquée, K9), pourcentage. La fermeture du sceau n'est jouée qu'après la
  // résolution de createShare (close(), appelée par l'écran), jamais avant.
  import { midSplitName } from "./midname";
  import type { Category } from "../flows/kinds";
  import { cipherVeil, scramble } from "./decor";
  import { File, FileArchive, FileText, Film, Image, Lock, LockOpen, Music, Type } from "./Icon";
  import { capPath, reducedMotion } from "./motion";
  import "./seal.css";

  type Mode = "spin" | "progress" | "paused" | "offline" | "final" | "sealed" | "error" | "cancelled";
  type Props = {
    mode: Mode;
    /** Part des octets envoyés (0 à 1). */
    progress: number;
    /** Pourcentage affiché (entier inférieur, jamais 100 avant le dernier octet). */
    percent: number;
    summary: string;
    chip: string;
    names: { name: string; category: Category }[];
    /** « En image, ce que le serveur reçoit » : montrée seulement quand aucun nom n'est lisible. */
    caption?: string;
    more: string;
    sealedLabel: string;
  };
  let { mode, progress, percent, summary, chip, names, more, sealedLabel, caption }: Props = $props();
  const split = (name: string, i: number) => midSplitName(scramble(name, kOf(i), 7 + i * 31));

  const ICONS: Record<Category, typeof File> = { texte: Type, photos: Image, videos: Film, audio: Music, documents: FileText, archives: FileArchive, autres: File };
  const VEIL = cipherVeil(20261105);

  let w = $state(0);
  let h = $state(0);
  const d = $derived(w > 0 && h > 0 ? capPath(w - 2, h - 2, 31) : "");

  // Progression dessinée une fois par image au plus (UI §7.6), quel que soit le rythme de onBytes.
  let drawn = $state(0);
  let frame = 0;
  $effect(() => {
    const target = progress;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => (drawn = target));
    return () => cancelAnimationFrame(frame);
  });
  const p = $derived(mode === "sealed" || mode === "final" ? 1 : Math.min(1, Math.max(0, drawn)));
  const kOf = (i: number) => Math.min(1, Math.max(0, p * 1.35 - i * 0.08));
  const allScrambled = $derived(names.every((_, i) => kOf(i) >= 1));

  let root: HTMLDivElement | undefined = $state();
  let running: Animation[] = [];

  function skip() {
    for (const a of running) a.finish();
  }

  /** Fermeture du sceau (900 ms, K3) ; un appui ou une touche la termine. Instantanée en mouvement réduit. */
  export async function close(): Promise<void> {
    if (!root || reducedMotion() || typeof root.animate !== "function") return;
    const q = (s: string) => root!.querySelector<Element>(s);
    const tracks: [Element | null, Keyframe[], KeyframeAnimationOptions][] = [
      [q(".flash"), [{ strokeDashoffset: 0, opacity: 1 }, { strokeDashoffset: -100, opacity: 0 }], { duration: 640, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }],
      [q(".bar"), [{ strokeWidth: 2 }, { strokeWidth: 3 }], { duration: 640, easing: "ease-out" }],
      [q(".lockic"), [{ transform: "translateY(-3px)", opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: 220, delay: 180, easing: "ease-out", fill: "backwards" }],
      [q(".sealed-word"), [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 340, delay: 560, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" }],
      [root, [{ transform: "scale(1)" }, { transform: "scale(0.985)" }, { transform: "scale(1)" }], { duration: 300, delay: 600, easing: "ease-in-out" }],
    ];
    running = tracks.filter(([el]) => el).map(([el, k, o]) => el!.animate(k, o));
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
</script>

<div bind:this={root} class={["capsule", mode]} style:--p={p} bind:clientWidth={w} bind:clientHeight={h} data-capsule>
  <div class="veil" aria-hidden="true">
    <pre class="veil-in">{VEIL}</pre>
  </div>

  <div class="head">
    <span class="lockbox" aria-hidden="true">
      <span class="lockic">
        {#if mode === "sealed"}<Lock size={20} strokeWidth={1.9} />{:else}<LockOpen size={20} strokeWidth={1.9} />{/if}
      </span>
    </span>
    <span class="summary num">{summary}</span>
    <span class="chip">{chip}</span>
  </div>

  <ul class="names" aria-hidden="true">
    {#each names as n, i (i)}
      {@const Ic = ICONS[n.category]}
      <li style:--k={kOf(i)}>
        <Ic size={18} strokeWidth={1.75} />
        <span class="nm" translate="no"><span class="h">{split(n.name, i).head}</span><span class="tl">{split(n.name, i).tail}</span></span>
      </li>
    {/each}
    {#if more}<li class="more">{more}</li>{/if}
  </ul>
  <ul class="sr-only">
    {#each names as n, i (i)}<li translate="no">{n.name}</li>{/each}
    {#if more}<li>{more}</li>{/if}
  </ul>

  {#if caption && allScrambled}<p class="veil-cap">{caption}</p>{/if}

  <div class="figure num" aria-hidden="true">
    {#if mode === "sealed"}
      <span class="sealed-word">{sealedLabel}</span>
    {:else}
      {percent}<span class="pct">%</span>
    {/if}
  </div>

  <svg class="line" aria-hidden="true" focusable="false">
    {#if d}
      <g transform="translate(1 1)">
        <path class="track" {d} pathLength="100" />
        <path class="bar" {d} pathLength="100" style:stroke-dasharray={mode === "spin" ? null : `${p * 100} 100`} />
        {#if mode === "sealed"}<path class="flash" {d} pathLength="100" />{/if}
      </g>
    {/if}
  </svg>
  <span class="notch" aria-hidden="true"></span>
</div>

<style>
  .capsule {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: var(--sp-4);
    min-height: 300px;
    padding: var(--sp-5);
    border-radius: var(--r-2xl);
    background: var(--vessel);
    box-shadow: var(--e-vessel), var(--edge-hi);
    view-transition-name: capsule;
  }
  .veil {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    transform: translateX(calc((var(--p) - 1) * 100%));
    border-right: 1px solid rgb(95 227 181 / 0.35);
    pointer-events: none;
  }
  .veil-in {
    margin: 0;
    padding: var(--sp-5);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.7;
    color: rgb(95 227 181 / 0.1);
    white-space: pre;
    transform: translateX(calc((1 - var(--p)) * 100%));
  }
  .final .veil,
  .sealed .veil {
    border-right-color: transparent;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
    min-width: 0;
  }
  .lockbox {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 1px solid var(--hair-2);
    border-radius: var(--r-md);
    color: var(--accent);
  }
  .lockic {
    display: grid;
  }
  .summary {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    /* Le résumé ne se coupe jamais au milieu (« 8 éléments · / 61 Ko ») : la pastille passe dessous. */
    white-space: nowrap;
  }
  .chip {
    flex: none;
    padding: 2px var(--sp-3);
    border-radius: var(--r-pill);
    background: var(--accent-tint);
    color: var(--accent);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .paused .chip,
  .cancelled .chip {
    background: var(--surface-3);
    color: var(--text-2);
  }
  .offline .chip {
    background: var(--warn-tint);
    color: var(--warn);
  }
  .error .chip {
    background: var(--danger-tint);
    color: var(--danger);
  }
  .names {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    align-content: start;
    gap: var(--sp-2);
    min-width: 0;
  }
  .names li {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
    color: var(--text-2);
  }
  .names .nm {
    display: flex;
    min-width: 0;
    white-space: nowrap;
    opacity: calc(1 - var(--k) * 0.45);
    filter: blur(calc(var(--k) * 1.6px));
  }
  .names .h {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .names .tl {
    flex: none;
    white-space: pre;
  }
  /* Posée sur le volet de texte brouillé, jamais sur des noms lisibles (scan UX, envoi). */
  .veil-cap {
    grid-row: 3;
    grid-column: 1;
    align-self: end;
    justify-self: start;
    max-width: 55%;
    margin: 0;
    font-size: var(--fs-small);
    color: var(--text-2);
  }
  .names .more {
    padding-left: calc(18px + var(--sp-3));
    font-size: var(--fs-small);
  }
  .figure {
    grid-row: 3;
    grid-column: 1;
    justify-self: end;
    font-size: var(--fs-figure);
    line-height: var(--lh-figure);
    font-weight: var(--fw-figure);
    font-stretch: var(--wd-figure);
    letter-spacing: var(--ls-figure);
    color: var(--text);
  }
  .pct {
    margin-left: 2px;
    font-size: 0.36em;
    vertical-align: top;
    color: var(--text-2);
  }
  .sealed-word {
    display: inline-block;
    font-size: 0.6em;
    color: var(--accent);
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
    stroke: var(--hair-2);
    stroke-width: 1;
  }
  .bar {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    transition:
      stroke var(--dur-fast) var(--ease-out),
      stroke-dasharray var(--dur-base) var(--ease-out);
  }
  .spin .bar {
    stroke-dasharray: 8 92;
    animation: seal-spin 1.6s linear infinite;
  }
  .paused .bar,
  .cancelled .bar {
    stroke: var(--text-3);
  }
  .offline .bar {
    animation: seal-pulse 1.6s ease-in-out infinite;
  }
  .error .bar {
    stroke: var(--danger);
  }
  .sealed .bar {
    stroke-width: 3;
  }
  .flash {
    stroke: var(--seal-light);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 14 86;
    stroke-dashoffset: -100;
    opacity: 0;
  }
  .notch {
    position: absolute;
    top: -1px;
    left: calc(50% - 1px);
    width: 2px;
    height: 10px;
    background: var(--line-strong);
  }
  .sealed .notch {
    background: var(--accent);
  }
  @media (max-width: 559px) {
    .capsule {
      min-height: 260px;
      padding: var(--sp-4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
    .spin .bar {
      animation: none;
    }
    .offline .bar {
      animation: none;
      stroke: var(--warn);
    }
    .names .nm {
      filter: none;
    }
  }
  @media (forced-colors: active) {
    .veil {
      display: none;
    }
    .track {
      stroke: GrayText;
    }
    .bar {
      stroke: Highlight;
      stroke-width: 4;
    }
  }
</style>
