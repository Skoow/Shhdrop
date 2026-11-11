<script lang="ts">
  // Ligne du composeur (UI §9.2.4) : icône de format (toucher ou cliquer : aperçu, si permis),
  // nom (<bdi>, troncature au milieu qui garde l'extension), taille et durée, badges, actions
  // (renommer ou modifier, supprimer ; ordinateur : Nettoyer, Réessayer en lien), poignée et
  // mode déplacement. Téléphone : tout passe par le menu « … ». Nom déjà passé par cleanName.
  import { swipeToRemove } from "./swipe";
  import { reducedMotion } from "./motion";
  import { midSplit } from "./midname";
  import { tick } from "svelte";
  import type { ComposeItem } from "../flows/compose.svelte";
  import { NAME_MAX } from "../index";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { formatClock, mediaDuration } from "../media/duration";
  import { ArrowDown, ArrowUp, Ellipsis, Pencil, X } from "./Icon";
  import type { canClean } from "../flows/compose.svelte";
  import ItemNotes from "./ItemNotes.svelte";
  import CleanMark from "./CleanMark.svelte";
  import { cleanLineKey, cleanMark } from "../media/clean-label";
  import LockMark from "./LockMark.svelte";
  import { sendLock } from "./lock";
  import { formatBytes } from "../i18n/format";
  import type { RowStatus } from "../flows/preupload";
  import FormatIcon from "./FormatIcon.svelte";
  import { formatOf, typeKey } from "./formats";
  import IconButton from "./IconButton.svelte";
  import ReorderHandle from "./ReorderHandle.svelte";
  import VoiceClip from "./VoiceClip.svelte";

  type Props = {
    item: ComposeItem;
    /** La catégorie a au moins deux éléments : poignée et déplacement. */
    movable: boolean;
    helpId: string;
    onremove: () => void;
    onrename: (base: string) => null | "vide" | "trop_long" | "interdit";
    onedit: () => void;
    onmove: (delta: -1 | 1) => void;
    ondragstart: (y: number) => void;
    ondragmove: (y: number) => void;
    ondragend: (commit: boolean) => void;
    /** Téléphone : ni poignée ni boutons sur la ligne, un menu « … » (feuille d'actions). */
    compact?: boolean;
    onmenu?: () => void;
    /** Sans téléchargement, le destinataire ne pourra pas l'ouvrir (spec §34). */
    cannotOpen?: boolean;
    /** En cause d'un blocage ou d'un risque (S6). */
    danger?: boolean;
    /** Bouton « Supprimer » (le parent y remet le focus après un déplacement ou une annulation). */
    el?: HTMLDivElement | undefined;
    /** Envoi dès l'ajout (spec §41.14) : état de la ligne ; absent pour un texte. */
    upload?: RowStatus | null;
    onretry?: () => void;
    /** Aperçu permis (itemView.composePreview) : l'icône devient un bouton. */
    onpreview?: () => void;
    /** « Nettoyer » (Original) ou « Réessayer » (échec du nettoyage), et son action. */
    fix?: ReturnType<typeof canClean>;
    onclean?: () => void;
    cleaning?: boolean;
  };
  let { item, movable, helpId, onremove, onrename, onedit, onmove, ondragstart, ondragmove, ondragend, compact = false, onmenu, cannotOpen = false, danger = false, el = $bindable(), upload = null, onretry, onpreview, fix = null, onclean, cleaning = false }: Props = $props();

  // Vocal pris ici : l'extension (.webm, .m4a) reste interne, jamais affichée ni modifiable.
  const shownExt = $derived(item.kind === "text" || item.voice ? "" : item.ext);
  const name = $derived(item.base + shownExt);
  const mid = $derived(midSplit(item.base));
  const format = $derived(formatOf({ kind: item.kind, ext: item.ext.slice(1).toLowerCase(), sniffed: item.sniffed ?? null }));

  let duration = $state<number | null>(null);
  $effect(() => {
    // Vocal pris ici : sa durée vient de l'enregistrement (VoiceClip l'affiche).
    if (item.kind !== "file" || item.voice || (item.category !== "videos" && item.category !== "audio") || !(item.data instanceof Blob)) return;
    let live = true;
    void mediaDuration(item.data, item.category === "videos" ? "video" : "audio").then((d) => {
      if (live) duration = d;
    });
    return () => {
      live = false;
    };
  });

  // Renommage en place : base sélectionnée, extension à part et non modifiable.
  let editing = $state(false);
  let draft = $state("");
  let error = $state<null | "vide" | "trop_long" | "interdit">(null);
  let input: HTMLInputElement | undefined = $state();
  let renameBtn: HTMLButtonElement | undefined = $state();
  const uid = $props.id();

  async function startRename() {
    draft = item.base;
    error = null;
    editing = true;
    await tick();
    input?.focus();
    input?.select();
  }
  async function finishRename(commit: boolean) {
    if (!editing) return;
    if (commit && draft !== item.base) {
      const r = onrename(draft);
      if (r) {
        error = r;
        return;
      }
    }
    editing = false;
    error = null;
    await tick();
    renameBtn?.focus();
  }
  function renameKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void finishRename(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void finishRename(false);
    }
  }
  function renameBlur() {
    // Perte de focus : valide si le nom est bon, sinon revient au nom d'avant (jamais de piège).
    if (!editing) return;
    if (draft !== item.base) onrename(draft);
    editing = false;
    error = null;
  }

  // Mode déplacement (lecteurs d'écran au toucher, sans Alt).
  let moving = $state(false);
  let upBtn: HTMLButtonElement | undefined = $state();
  let grip: HTMLSpanElement | undefined = $state();
  async function openMove() {
    if (!movable) return;
    moving = true;
    await tick();
    upBtn?.focus();
  }
  async function closeMove() {
    moving = false;
    await tick();
    grip?.querySelector("button")?.focus();
  }

  function key(e: KeyboardEvent) {
    if (editing) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      if (movable) onmove(e.key === "ArrowUp" ? -1 : 1);
    } else if (moving && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void closeMove();
    }
  }
  $effect(() => {
    if (!movable && moving) moving = false;
  });
  // Chaque ligne a son cadenas (UI5) : un texte reste gris, il part dans le manifeste au clic.
  const lock = $derived(sendLock(upload));
  // Nettoyage (D41-34) : 2ᵉ ligne de la bulle du cadenas ; sur la ligne, une étincelle si nettoyé,
  // une pastille ambre si le nettoyage a échoué, rien si le fichier part tel quel.
  const cleanLine = $derived(cleanLineKey(item));
  const mark = $derived(cleanMark(item));
