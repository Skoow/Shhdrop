<script lang="ts">
  // Écran d'envoi (UI §9.1, §9.2, §9.3) : l'accueil tant que la liste est vide ; dès le premier
  // élément (Parcourir, Photo, Vidéo, Texte, Coller, dépôt), une transition de vue ouvre le
  // composeur dans le réceptacle : liste par catégories, jauge, options, « Chiffrer et envoyer ».
  // Tout reste en mémoire (aucun stockage) ; l'envoi lui-même est la Task 17 (`onsend`).
  import { flushSync, tick } from "svelte";
  import { CONTENT_MAX, MAX_ITEMS, PW_MIN_CHARS, TEXT_MAX, checkPassword, generatePassword, type Item } from "../index";
  import { blockKey, createComposer, type AddReport, type Source } from "../flows/compose.svelte";
  import { fromClipboardRead, fromPasteEvent } from "../flows/intake";
  import { createOptions, estimateUpload, viewOnlyBlockers, type Rights } from "../flows/options.svelte";
  import { formatBytes, formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import CapacityGauge from "../ui/CapacityGauge.svelte";
  import CategoryGroup from "../ui/CategoryGroup.svelte";
  import { Camera, ClipboardPaste, Lock, Mic, Paperclip, ShieldAlert, Timer, Type, Video, X } from "../ui/Icon";
  import Sheet from "../ui/Sheet.svelte";
  import TextArea from "../ui/TextArea.svelte";
  import UndoToast from "../ui/UndoToast.svelte";
  import { runTransition } from "../ui/viewTransition";
  import Home, { type Action } from "./Home.svelte";
  import Options from "./Options.svelte";

  export type SendState = { items: Item[]; ttlHours: number; maxOpens: number; password: string; rights: Rights };
  type Props = {
    /** Envoi (Task 17). Sans lui : avis « Envoi : prochaine étape ». */
    onsend?: (state: SendState) => void;
    /** Droit « coffre » proposé (spec §27 : jamais en démo). */
    vaultAllowed?: boolean;
  };
  let { onsend, vaultAllowed = false }: Props = $props();

  let online = $state(typeof navigator === "undefined" || navigator.onLine !== false);

  const composer = createComposer({
    // Premier élément : transition de vue (rappel synchrone, K2) ; ensuite, mise à jour sur place.
    commit: (apply) => (composer.count === 0 ? viewChange(apply, focusTitle) : apply()),
    names: {
      photo: (n) => t("compose.name.photo", { n }),
      video: (n) => t("compose.name.video", { n }),
      pasted: (n) => t("compose.name.pasted", { n }),
      text: (n) => t("compose.name.text", { n }),
      voice: (n) => t("compose.name.voice", { n }),
    },
    online: () => online,
  });
  const options = createOptions({ generate: generatePassword, check: checkPassword, vaultAllowed: () => vaultAllowed });

  const filled = $derived(composer.count > 0);
  const lang = $derived(getLang());
  const num = (n: number) => new Intl.NumberFormat(lang).format(n);

  /** Changement d'écran (vide ↔ composeur) : transition de vue, puis `after` (focus). */
  let changing: Promise<void> = Promise.resolve();
  function viewChange(apply: () => void, after?: () => void) {
    changing = runTransition(() => flushSync(apply)).then(async () => {
      await tick();
      // K13 : seulement si le focus s'est perdu avec l'écran d'avant (jamais volé à un geste en cours).
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected || a.tagName === "MAIN") after?.();
    });
  }
  let title: HTMLHeadingElement | undefined = $state();
  function focusTitle() {
    title?.focus({ preventScroll: true });
  }
  function focusBrowse() {
    document.querySelector<HTMLButtonElement>(".browse")?.focus({ preventScroll: true });
  }

  // ---------- Avis (refus, presse-papier, envoi) : visibles et annoncés ----------
  type Note = { id: number; text: string; detail?: string };
  let notes = $state<Note[]>([]);
  let noteSeq = 0;
  let floating = $state("");
  let floatTimer: ReturnType<typeof setTimeout> | undefined;
  function say(text: string, detail?: string) {
    announce(detail ? `${text} ${detail}` : text);
    if (composer.count > 0) notes = [...notes.slice(-2), { id: ++noteSeq, text, detail }];
    else {
      floating = detail ? `${text} ${detail}` : text;
      clearTimeout(floatTimer);
      floatTimer = setTimeout(() => (floating = ""), 6000);
    }
  }
  $effect(() => () => clearTimeout(floatTimer));
  $effect(() => {
    if (!filled) notes = [];
  });

  function report(r: AddReport) {
    if (r.added.length > 0) announce(t("compose.added", { n: r.added.length }));
    for (const name of r.duplicates) announce(t("compose.duplicate.say", { name }));
    if (r.refusedCount.length > 0) say(t("compose.tooMany", { n: r.refusedCount.length, max: MAX_ITEMS }), r.refusedCount.join(", "));
    for (const name of r.unreadable) say(t("compose.unreadable", { name }));
    for (const name of r.failedClean) say(t("compose.failedClean", { name }));
  }

  async function addFiles(files: File[], source: Source, folders: string[] = []) {
    if (folders.length > 0) say(t("compose.folder"), folders.join(", "));
    if (files.length === 0) return;
    const r = await composer.add(files, source);
    await changing; // les avis vont dans le composeur s'il vient de s'ouvrir
    report(r);
  }

  // ---------- Ajouts depuis le composeur ----------
  const canVoice = typeof MediaRecorder !== "undefined";
  const canPaste = typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";
  let filesIn: HTMLInputElement | undefined = $state();
  let photoIn: HTMLInputElement | undefined = $state();
  let videoIn: HTMLInputElement | undefined = $state();
  function picked(input: HTMLInputElement, source: Source) {
    const list = [...(input.files ?? [])];
    input.value = "";
    void addFiles(list, source);
  }

  function act(a: Action) {
    if (a === "texte") openEditor(null, "");
    else if (a === "vocal") voiceOpen = true;
    else void pasteButton();
  }

  // ---------- Texte ----------
  let editorOpen = $state(false);
  let editorId = $state<string | null>(null);
  let editorText = $state("");
  const editorLen = $derived([...editorText].length);
  const editorTooLong = $derived(editorLen > TEXT_MAX);
  let editorEl: HTMLTextAreaElement | undefined = $state();
  function openEditor(id: string | null, text: string) {
    editorId = id;
    editorText = text;
    editorOpen = true;
    // Focus dans la zone de texte (showModal le mettrait sur « Fermer »), curseur à la fin.
    void tick().then(() =>
      requestAnimationFrame(() => {
        editorEl?.focus();
        editorEl?.setSelectionRange(editorText.length, editorText.length);
      }),
    );
  }
  function saveText() {
    if (editorTooLong || editorText.trim() === "") return;
    const id = editorId;
    const text = editorText;
    editorOpen = false;
    if (id) composer.updateText(id, text);
    else if (composer.addText(text) === null) say(t("compose.tooMany", { n: 1, max: MAX_ITEMS }));
    else announce(t("compose.added", { n: 1 }));
  }
  function editText(id: string) {
    const it = composer.items.find((i) => i.id === id);
    if (it) openEditor(id, it.text ?? "");
  }

  // ---------- Vocal (Task 12) ----------
  let voiceOpen = $state(false);

  // ---------- Coller ----------
  const isTextEntry = (n: Element | null) =>
    n instanceof HTMLTextAreaElement ||
    (n instanceof HTMLElement && n.isContentEditable) ||
    (n instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "file", "range", "color", "image"].includes(n.type));

  function onPaste(e: ClipboardEvent) {
    const r = fromPasteEvent(e, isTextEntry(document.activeElement));
    if (r.native) return;
    if (r.files.length === 0 && r.text === null) return;
    e.preventDefault();
    if (r.files.length > 0) void addFiles(r.files, "collage");
    else if (r.text !== null && !editorOpen) openEditor(null, r.text);
  }
  async function pasteButton() {
    try {
      const r = await fromClipboardRead(await navigator.clipboard.read(), (n, ext) => `${t("compose.name.pasted", { n })}.${ext}`);
      if (r.files.length > 0) await addFiles(r.files, "collage");
      else if (r.text !== null) openEditor(null, r.text);
      else say(t("compose.paste.empty"));
    } catch (err) {
      say(err instanceof DOMException && err.name === "NotAllowedError" ? t("compose.paste.denied") : t("compose.paste.empty"));
    }
  }

  // ---------- Retrait, annulation ----------
  type Toast = { id: number; message: string; undo: () => void; focusId?: string };
  let toast = $state<Toast | null>(null);
  // L'annonce d'annulation se pose au-dessus de la barre d'envoi collée (elle ne couvre pas le bouton).
  let barH = $state(0);
  let toastSeq = 0;

  async function focusRow(id: string | undefined) {
    await tick();
    const row = id ? document.querySelector(`[data-row="${CSS.escape(id)}"]`) : null;
    const btn = row?.querySelector<HTMLButtonElement>("[data-remove]");
    if (btn) btn.focus();
    else if (composer.count === 0) focusBrowse();
  }

  function remove(id: string) {
    const items = composer.items;
    const at = items.findIndex((i) => i.id === id);
    if (at < 0) return;
    const it = items[at]!;
    const next = items[at + 1]?.id ?? items[at - 1]?.id;
    const name = it.kind === "text" ? it.base : it.base + it.ext;
    const run = () => {
      const r = composer.remove(id);
      toast = { id: ++toastSeq, message: t("compose.removed", { name }), undo: r.undo, focusId: id };
    };
    if (composer.count === 1) viewChange(run, focusBrowse);
    else {
      run();
      void focusRow(next);
    }
  }
  function clearAll() {
    const n = composer.count;
    viewChange(() => {
      const r = composer.clear();
      toast = { id: ++toastSeq, message: t("compose.cleared", { n }), undo: r.undo };
    }, focusBrowse);
  }
  function undo() {
    const t0 = toast;
    if (!t0) return;
    toast = null;
    if (composer.count === 0) viewChange(t0.undo, () => void focusRow(t0.focusId));
    else {
      t0.undo();
      void focusRow(t0.focusId);
    }
  }

  function move(id: string, delta: -1 | 1) {
    const r = composer.move(id, delta);
    if (r !== "ok") {
      announce(t(r === "premier" ? "compose.move.first" : "compose.move.last"));
      return;
    }
    sayPosition(id);
    // Le nœud a changé de place dans le DOM (même nœud, déplacé) : le focus y revient.
    const was = document.activeElement;
    void tick().then(() => {
      if (was instanceof HTMLElement && was.isConnected && document.activeElement !== was) was.focus();
    });
  }
  function moveTo(id: string, index: number) {
    composer.moveTo(id, index);
    sayPosition(id);
  }
  const CAT = { texte: "compose.cat.text", photos: "compose.cat.photos", videos: "compose.cat.videos", audio: "compose.cat.audio", documents: "compose.cat.documents", autres: "compose.cat.autres" } as const;
  function sayPosition(id: string) {
    const it = composer.items.find((i) => i.id === id);
    const p = composer.positionOf(id);
    if (!it || !p) return;
    announce(t("compose.moved", { name: it.kind === "text" ? it.base : it.base + it.ext, i: p.index, n: p.of, category: t(CAT[p.category]) }));
  }

  // ---------- Envoi ----------
  const pwResult = $derived(options.mode === "custom" ? options.check() : null);
  const composerBlock = $derived(composer.blockReason());
  const optionsBlock = $derived(options.blockReason());
  const reasonText = $derived(
    composerBlock
      ? t(blockKey(composerBlock), { max: composerBlock === "trop_gros" ? formatBytes(CONTENT_MAX, lang) : num(TEXT_MAX) })
      : optionsBlock
        ? t(`options.block.${optionsBlock}`, { min: PW_MIN_CHARS })
        : "",
  );
  const estimate = $derived(estimateUpload(composer.totalBytes));
  const viewOnlyBlocked = $derived(viewOnlyBlockers(composer.items));
  const anyNotCleaned = $derived(composer.items.some((i) => i.clean === "non_nettoye"));

  function send() {
    if (reasonText) return;
    const state: SendState = { items: composer.toApiItems(), ttlHours: options.ttlHours, maxOpens: options.maxOpens, password: options.password, rights: options.rights };
    if (onsend) onsend(state);
    else say(t("compose.send.soon"));
  }

  // Quitter la page avec une liste non vide : la liste serait perdue (UI §9.2.9).
  $effect(() => {
    if (!filled) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  });

  const pasteKeys = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";
