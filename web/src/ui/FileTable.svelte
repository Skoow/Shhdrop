<script lang="ts">
  // Documents, archives et autres fichiers sur ordinateur : un tableau net (Nom, Type, Taille,
  // Actions), filets fins, sans zébrures. Renommer (feuille), Retirer ; Alt + ↑/↓ déplace.
  import { flip } from "svelte/animate";
  import type { ComposeItem } from "../flows/compose.svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { Ellipsis, Pencil, X } from "./Icon";
  import IconButton from "./IconButton.svelte";
  import ItemNotes from "./ItemNotes.svelte";
  import { iconFor, typeLabel } from "./itemView";
  import { reducedMotion } from "./motion";

  type Props = {
    caption: string;
    items: ComposeItem[];
    helpId: string;
    onrename: (id: string) => void;
    onremove: (id: string) => void;
    onmenu: (id: string) => void;
    onmove: (id: string, delta: -1 | 1) => void;
    cannotOpen?: (item: ComposeItem) => boolean;
  };
  let { caption, items, helpId, onrename, onremove, onmenu, onmove, cannotOpen }: Props = $props();

  function key(e: KeyboardEvent, id: string) {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    if (items.length > 1) onmove(id, e.key === "ArrowUp" ? -1 : 1);
  }
</script>

<table class="ft">
  <caption class="sr-only">{caption}</caption>
  <thead>
    <tr>
      <th scope="col" class="c-name">{t("compose.col.name")}</th>
      <th scope="col" class="c-type">{t("compose.col.type")}</th>
      <th scope="col" class="c-size">{t("compose.col.size")}</th>
      <th scope="col" class="c-act"><span class="sr-only">{t("compose.col.actions")}</span></th>
    </tr>
  </thead>
  <tbody>
    {#each items as item (item.id)}
      {@const Icon = iconFor(item)}
      {@const name = item.base + item.ext}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <tr data-row={item.id} animate:flip={{ duration: reducedMotion() ? 0 : 180 }} onkeydown={(e) => key(e, item.id)}>
        <td class="c-name">
          <span class="cell">
            <span class={["ic", { risky: item.risky }]} aria-hidden="true"><Icon size={18} strokeWidth={1.7} /></span>
            <span class="txt">
              <bdi class="nm" title={name} translate="no"><span class="b">{item.base}</span><span class="e">{item.ext}</span></bdi>
              <ItemNotes {item} cannotOpen={cannotOpen?.(item) ?? false} />
            </span>
          </span>
        </td>
        <td class="c-type num">{typeLabel(item)}</td>
        <td class="c-size num">{formatBytes(item.size, getLang())}</td>
        <td class="c-act">
          <span class="acts">
            {#if items.length > 1}
              <IconButton label={t("compose.more", { name })} onpress={() => onmenu(item.id)} aria-describedby={helpId} data-menu><Ellipsis size={18} strokeWidth={1.8} /></IconButton>
            {/if}
            <IconButton label={t("compose.rename", { name })} onpress={() => onrename(item.id)}><Pencil size={17} strokeWidth={1.75} /></IconButton>
            <IconButton label={t("compose.remove", { name })} onpress={() => onremove(item.id)} data-remove><X size={17} strokeWidth={1.75} /></IconButton>
          </span>
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .ft {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: var(--fs-small);
  }
  th {
    padding: 0 var(--sp-3) var(--sp-2);
    color: var(--text-3);
    font-size: var(--fs-micro);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-align: start;
    text-transform: uppercase;
    border-bottom: 1px solid var(--hair-2);
  }
  td {
    padding: 10px var(--sp-3);
    vertical-align: middle;
    border-bottom: 1px solid var(--hair);
  }
  tbody tr {
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    tbody tr:hover {
      background: rgb(255 255 255 / 0.025);
    }
  }
  tbody tr:focus-within {
    background: rgb(255 255 255 / 0.035);
  }
  .c-type {
    width: 5.5rem;
    color: var(--text-2);
  }
  .c-size {
    width: 6.5rem;
    color: var(--text-2);
    text-align: end;
  }
  th.c-size {
    text-align: end;
  }
  .c-act {
    width: 9.5rem;
    padding-inline-end: 0;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
  }
  .cell {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-3);
    min-width: 0;
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.045);
    box-shadow: inset 0 0 0 1px var(--hair);
    color: var(--text-2);
  }
  .ic.risky {
    color: var(--danger);
  }
  .txt {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding-top: 7px;
  }
  .nm {
    display: flex;
    min-width: 0;
    color: var(--text);
    font-size: 0.9375rem;
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
  @media (prefers-reduced-motion: reduce) {
    tbody tr {
      transition: none;
    }
  }
</style>
