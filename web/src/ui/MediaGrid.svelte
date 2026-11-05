<script lang="ts">
  // Photos et vidéos sur ordinateur : grille de vignettes, nom et taille dessous, menu « … »
  // au survol (toujours présent au clavier et au doigt). Alt + ↑/↓ (ou ←/→) déplace dans la
  // catégorie, comme les lignes ; le menu offre Renommer, Monter, Descendre, Retirer.
  import { flip } from "svelte/animate";
  import type { ComposeItem } from "../flows/compose.svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { formatClock, mediaDuration } from "../media/duration";
  import { Ellipsis } from "./Icon";
  import ItemNotes from "./ItemNotes.svelte";
  import { canThumb, iconFor, thumb } from "./itemView";
  import { reducedMotion } from "./motion";

  type Props = {
    items: ComposeItem[];
    helpId: string;
    onmenu: (id: string) => void;
    onmove: (id: string, delta: -1 | 1) => void;
    cannotOpen?: (item: ComposeItem) => boolean;
  };
  let { items, helpId, onmenu, onmove, cannotOpen }: Props = $props();

  let failed = $state<Record<string, boolean>>({});
  let durations = $state<Record<string, number>>({});
  $effect(() => {
    for (const it of items) {
      if (it.category !== "videos" || !(it.data instanceof Blob) || it.id in durations) continue;
      const id = it.id;
      void mediaDuration(it.data, "video").then((d) => {
        if (d !== null) durations[id] = d;
      });
    }
  });

  function key(e: KeyboardEvent, id: string) {
    if (!e.altKey) return;
    const up = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const down = e.key === "ArrowDown" || e.key === "ArrowRight";
    if (!up && !down) return;
    e.preventDefault();
    if (items.length > 1) onmove(id, up ? -1 : 1);
  }
</script>

<ol class="grid">
  {#each items as item (item.id)}
    {@const Icon = iconFor(item)}
    {@const name = item.base + item.ext}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <li class="tile" data-row={item.id} animate:flip={{ duration: reducedMotion() ? 0 : 180 }} onkeydown={(e) => key(e, item.id)}>
      <span class="pic" aria-hidden="true">
        {#if canThumb(item) && !failed[item.id]}
          <img alt="" decoding="async" {@attach thumb(item, () => (failed[item.id] = true))} />
        {:else}
          <Icon size={28} strokeWidth={1.5} />
        {/if}
        {#if durations[item.id] !== undefined}<span class="dur num">{formatClock(durations[item.id]!)}</span>{/if}
      </span>
      <span class="info">
        <bdi class="nm" title={name} translate="no"><span class="b">{item.base}</span><span class="e">{item.ext}</span></bdi>
        <span class="meta num">{formatBytes(item.size, getLang())}</span>
        <ItemNotes {item} cannotOpen={cannotOpen?.(item) ?? false} />
      </span>
      <button type="button" class="more" aria-label={t("compose.more", { name })} title={t("compose.more", { name })} aria-describedby={items.length > 1 ? helpId : undefined} data-menu onclick={() => onmenu(item.id)}>
        <Ellipsis size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  {/each}
</ol>

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
    gap: var(--sp-4) var(--sp-3);
  }
  .tile {
    position: relative;
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }
  .pic {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.04);
    box-shadow: inset 0 0 0 1px var(--hair);
    color: var(--text-3);
  }
  .pic img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 500ms var(--ease-out);
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .tile:hover .pic img {
      transform: scale(1.03);
    }
  }
  .dur {
    position: absolute;
    inset-inline-end: 6px;
    inset-block-end: 6px;
    padding: 1px 6px;
    border-radius: 6px;
    background: rgb(5 7 10 / 0.78);
    color: var(--text);
    font-size: var(--fs-micro);
  }
  .info {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding-inline: 2px;
  }
  .nm {
    display: flex;
    min-width: 0;
    font-size: var(--fs-small);
    font-weight: 560;
  }
  .b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .e {
    flex: none;
  }
  .meta {
    color: var(--text-2);
    font-size: var(--fs-micro);
  }
  /* Menu au survol ; toujours là au clavier (focus) et au doigt. */
  .more {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 12px;
    background: rgb(11 13 18 / 0.72);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: var(--text);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .more:active {
    transform: scale(0.92);
  }
  .tile:hover .more,
  .tile:focus-within .more,
  .more:focus-visible {
    opacity: 1;
  }
  @media (hover: none) {
    .more {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .more,
    .pic img {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .pic {
      border: 1px solid CanvasText;
    }
    .more {
      opacity: 1;
      border: 1px solid ButtonText;
    }
  }
</style>
