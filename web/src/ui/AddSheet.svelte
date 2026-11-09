<script lang="ts">
  // Feuille « Ajouter » (téléphone) : une liste façon app native, quatre lignes : Photo ou vidéo
  // (caméra intégrée, qui mène aussi à la galerie), Vocal, Note, Fichiers. Icône maison, action,
  // précision honnête. Rien n'est en double.
  import { flushSync } from "svelte";
  import type { AddAction, AddId } from "../flows/add-actions";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { formatDuration } from "../i18n/format";
  import { CAPTURE_MAX_S, CAPTURE_TIER } from "../limits";
  import { limitParams } from "../i18n/limit-params";
  import AddIcon from "./AddIcon.svelte";
  import { ChevronDown } from "./Icon";
  import Sheet from "./Sheet.svelte";

  type Props = { open: boolean; actions: AddAction[]; onpick: (id: AddId, live: boolean) => void };
  let { open = $bindable(false), actions, onpick }: Props = $props();

  function pick(id: AddId, live: boolean) {
    // Fermeture synchrone (flushSync : le <dialog> modal se ferme tout de suite, la page n'est
    // plus inerte), puis l'action, dans le même geste : un <input type="file"> peut s'ouvrir.
    flushSync(() => (open = false));
    onpick(id, live);
  }
  const sub = (a: AddAction): string =>
    a.id === "media"
      ? t(a.live ? "add.media.sub" : "add.media.sys")
      : a.id === "voice"
        ? t("add.voice.sub", { max: formatDuration(CAPTURE_MAX_S[CAPTURE_TIER].voice, getLang()) })
        : t(`add.${a.id}.sub`);
</script>

<Sheet bind:open title={t("add.title")}>
  <ul>
    {#each actions as a (a.id)}
      <li>
        <button type="button" class={["row", a.id]} data-add={a.id} onclick={() => pick(a.id, a.live)}>
          <span class="ic"><AddIcon id={a.id} /></span>
          <span class="tx">
            <span class="lb">{t(`add.${a.id}`)}</span>
            <span class="sb">{sub(a)}</span>
          </span>
          <span class="chev" aria-hidden="true"><ChevronDown size={18} strokeWidth={1.9} /></span>
        </button>
      </li>
    {/each}
  </ul>
  <!-- Limites gratuites, aussi sur téléphone (retours UI5) : la zone de dépôt ne s'y affiche pas. -->
  <p class="lim num" data-limits>{t("compose.drop.limit", limitParams(getLang()))}</p>
</Sheet>

<style>
  .lim {
    margin: var(--sp-3) 0 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    text-align: center;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: var(--r-lg);
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px var(--hair);
    overflow: hidden;
  }
  li + li .row::before {
    /* Séparateur qui commence après l'icône, comme une liste native. */
    content: "";
    position: absolute;
    inset-block-start: 0;
    inset-inline: 68px 0;
    border-block-start: 1px solid var(--hair);
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 18px;
    align-items: center;
    gap: var(--sp-3) var(--sp-4);
    width: 100%;
    min-height: 64px;
    padding: var(--sp-3) var(--sp-4);
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: background-color 120ms var(--ease-out);
  }
  .row:active {
    background: var(--surface-3);
  }
  @media (hover: hover) {
    .row:hover {
      background: var(--surface-2);
    }
  }
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--r-lg);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--accent-tint);
    color: var(--accent);
  }
  .row.note .ic,
  .row.files .ic {
    background: var(--surface-3);
    color: var(--text);
  }
  .tx {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .lb {
    font-weight: 560;
  }
  .sb {
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
  }
  .chev {
    display: grid;
    color: var(--text-3);
    transform: rotate(-90deg);
  }
  @media (forced-colors: active) {
    .row {
      border: 1px solid CanvasText;
    }
  }
</style>