</script>

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />
<svelte:document onpaste={onPaste} />

{#snippet chip(label: string, Icon: typeof Lock, onclick: () => void)}
  <button type="button" class="chip" {onclick}>
    <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
    <span>{label}</span>
  </button>
{/snippet}

{#snippet app()}
  <div class="app">
    <div class="list-col">
      <div class="top">
        <h2 id="compose-title" class="title" tabindex="-1" bind:this={title}>{t("compose.title")}</h2>
        <button type="button" class="clear" onclick={clearAll}><X size={16} strokeWidth={2} aria-hidden="true" />{t("compose.clear")}</button>
      </div>

      <div class="adds" role="group" aria-label={t("compose.add.label")}>
        {@render chip(t("compose.add.files"), Paperclip, () => filesIn?.click())}
        {@render chip(t("compose.add.photo"), Camera, () => photoIn?.click())}
        {@render chip(t("compose.add.video"), Video, () => videoIn?.click())}
        {#if canVoice}{@render chip(t("compose.add.voice"), Mic, () => act("vocal"))}{/if}
        {@render chip(t("compose.add.text"), Type, () => act("texte"))}
        {#if canPaste}{@render chip(t("compose.add.paste"), ClipboardPaste, () => act("coller"))}{/if}
      </div>
      <input bind:this={filesIn} type="file" multiple hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "fichiers")} />
      <input bind:this={photoIn} type="file" accept="image/*" capture="environment" hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "photo")} />
      <input bind:this={videoIn} type="file" accept="video/*" capture="environment" hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "video")} />
      <p class="drop-hint">{t("compose.drop.hint", { keys: pasteKeys })}</p>

      {#if notes.length > 0}
        <ul class="notes">
          {#each notes as n (n.id)}
            <li class="cnote">
              <ShieldAlert size={18} strokeWidth={1.9} aria-hidden="true" />
              <span class="nt">{n.text}{#if n.detail}<span class="nd">{n.detail}</span>{/if}</span>
              <button type="button" class="nx" aria-label={t("common.close")} onclick={() => (notes = notes.filter((x) => x.id !== n.id))}><X size={16} strokeWidth={2} aria-hidden="true" /></button>
            </li>
          {/each}
        </ul>
      {/if}

      <p id="move-help" class="sr-only">{t("compose.move.help")}</p>
      <div class="groups">
        {#each composer.groups() as g (g.category)}
          <CategoryGroup
            category={g.category}
            items={g.items}
            bytes={g.bytes}
            helpId="move-help"
            onremove={remove}
            onrename={(id, b) => composer.rename(id, b)}
            onedit={editText}
            onmove={move}
            onmoveto={moveTo}
          />
        {/each}
      </div>

      <div class="trust">
        <p><Lock size={15} strokeWidth={2} aria-hidden="true" />{t("compose.trust.names")}</p>
        {#if anyNotCleaned}<p class="legend"><ShieldAlert size={15} strokeWidth={2} aria-hidden="true" />{t("compose.meta.legend")}</p>{/if}
      </div>
    </div>

    <div class="side">
      <Options {options} {pwResult} {viewOnlyBlocked} {vaultAllowed} pwErrorId={optionsBlock ? "send-reason" : undefined} />
      <p class="estimate num">
        <Timer size={16} strokeWidth={1.9} aria-hidden="true" />
        <span>{t("options.estimate", { fast: formatDuration(estimate.fastS, lang), slow: formatDuration(estimate.slowS, lang) })} <span class="en">{t("options.estimate.note")}</span></span>
      </p>
      <div class="sendbar" bind:clientHeight={barH}>
        <CapacityGauge bytes={composer.totalBytes} count={composer.count} />
        <Button variant="primary" lock disabled={reasonText !== ""} aria-describedby={reasonText ? "send-reason" : undefined} onpress={send}>{t("options.submit")}</Button>
        {#if reasonText}<p id="send-reason" class="reason">{reasonText}</p>{/if}
      </div>
    </div>
  </div>
{/snippet}

<Home compact={filled} children={filled ? app : undefined} onfiles={(f, s, folders) => void addFiles(f, s, folders)} onaction={act} />

<Sheet bind:open={editorOpen} title={editorId ? t("text.title.edit") : t("text.title.new")}>
  <div class="editor">
    <TextArea
      label={t("text.label")}
      bind:value={editorText}
      bind:el={editorEl}
      rows={8}
      autocomplete="off"
      {...{ autocorrect: "off" } as Record<string, string>}
      autocapitalize="off"
      spellcheck={false}
      translate="no"
      hint={t("text.private")}
      error={editorTooLong ? t("text.tooLong", { max: num(TEXT_MAX) }) : undefined}
    />
    <p class={["count", "num", { over: editorTooLong }]} aria-hidden="true">{t("text.count", { n: num(editorLen), max: num(TEXT_MAX) })}</p>
    <div class="ed-acts">
      <Button variant="ghost" onpress={() => void (editorOpen = false)}>{t("common.cancel")}</Button>
      <Button variant="primary" disabled={editorTooLong || editorText.trim() === ""} onpress={saveText}>{editorId ? t("text.save") : t("text.add")}</Button>
    </div>
  </div>
</Sheet>

<Sheet bind:open={voiceOpen} title={t("compose.voice.title")}>
  <p class="soon">{t("compose.soon.voice")}</p>
</Sheet>

{#if toast}
  <div class="toast-slot" style:--lift="{filled ? barH : 0}px">
    {#key toast.id}
      <UndoToast message={toast.message} onundo={undo} ondismiss={() => (toast = null)} onclose={() => undefined} />
    {/key}
  </div>
{/if}

<p class={["floating", { on: floating !== "" }]} aria-hidden="true">{floating}</p>

<style>
  .app {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-5);
    padding: var(--sp-4) var(--sp-3) 0 var(--sp-3);
  }
  .list-col {
    display: grid;
    gap: var(--sp-3);
    align-content: start;
    min-width: 0;
  }
  .side {
    display: contents;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding-inline: 4px;
  }
  .title {
    font-size: var(--fs-h3);
    font-weight: 640;
    letter-spacing: -0.01em;
  }
  .title:focus {
    outline: none;
  }
  .clear {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
  }
  @media (hover: hover) {
    .clear:hover {
      color: var(--text);
      background: rgb(255 255 255 / 0.05);
    }
  }
  .adds {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 2.875rem), 1fr));
    gap: 6px;
  }
  .chip {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 4px;
    min-width: 0;
    min-height: 64px;
    padding: var(--sp-2) 2px;
    border: 0;
    border-radius: 16px;
    background: rgb(255 255 255 / 0.045);
    box-shadow:
      inset 0 0 0 1px var(--hair),
      inset 0 1px 0 rgb(255 255 255 / 0.05);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-micro);
    font-weight: 560;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .chip span {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .chip :global(svg) {
    color: var(--text-2);
    transition: color var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .chip:hover {
      background: rgb(255 255 255 / 0.075);
    }
    .chip:hover :global(svg) {
      color: var(--accent);
    }
  }
  .chip:active {
    transform: scale(0.95);
  }
  .drop-hint {
    display: none;
    margin: 0;
    padding-inline: 4px;
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  @media (hover: hover) and (pointer: fine) {
    .drop-hint {
      display: block;
    }
  }
  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-2);
  }
  .cnote {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--sp-2);
    align-items: start;
    padding: 10px 6px 10px 12px;
    border-radius: 12px;
    background: var(--warn-tint);
    color: var(--text);
    font-size: var(--fs-small);
    line-height: 1.45;
  }
  .cnote > :global(svg) {
    margin-top: 1px;
    color: var(--warn);
  }
  .nt {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .nd {
    display: block;
    color: var(--text-2);
  }
  .nx {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin: -10px 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }
  .groups {
    display: grid;
    gap: var(--sp-2);
  }
  .trust {
    display: grid;
    gap: 6px;
    padding: var(--sp-2) 4px 0;
    border-top: 1px solid var(--hair);
  }
  .trust p {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.45;
  }
  .trust p :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
  .trust .legend :global(svg) {
    color: var(--warn);
  }

  /* Barre d'actions : jauge, estimation, bouton ; collée en bas sur téléphone (zone du pouce). */
  .sendbar {
    position: sticky;
    inset-block-end: 0;
    z-index: 3;
    display: grid;
    gap: var(--sp-3);
    margin-inline: calc(-1 * var(--sp-3));
    padding: var(--sp-3) var(--sp-4) calc(var(--sp-4) + env(safe-area-inset-bottom, 0px));
    border-radius: 0 0 var(--r-2xl) var(--r-2xl);
    /* Verre mobile presque opaque : la jauge reste lisible sur la liste qui défile dessous. */
    background: rgb(13 15 20 / 0.94);
    -webkit-backdrop-filter: blur(18px) saturate(1.2);
    backdrop-filter: blur(18px) saturate(1.2);
    box-shadow: 0 -1px 0 var(--hair);
  }
  .sendbar :global(.btn) {
    width: 100%;
    min-height: 56px;
    border-radius: 14px;
    font-size: 1.0625rem;
  }
  .estimate {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.45;
  }
  .estimate > :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--text-3);
  }
  .toast-slot :global(.toast) {
    inset-block-end: calc(var(--lift) + var(--sp-3) + env(safe-area-inset-bottom, 0px));
  }
  .estimate .en {
    color: var(--text-3);
  }
  .reason {
    margin: -4px 0 0;
    color: var(--warn);
    font-size: var(--fs-small);
    text-align: center;
  }
  :global(html.kbd-open) .sendbar {
    position: static;
  }
  @media (max-height: 500px) and (orientation: landscape) {
    .sendbar {
      position: static;
    }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .sendbar {
      background: var(--surface-1);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .sendbar {
      background: var(--surface-1);
    }
  }

  @media (min-width: 600px) {
    .app {
      padding: var(--sp-5) var(--sp-5) 0;
    }
    .sendbar {
      margin-inline: calc(-1 * var(--sp-5));
      padding-inline: var(--sp-5);
    }
  }
  /* Ordinateur : deux colonnes, composer | options ; le bouton en fin de colonne, collé en bas. */
  @media (min-width: 960px) {
    .app {
      grid-template-columns: minmax(0, 1fr) minmax(340px, 400px);
      column-gap: 40px;
      padding: var(--sp-6) var(--sp-6) var(--sp-6);
    }
    .side {
      display: grid;
      gap: var(--sp-5);
      align-content: start;
      padding-inline-start: 40px;
      margin-inline-start: -40px;
      border-inline-start: 1px solid var(--hair);
    }
    .sendbar {
      margin: 0;
      padding: var(--sp-4) 0 var(--sp-2);
      border-radius: 0;
      background: #0f1218;
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow:
        0 -28px 24px -12px #0f1218,
        0 -1px 0 var(--hair);
    }
  }

  .editor {
    display: grid;
    gap: var(--sp-3);
  }
  .count {
    margin: -6px 0 0;
    color: var(--text-3);
    font-size: var(--fs-small);
    text-align: end;
  }
  .count.over {
    color: var(--danger);
  }
  .ed-acts {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
  }
  .soon {
    margin: 0;
    color: var(--text-2);
  }

  .floating {
    position: fixed;
    left: 50%;
    bottom: max(var(--sp-5), env(safe-area-inset-bottom));
    z-index: 40;
    width: max-content;
    max-width: calc(100vw - 32px);
    margin: 0;
    padding: var(--sp-3) 18px;
    border-radius: 14px;
    background: var(--surface-3);
    color: var(--text);
    font-weight: 520;
    box-shadow: var(--e-3), inset 0 0 0 1px var(--hair-2);
    opacity: 0;
    visibility: hidden;
    transform: translate(-50%, 12px);
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform 500ms var(--ease-settle),
      visibility 0s linear var(--dur-base);
  }
  .floating.on {
    opacity: 1;
    visibility: visible;
    transform: translate(-50%, 0);
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform 500ms var(--ease-settle);
  }
  @media (prefers-reduced-motion: reduce) {
    .chip,
    .floating {
      transition: none;
    }
    .chip:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .chip,
    .cnote {
      border: 1px solid ButtonText;
      box-shadow: none;
    }
    .sendbar {
      background: Canvas;
      border-top: 1px solid CanvasText;
    }
  }
</style>