</script>

<!-- Alt + ↑/↓ depuis la poignée ou un bouton de la ligne (l'événement remonte). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={el} class={["row", { editing, moving, compact, danger }]} onkeydown={key} {@attach compact && !editing ? swipeToRemove(onremove, { reduced: reducedMotion() }) : null}>
  {#if compact}
    <!-- Téléphone : ni poignée ni déplacement (décision du propriétaire, retours UI6). -->
  {:else if movable}
    <span class="grip-slot" bind:this={grip}>
      <ReorderHandle {name} describedby={helpId} onactivate={() => (moving ? closeMove() : openMove())} onstart={ondragstart} onmove={ondragmove} onend={ondragend} />
    </span>
  {:else}
    <span class="grip-slot" aria-hidden="true"></span>
  {/if}

  <span class="pic">
    <!-- Nom du bouton par son contenu (texte masqué) : l'icône, décorative, n'y entre pas. -->
    {#if onpreview}
      <button type="button" class="peek" onclick={onpreview} data-preview><FormatIcon {format} /><span class="sr-only">{t("compose.preview", { name })}</span></button>
    {:else}
      <FormatIcon {format} />
    {/if}
    <LockMark badge tone={lock.tone} text={t(lock.key, { n: lock.n })} detail={cleanLine ? t(cleanLine) : undefined} role={lock.tone === "error" ? "alert" : undefined} />
  </span>

  <div class="main">
    {#if editing}
      <div class="rename">
        <label class="sr-only" for="{uid}-in">{t("compose.rename.field", { name })}</label>
        <span class="field">
          <input
            id="{uid}-in"
            bind:this={input}
            bind:value={draft}
            type="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            translate="no"
            enterkeyhint="done"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? `${uid}-err` : undefined}
            onkeydown={renameKey}
            onblur={renameBlur}
          />
          {#if shownExt}<span class="ext" translate="no">{shownExt}</span>{/if}
        </span>
        {#if error}<p id="{uid}-err" class="err" role="alert">{t(`compose.rename.${error}`, { max: NAME_MAX })}</p>{/if}
      </div>
    {:else}
      <span class="head">
        <!-- Bouclier de nettoyage AVANT le nom (retours CLEAN2), dans un emplacement de largeur fixe,
             vide s'il n'y a rien à dire : tous les noms commencent au même endroit. -->
        <span class="cslot">{#if mark && cleanLine}<CleanMark kind={mark} text={t(cleanLine)} />{/if}</span>
        <bdi class="nm" title={name} translate="no">
          <span class="b">{mid.head}</span><span class="e">{mid.tail}{shownExt}</span>
        </bdi>
      </span>
      <span class="meta">
        <!-- Une note ne montre que son titre, jamais son contenu (retour propriétaire). -->
        <span class="ty">{t(item.kind === "text" ? "compose.cat.text" : typeKey(format))}</span><span class="sep" aria-hidden="true">·</span>
        <span class="num">{formatBytes(item.size, getLang())}</span>
        {#if duration !== null}<span class="sep" aria-hidden="true">·</span><span class="num">{formatClock(duration)}</span>{/if}
        {#if upload}
          <!-- État de l'envoi : barre et Réessayer seulement ; le libellé est dans la bulle du cadenas. -->
          {@const busy = upload.key === "compose.up.envoi" || upload.key === "compose.up.chiffrement"}
          {@const retry = !compact && !fix && upload.key === "compose.up.erreur" && !!onretry}
          {#if busy || retry}<span class="sep" aria-hidden="true">·</span>{/if}
          <span class={["up", upload.key.slice(11)]} data-up={upload.key.slice(11)}>
            {#if busy}<span class="bar" aria-hidden="true"><span style:width="{upload.percent}%"></span></span>{/if}
            {#if retry}<button type="button" class="retry" onclick={onretry} aria-label={t("compose.up.retry", { name })}>{t("common.retry")}</button>{/if}
          </span>
        {/if}
        {#if !compact && fix && onclean}
          <span class="sep" aria-hidden="true">·</span>
          <button type="button" class="retry" onclick={onclean} disabled={cleaning} aria-label={t(fix === "nettoyer" ? "compose.clean.item" : item.clean === "echec" ? "compose.clean.retry" : "compose.up.retry", { name })} data-fix={fix}>{cleaning ? t("compose.cleaning") : t(fix === "nettoyer" ? "compose.clean.short" : "common.retry")}</button>
        {/if}
        <ItemNotes {item} {cannotOpen} badgesOnly />
      </span>
      <ItemNotes {item} {cannotOpen} lines />
    {/if}
  </div>

  <div class="acts">
    {#if compact}
      <IconButton label={t("compose.more", { name })} onpress={() => onmenu?.()} data-menu><Ellipsis size={20} strokeWidth={1.9} /></IconButton>
    {:else if moving}
      <button bind:this={upBtn} type="button" class="mv" onclick={() => onmove(-1)}><ArrowUp size={18} strokeWidth={1.75} aria-hidden="true" /><span class="sr-only">{t("compose.move.up")}</span></button>
      <button type="button" class="mv" onclick={() => onmove(1)}><ArrowDown size={18} strokeWidth={1.75} aria-hidden="true" /><span class="sr-only">{t("compose.move.down")}</span></button>
      <button type="button" class="done" onclick={closeMove}>{t("compose.move.done")}</button>
    {:else if !editing}
      {#if item.kind === "text"}
        <IconButton label={t("compose.edit", { name: item.base })} onpress={onedit}><Pencil size={18} strokeWidth={1.75} /></IconButton>
      {:else}
        <IconButton bind:el={renameBtn} label={t("compose.rename", { name })} onpress={startRename}><Pencil size={18} strokeWidth={1.75} /></IconButton>
      {/if}
      <IconButton label={t("compose.remove", { name })} onpress={onremove} data-remove><X size={18} strokeWidth={1.75} /></IconButton>
    {/if}
  </div>

  {#if item.voice && item.data instanceof Blob}
    <!-- Rangée dédiée, centrée dans la ligne entière ; hors du bloc de renommage : la lecture continue. -->
    <div class="voice"><VoiceClip blob={item.data} peaks={item.voice.peaks} ms={item.voice.ms} {name} size="mini" /></div>
  {/if}
</div>

<style>
  .voice {
    grid-column: 1 / -1;
    justify-self: center;
    display: flex;
    justify-content: center;
    width: 100%;
    max-width: 16rem;
    margin-block: var(--sp-2) 4px;
  }
  /* Centrée sur le rectangle de la ligne, pas sur sa zone de contenu (rembourrages inégaux :
     4 px à droite sur ordinateur ; aucun sur téléphone). */
  .voice {
    translate: 2px 0;
  }
  .compact .voice {
    translate: none;
  }
  .voice :global(.clip) {
    flex: 1;
  }
  /* Icône = bouton d'aperçu (44 px) ; le cadenas, posé au coin, reste au-dessus. */
  .peek {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    cursor: zoom-in;
    touch-action: manipulation;
  }
  .peek:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    .peek:hover {
      background: rgb(255 255 255 / 0.05);
    }
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto auto;
    align-items: center;
    column-gap: 10px;
    min-height: 48px;
    padding: 2px 4px 2px 0;
    border-radius: 16px;
    background: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .row:hover {
      background: rgb(255 255 255 / 0.025);
    }
  }
  .row.moving {
    background: var(--surface-3);
    box-shadow: var(--e-2), inset 0 0 0 1px var(--hair-2);
  }
  .row.danger {
    background: var(--danger-tint);
    box-shadow: inset 3px 0 0 var(--danger);
  }
  /* Glisser pour retirer : la ligne, opaque, couvre le fond rouge tant qu'elle n'a pas bougé. */
  .row.compact:global(.swiping) {
    background: var(--bg);
  }
  .row.compact:global(.swipe-back) {
    transition: translate 220ms var(--ease-out);
  }
  .row.compact {
    touch-action: pan-y;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    min-height: 60px;
    padding: 6px 0;
  }
  /* Poignée de déplacement à droite, juste avant les actions (retours TABLE) : l'icône et le
     nom commencent au bord de la ligne. Placement visuel seulement (order) : l'ordre de
     tabulation suit le DOM (poignée, aperçu, actions). */
  .grip-slot {
    order: 3;
    display: inline-flex;
    width: 32px;
    justify-content: center;
  }
  .acts {
    order: 4;
  }
  .voice {
    order: 5;
  }
  .grip-slot :global(.grip) {
    margin-inline: -6px;
  }
  /* Icône alignée sur le mot de la catégorie (« Photos ») au-dessus (retours CLEAN3) : le dessin
     (28 px) est centré dans sa cible de 44 px, donc 8 px à gauche ; le bandeau de catégorie a
     10 px de retrait (CategoryGroup) : 2 px de plus suffisent. */
  .pic {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-inline-start: 2px;
  }
  .main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    /* Le bouclier de nettoyage (flex: none) suit le nom ; seul le nom rétrécit (ellipse au milieu). */
    gap: 0;
    min-width: 0;
  }
  /* Avertissements sous le nom : même retrait que la 2ᵉ ligne. */
  .main > :global(.line) {
    margin-inline-start: 21px;
  }
  .cslot {
    flex: none;
    display: inline-flex;
    align-items: center;
    width: 15px;
    margin-inline-end: 6px;
  }
  .nm {
    display: flex;
    min-width: 0;
    font-weight: 560;
    line-height: 1.35;
  }
  .b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .e {
    flex: none;
    /* pre : l'espace en tête de la queue (« … 2026.jpg ») reste visible. */
    white-space: pre;
  }
  .up {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1, 4px);
  }
  .up.erreur {
    color: var(--danger, #b3261e);
  }
  .up .bar {
    inline-size: 2.5rem;
    block-size: 3px;
    border-radius: 2px;
    background: var(--line, rgb(0 0 0 / 0.12));
    overflow: hidden;
  }
  .up .bar > span {
    display: block;
    block-size: 100%;
    background: var(--accent, currentColor);
  }
  .retry:disabled {
    cursor: progress;
    text-decoration: none;
    color: var(--text-3);
  }
  .retry {
    position: relative;
    font: inherit;
    color: inherit;
    text-decoration: underline;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  /* Cible d'appui de 44 px de haut (audit M21) sans rien changer au dessin. */
  .retry::after {
    content: "";
    position: absolute;
    inset: -13px -4px;
  }
  /* 2ᵉ ligne (type, taille…) alignée sur le début du nom, après l'emplacement du bouclier
     (15 px + 6 px, .cslot) : retours CLEAN3. */
  .meta {
    display: flex;
    flex-wrap: wrap;
    min-width: 0;
    align-items: center;
    gap: 4px 8px;
    padding-inline-start: 21px;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .sep {
    margin-inline: -4px;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .mv,
  .done {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 44px;
    padding: 0 10px;
    border: 1px solid var(--hair-2);
    border-radius: 10px;
    background: rgb(255 255 255 / 0.045);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 560;
    cursor: pointer;
    touch-action: manipulation;
  }
  .done {
    background: var(--accent);
    border-color: transparent;
    color: var(--on-accent);
  }
  .rename {
    display: grid;
    gap: 4px;
  }
  .field {
    display: flex;
    align-items: center;
    min-width: 0;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--surface-1);
  }
  .field:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .field input {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: max(1rem, 16px);
    outline: none;
  }
  .field input[aria-invalid="true"] {
    color: var(--danger);
  }
  .ext {
    padding-inline-end: 10px;
    color: var(--text-3);
  }
  .err {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-small);
  }
  /* Très petit écran : la taille passe sous le nom, déjà le cas ; les actions se serrent. */
  @media (max-width: 359px) {
    .row {
      column-gap: var(--sp-2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .row {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .row.moving {
      outline: 2px solid Highlight;
    }
  }
</style>
