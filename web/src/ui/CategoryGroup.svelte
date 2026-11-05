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
  };
  let { category, items, bytes, helpId, onremove, onrename, onedit, onmove, onmoveto }: Props = $props();

  const KEY = {
    texte: "compose.cat.text",
    photos: "compose.cat.photos",
    videos: "compose.cat.videos",
    audio: "compose.cat.audio",
    documents: "compose.cat.documents",
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

<section class="group" aria-labelledby="{uid}-h">
  <div class="head">
    <h3 id="{uid}-h">{t(KEY[category])}</h3>
    <span class="meta num">{items.length} · {formatBytes(bytes, getLang())}</span>
  </div>
  <ol bind:this={list} class="rows">
    {#each items as item (item.id)}
      <li class="li" data-row={item.id} animate:flip={{ duration: reducedMotion() ? 0 : flipMs }}>
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
