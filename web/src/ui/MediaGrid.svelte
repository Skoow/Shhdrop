<script lang="ts">
  // Photos et vidéos sur ordinateur : petites vignettes (72 px) pour que toutes les catégories
  // tiennent ensemble à l'écran. La vignette entière est le bouton d'actions (Renommer,
  // Monter, Descendre, Retirer) ; nom dessous ; pastille d'avertissement sur la vignette (le
  // détail est dans le nom accessible et l'infobulle). Alt + flèches déplace dans la catégorie.
  import { flip } from "svelte/animate";
  import type { ComposeItem } from "../flows/compose.svelte";
  import { metaNoteKey } from "../flows/compose.svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { formatClock, mediaDuration } from "../media/duration";
  import { Ellipsis } from "./Icon";
  import { canThumb, iconFor, thumb } from "./itemView";
  import { reducedMotion } from "./motion";

  type Props = {
    items: ComposeItem[];
    helpId: string;
    onmenu: (id: string) => void;
    onmove: (id: string, delta: -1 | 1) => void;
    cannotOpen?: (item: ComposeItem) => boolean;
    danger?: (item: ComposeItem) => boolean;
  };
  let { items, helpId, onmenu, onmove, cannotOpen, danger }: Props = $props();

  const uid = $props.id();
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

  /** Ce que la vignette ne montre pas : état du nettoyage, doublon, risque, ouverture. */
  function details(item: ComposeItem): string[] {
    const out: string[] = [formatBytes(item.size, getLang())];
    if (durations[item.id] !== undefined) out.push(formatClock(durations[item.id]!));
    if (item.clean === "nettoye") out.push(t("compose.cleaned.short"));
    else {
      const k = metaNoteKey(item);
      if (k) out.push(t("compose.notCleaned"), t(k));
    }
    if (item.duplicate) out.push(t("compose.duplicate"));
    if (item.risky) out.push(t(item.mismatch ? "compose.mismatch" : "compose.risky"));
    if (cannotOpen?.(item)) out.push(t("compose.cannotOpen"));
    return out;
  }
  const warn = (item: ComposeItem) => item.risky || item.duplicate || item.clean === "non_nettoye" || !!cannotOpen?.(item);

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
    {@const info = details(item)}
    <li class={["tile", { danger: danger?.(item) }]} data-row={item.id} animate:flip={{ duration: reducedMotion() ? 0 : 180 }}>
      <span class="pw">
      <button
        type="button"
        class="pic"
        data-menu
        title={`${name}\n${info.join(" · ")}`}
        aria-label={t("compose.more", { name })}
        aria-describedby={[`${uid}-${item.id}`, items.length > 1 ? helpId : ""].filter(Boolean).join(" ")}
        onclick={() => onmenu(item.id)}
        onkeydown={(e) => key(e, item.id)}
      >
        {#if canThumb(item) && !failed[item.id]}
          <img alt="" decoding="async" {@attach thumb(item, () => (failed[item.id] = true))} />
        {:else}
          <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
        {/if}
        {#if warn(item)}<span class={["dot", { red: item.risky || danger?.(item) }]} aria-hidden="true"></span>{/if}
        <span class="more" aria-hidden="true"><Ellipsis size={16} strokeWidth={2.2} /></span>
      </button>
      <!-- Hors du bouton : un texte visible dans le bouton devrait faire partie de son nom. -->
      {#if durations[item.id] !== undefined}<span class="dur num" aria-hidden="true">{formatClock(durations[item.id]!)}</span>{/if}
      </span>
      <span class="sr-only" id="{uid}-{item.id}">{info.join(". ")}</span>
      <bdi class="nm" translate="no" aria-hidden="true"><span class="b">{item.base}</span><span class="e">{item.ext}</span></bdi>
    </li>
  {/each}
</ol>

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, 64px);
    gap: var(--sp-3) var(--sp-2);
  }
  .tile {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .pw {
    position: relative;
    width: 64px;
    height: 64px;
  }
  .pic {
    position: relative;
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.05);
    box-shadow: inset 0 0 0 1px var(--hair);
    color: var(--text-3);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .pic:active {
    transform: scale(0.95);
  }
  .pic img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .danger .pic {
    box-shadow: inset 0 0 0 2px var(--danger);
  }
  .dur {
    position: absolute;
    pointer-events: none;
    inset-inline-end: 4px;
    inset-block-end: 4px;
    padding: 0 4px;
    border-radius: 4px;
    background: rgb(5 7 10 / 0.78);
    color: var(--text);
    font-size: 0.625rem;
    line-height: 1.5;
  }
  .dot {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--warn);
    box-shadow: 0 0 0 2px rgb(11 13 18 / 0.85);
  }
  .dot.red {
    background: var(--danger);
  }
  /* « … » au survol et au focus : la vignette est le bouton d'actions. */
  .more {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: rgb(11 13 18 / 0.78);
    color: var(--text);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .pic:hover .more,
  .pic:focus-visible .more {
    opacity: 1;
  }
  @media (hover: none) {
    .more {
      opacity: 1;
    }
  }
  .nm {
    display: flex;
    min-width: 0;
    color: var(--text-2);
    font-size: 0.6875rem;
    line-height: 1.3;
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
  @media (prefers-reduced-motion: reduce) {
    .pic,
    .more {
      transition: none;
    }
    .pic:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .pic {
      border: 1px solid ButtonText;
    }
    .more {
      opacity: 1;
    }
    .dot {
      background: Highlight;
      forced-color-adjust: none;
    }
  }
</style>
