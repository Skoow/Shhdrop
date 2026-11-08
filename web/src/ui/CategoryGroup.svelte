<script lang="ts">
  // Groupe d'une catégorie (UI §9.2.4) : en-tête « Photos » + méta « 2 · 7,9 Mo », lignes dans
  // l'ordre du manifeste. Glisser au pointeur : la ligne se soulève et suit le doigt (transform
  // par CSSOM), les autres s'écartent, défilement automatique près des bords ; l'ordre ne change
  // qu'au lâcher. Alt + ↑/↓ et le mode déplacement passent par `onmove`.
  import { flip } from "svelte/animate";
  import type { ComposeItem } from "../flows/compose.svelte";
  import type { Category } from "../flows/kinds";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import ItemRow from "./ItemRow.svelte";
  import { Trash2 } from "./Icon";
  import { reducedMotion } from "./motion";
  import { edgeScroll, shiftFor, targetIndex } from "./reorder";

  type Props = {
    category: Category;
    items: ComposeItem[];
    bytes: number;
    helpId: string;
    onremove: (id: string) => void;
    onrename: (id: string, base: string) => null | "vide" | "trop_long" | "interdit";
    onedit: (id: string) => void;
    onmove: (id: string, delta: -1 | 1) => void;
    onmoveto: (id: string, index: number) => void;
    /** Téléphone : lignes compactes, menu « … ». */
    compact?: boolean;
    onmenu?: (id: string) => void;
    cannotOpen?: (item: ComposeItem) => boolean;
    /** Élément en cause d'un blocage ou d'un risque : marqué en rouge (S6). */
    danger?: (item: ComposeItem) => boolean;
  };
  let { category, items, bytes, helpId, onremove, onrename, onedit, onmove, onmoveto, compact = false, onmenu, cannotOpen, danger }: Props = $props();
  // Une seule présentation partout (décision du propriétaire du 7 novembre) : lignes compactes,
  // icône de format, nom, type, taille, temps d'envoi estimé, actions.

  const KEY = {
    texte: "compose.cat.text",
    photos: "compose.cat.photos",
    videos: "compose.cat.videos",
    audio: "compose.cat.audio",
    documents: "compose.cat.documents",
    archives: "compose.cat.archives",
    autres: "compose.cat.autres",
  } as const;
  const uid = $props.id();

  let list: HTMLOListElement | undefined = $state();
  // Animation des déplacements (clavier, mode déplacement) ; aucune au lâcher d'un glisser
  // (la ligne est déjà à sa place) ni en mouvement réduit.
  let flipMs = $state(180);

  type Drag = { id: string; from: number; to: number; rows: HTMLElement[]; centers: number[]; rowH: number; startY: number; startScroll: number; y: number; raf: number };
  let drag: Drag | null = null;

  function start(id: string, y: number) {
    if (!list) return;
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > [data-row]")];
    const from = rows.findIndex((r) => r.dataset.row === id);
    if (from < 0) return;
    const rects = rows.map((r) => r.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1]!.top - rects[0]!.bottom : 0;
    drag = {
      id,
      from,
      to: from,
      rows,
      centers: rects.map((r) => r.top + scrollY + r.height / 2),
      rowH: rects[from]!.height + gap,
      startY: y,
      startScroll: scrollY,
      y,
      raf: 0,
    };
    rows[from]!.classList.add("lifted");
    tickScroll();
  }
  function place() {
    if (!drag) return;
    const dy = drag.y - drag.startY + (scrollY - drag.startScroll);
    drag.rows[drag.from]!.style.setProperty("transform", `translateY(${dy}px)`);
    drag.to = targetIndex(drag.centers[drag.from]! + dy, drag.centers, drag.from);
    drag.rows.forEach((r, i) => {
      if (i === drag!.from) return;
      const s = shiftFor(i, drag!.from, drag!.to, drag!.rowH);
      if (s) r.style.setProperty("transform", `translateY(${s}px)`);
      else r.style.removeProperty("transform");
    });
  }
  function moveTo(y: number) {
    if (!drag) return;
    drag.y = y;
    place();
  }
  function tickScroll() {
    if (!drag) return;
    const v = edgeScroll(drag.y, innerHeight);
    if (v) {
      scrollBy(0, v);
      place();
    }
    drag.raf = requestAnimationFrame(tickScroll);
  }
  function end(commit: boolean) {
    const d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(d.raf);
    for (const r of d.rows) {
      r.style.removeProperty("transform");
      r.classList.remove("lifted");
    }
    if (commit && d.to !== d.from) {
      flipMs = 0;
      onmoveto(d.id, d.to);
      requestAnimationFrame(() => (flipMs = 180));
    }
  }
  $effect(() => () => {
    if (drag) cancelAnimationFrame(drag.raf);
  });
</script>

<section class={["group", { compact }]} aria-labelledby="{uid}-h">
  <div class="head">
    <h3 id="{uid}-h">{t(KEY[category])}</h3>
    <span class="meta num"
      >{items.length} · {formatBytes(bytes, getLang())}</span
    >
  </div>
  <ol bind:this={list} class="rows">
    {#each items as item (item.id)}
      <li class={["li", { swipeable: compact }]} data-row={item.id} animate:flip={{ duration: reducedMotion() ? 0 : flipMs }}>
        {#if compact}<span class="swipe-bg" aria-hidden="true"><Trash2 size={20} strokeWidth={1.9} />{t("compose.swipe.remove")}</span>{/if}
        <ItemRow
          {item}
          movable={items.length > 1}
          {helpId}
          onremove={() => onremove(item.id)}
          onrename={(b) => onrename(item.id, b)}
          onedit={() => onedit(item.id)}
          onmove={(d) => onmove(item.id, d)}
          ondragstart={(y) => start(item.id, y)}
          ondragmove={moveTo}
          ondragend={end}
          {compact}
          onmenu={() => onmenu?.(item.id)}
          cannotOpen={cannotOpen?.(item) ?? false}
          danger={danger?.(item) ?? false}
        />
      </li>
    {/each}
  </ol>
</section>

<style>
  .group {
    display: grid;
    gap: 2px;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-2) 4px 4px var(--sp-6);
  }
  .group:not(.compact) .head {
    padding: 2px 4px 2px;
  }
  .compact .head {
    padding-inline-start: 4px;
  }
  h3 {
    font-size: 1rem;
    font-weight: 640;
    letter-spacing: -0.005em;
  }
  .meta {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .li {
    position: relative;
    border-radius: 16px;
  }
  /* Glisser pour retirer (téléphone) : le fond rouge apparaît sous la ligne qui part à gauche. */
  .swipeable {
    overflow: hidden;
  }
  .swipe-bg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-2);
    padding-inline-end: var(--sp-5);
    border-radius: inherit;
    background: var(--danger);
    color: var(--on-danger);
    font-size: var(--fs-small);
    font-weight: 650;
    opacity: 0;
  }
  .swipeable:has(:global(.swiping)) .swipe-bg {
    opacity: 1;
  }
  .li:global(.lifted) {
    z-index: 2;
    background: var(--surface-3);
    box-shadow: var(--e-2), inset 0 0 0 1px var(--hair-2);
  }
  @media (forced-colors: active) {
    .li:global(.lifted) {
      outline: 2px solid Highlight;
    }
  }
</style>
