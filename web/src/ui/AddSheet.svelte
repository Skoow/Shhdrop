<script lang="ts">
  // Feuille « Ajouter » (téléphone) : une liste groupée façon app native, au lieu d'une rangée
  // de boutons. Chaque ligne : icône maison, action, précision honnête. Rien n'est en double.
  import { flushSync } from "svelte";
  import type { AddGroup, AddId } from "../flows/add-actions";
  import { t, type Key } from "../i18n/i18n.svelte";
  import AddIcon from "./AddIcon.svelte";
  import { ChevronDown } from "./Icon";
  import Sheet from "./Sheet.svelte";

  type Props = { open: boolean; groups: AddGroup[]; onpick: (id: AddId, live: boolean) => void };
  let { open = $bindable(false), groups, onpick }: Props = $props();

  function pick(id: AddId, live: boolean) {
    // Fermeture synchrone (flushSync : le <dialog> modal se ferme tout de suite, la page n'est
    // plus inerte), puis l'action, dans le même geste : un <input type="file"> peut s'ouvrir.
    flushSync(() => (open = false));
    onpick(id, live);
  }
  const sub = (id: AddId, live: boolean): Key => (id === "photo" || id === "video") && !live ? `add.${id}.sys` : `add.${id}.sub`;
</script>

<Sheet bind:open title={t("add.title")}>
  <div class="groups">
    {#each groups as g (g.id)}
      <section class="grp" aria-labelledby="add-g-{g.id}">
        <h3 id="add-g-{g.id}">{t(`add.group.${g.id}`)}</h3>
        <ul>
          {#each g.actions as a (a.id)}
            <li>
              <button type="button" class={["row", a.id]} data-add={a.id} onclick={() => pick(a.id, a.live)}>
                <span class="ic"><AddIcon id={a.id} /></span>
                <span class="tx">
                  <span class="lb">{t(`add.${a.id}`)}</span>
                  <span class="sb">{t(sub(a.id, a.live))}</span>
                </span>
                <span class="chev" aria-hidden="true"><ChevronDown size={18} strokeWidth={1.9} /></span>
              </button>
            </li>
          {/each}
        </ul>
        {#if g.id === "capture" && g.actions.some((a) => a.live)}<p class="foot">{t("add.capture.note")}</p>{/if}
      </section>
    {/each}
  </div>
</Sheet>

<style>
  .groups {
    display: grid;
    gap: var(--sp-5);
  }
  .grp {
    display: grid;
    gap: var(--sp-2);
  }
  h3 {
    margin: 0;
    padding-inline: var(--sp-1);
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 560;
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
  .row.gallery .ic,
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
  .foot {
    margin: 0;
    padding-inline: var(--sp-1);
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  @media (forced-colors: active) {
    .row {
      border: 1px solid CanvasText;
    }
  }
</style>
