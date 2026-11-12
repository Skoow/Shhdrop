<script lang="ts">
  // Écran d'envoi (UI §9.1, §9.2, §9.3) : l'accueil tant que la liste est vide ; dès le premier
  // élément (Parcourir, Photo, Vidéo, Texte, Coller, dépôt), une transition de vue ouvre le
  // composeur dans le réceptacle : liste par catégories, jauge, options, « Chiffrer et envoyer ».
  // Tout reste en mémoire (aucun stockage) ; l'envoi lui-même est la Task 17 (`onsend`).
  import { flushSync, tick, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { chrome } from "../app/chrome.svelte";
  import { CONTENT_MAX, MAX_ITEMS, NAME_MAX, TEXT_MAX, generatePassword, type ElementStatus, type Item, type KeepTtl } from "../index";
  import type { PaidTier } from "../limits";
  import { blockKey, canClean, createComposer, type AddReport, type ComposeItem, type Source } from "../flows/compose.svelte";
  import { rowStatus, toDraftList } from "../flows/preupload";
  import { addActions, desktopActions, type AddId } from "../flows/add-actions";
  import { captureSupport } from "../media/capture";
  import { fromPasteEvent } from "../flows/intake";
  import { createOptions, sendRights, viewableInBrowser, viewOnlyBlockers, type Rights } from "../flows/options.svelte";
  import { formatBytes, formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import CapacityGauge from "../ui/CapacityGauge.svelte";
  import CategoryGroup from "../ui/CategoryGroup.svelte";
  import { navigate } from "../app/router.svelte";
  import { Broom, ChevronDown, Eye, Pencil, Plus, RefreshCw, ShieldAlert, SlidersHorizontal, Trash2, Upload, X } from "../ui/Icon";
  import NamesTip from "../ui/NamesTip.svelte";
  import { composePreview } from "../ui/itemView";
  import { safeBlobType } from "../viewers/blobs";
  import ViewerPanel, { type ViewItem } from "../viewers/ViewerPanel.svelte";
  import AddIcon from "../ui/AddIcon.svelte";
  import AddSheet from "../ui/AddSheet.svelte";
  import CaptureScreen, { type Captured } from "../ui/CaptureScreen.svelte";
  import VoiceRecorder, { type Voice } from "../ui/VoiceRecorder.svelte";
  import TextField from "../ui/TextField.svelte";
  import OffersStrip from "../ui/OffersStrip.svelte";
  import PaidSheet from "../ui/PaidSheet.svelte";
  import CleanConfirm from "../ui/CleanConfirm.svelte";
  import { cleanWhatKey, isCleanFailure } from "../media/clean-label";
  import Sheet from "../ui/Sheet.svelte";
  import TextArea from "../ui/TextArea.svelte";
  import UndoToast from "../ui/UndoToast.svelte";
  import { runTransition } from "../ui/viewTransition";
  import Home, { type Action } from "./Home.svelte";
  import Options from "./Options.svelte";

  /** ids : identifiants des lignes, dans l'ordre de `items` (brouillon d'envoi, spec §41.14). */
  export type SendState = { items: Item[]; ids: string[]; ttlHours: number; maxOpens: number; password: string; rights: Rights; keepTtlH?: KeepTtl };
  type Props = {
    /** Envoi (Task 17). Sans lui : avis « Envoi : prochaine étape ». */
    onsend?: (state: SendState) => void;
    /** Faux pendant un envoi (composeur caché) : ni collage ni dépôt n'ajoutent rien (S9). */
    active?: boolean;
    /**
     * Envoi dès l'ajout (spec §41.14) : la liste des fichiers à chaque changement, l'état de
     * chaque ligne (relu quand `uploadVersion` change), Réessayer, et les octets retirés dont
     * l'effacement sur le serveur n'est pas encore confirmé (jauge).
     */
    onitems?: (list: { id: string; data: Blob }[]) => void;
    uploadOf?: (id: string) => ElementStatus | undefined;
    uploadVersion?: number;
    onretry?: (id: string) => void;
    removing?: number;
    /** Page d'envoi « /envoyer » (retours DROP) : composeur affiché même vide, grand cadre de dépôt au centre. */
    sendPage?: boolean;
  };
  let { onsend, active = true, onitems, uploadOf, uploadVersion = 0, onretry, removing = 0, sendPage = false }: Props = $props();

  let online = $state(typeof navigator === "undefined" || navigator.onLine !== false);

  const composer = createComposer({
    // Premier élément : transition de vue (rappel synchrone, K2) ; ensuite, mise à jour sur place.
    commit: (apply) => (composer.count === 0 ? viewChange(apply, focusTitle) : apply()),
    names: {
      photo: (n) => t("compose.name.photo", { n }),
      video: (n) => t("compose.name.video", { n }),
      pasted: (n) => t("compose.name.pasted", { n }),
      text: (n) => (n === 1 ? t("compose.name.note") : t("compose.name.noteN", { n })),
      voice: (n) => t("compose.name.voice", { n }),
    },
    online: () => online,
  });
  // Téléphone (< 760 px) : une vraie app (lignes compactes, menu « … », barre collée, options
  // en feuille). Ordinateur : deux colonnes. Coffre chez le destinataire (spec §27) : retiré de
  // l'interface tant que les apps n'existent pas (décision du propriétaire du 11 novembre).
  const narrowMq = new MediaQuery("max-width: 759px");
  const narrow = $derived(narrowMq.current);
  const options = createOptions({ generate: generatePassword });
  // Formules payantes (D41-16) : feuille d'information seulement, rien n'est en vente.
  let paidOpen = $state(false);
  let paidTier = $state<PaidTier>("plus");
  function showPaid(tier: PaidTier) {
    paidTier = tier;
    paidOpen = true;
  }

  const filled = $derived(composer.count > 0);
  // Composeur à l'écran : dès le premier élément, ou d'emblée sur la page d'envoi (même vide).
  const shown = $derived(filled || sendPage);
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
  }

  async function addFiles(files: File[], source: Source, folders: string[] = [], captureStripped?: boolean) {
    if (folders.length > 0) say(t("compose.folder"), folders.join(", "));
    if (files.length === 0) return;
    const r = await composer.add(files, source, captureStripped);
    await changing; // les avis vont dans le composeur s'il vient de s'ouvrir
    report(r);
  }

  // ---------- Ajouts : feuille « Ajouter » (téléphone), zone de dépôt et rangée (ordinateur) ----------
  // Photo, vidéo, vocal pris dans l'interface (CaptureScreen) ; sinon la galerie du système.
  const support = captureSupport({
    mediaDevices: typeof navigator === "undefined" ? undefined : navigator.mediaDevices,
    MediaRecorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
  });
  const sheetActions = addActions(support);
  const rowActions = desktopActions(support);
  let addOpen = $state(false);
  let capOpen = $state(false);
  let voiceOpen = $state(false);
  let filesIn: HTMLInputElement | undefined = $state();
  let galleryIn: HTMLInputElement | undefined = $state();
  let photoIn: HTMLInputElement | undefined = $state();
  let videoIn: HTMLInputElement | undefined = $state();
  function picked(input: HTMLInputElement, source: Source) {
    const list = [...(input.files ?? [])];
    input.value = "";
    void addFiles(list, source);
  }

  /** Une action d'ajout ; `live` faux : la galerie du système (appel synchrone, même geste). */
  function addAct(id: AddId, live = sheetActions.find((a) => a.id === id)?.live ?? false) {
    if (id === "note") openEditor(null, "");
    else if (id === "files") filesIn?.click();
    else if (id === "voice") voiceOpen = true;
    else if (live) capOpen = true;
    else galleryIn?.click();
  }
  function act(a: Action) {
    addAct(a === "texte" ? "note" : a === "vocal" ? "voice" : "media");
  }
  function captured(c: Captured) {
    void addFiles([new File([c.blob], `capture.${c.ext}`, { type: c.mime })], c.mode === "photo" ? "photo-ici" : "video-ici", [], c.mode === "photo" ? undefined : c.stripped);
  }
  function recorded(v: Voice) {
    if (composer.addVoice(v.blob, v.mime, v.stripped, { peaks: v.peaks, ms: v.ms }) === null) say(t("compose.tooMany", { n: 1, max: MAX_ITEMS }));
    else announce(t("compose.added", { n: 1 }));
  }

  // ---------- Texte ----------
  let editorOpen = $state(false);
  let editorId = $state<string | null>(null);
  let editorText = $state("");
  let editorTitle = $state("");
  const editorLen = $derived([...editorText].length);
  const editorTooLong = $derived(editorLen > TEXT_MAX);
  let editorEl: HTMLTextAreaElement | undefined = $state();
  let titleEl: HTMLInputElement | undefined = $state();
  function openEditor(id: string | null, text: string, title = "") {
    editorId = id;
    editorText = text;
    editorTitle = title;
    editorOpen = true;
    // Focus dans la zone de texte (showModal le mettrait sur « Fermer »), curseur à la fin.
    void tick().then(() =>
      requestAnimationFrame(() => {
        // Déjà dans un champ (appui ou saisie rapide, machine lente) : ne pas lui voler le focus,
        // la saisie partirait dans l'autre champ.
        const at = document.activeElement;
        if (at && (at === titleEl || at === editorEl)) return;
        // Toujours le contenu, curseur à la fin : c'est ce qu'on vient écrire ; le titre est
        // facultatif (faible de l'audit du 11 novembre).
        editorEl?.focus();
        editorEl?.setSelectionRange(editorText.length, editorText.length);
      }),
    );
  }
  function saveText() {
    if (editorTooLong || editorText.trim() === "") return;
    const id = editorId;
    const text = editorText;
    const title = editorTitle;
    editorOpen = false;
    if (id) composer.updateText(id, text, title);
    else if (composer.addText(text, title) === null) say(t("compose.tooMany", { n: 1, max: MAX_ITEMS }));
    else announce(t("compose.added", { n: 1 }));
  }
  function editText(id: string) {
    const it = composer.items.find((i) => i.id === id);
    if (it) openEditor(id, it.text ?? "", it.base);
  }


  // ---------- Coller ----------
  const isTextEntry = (n: Element | null) =>
    n instanceof HTMLTextAreaElement ||
    (n instanceof HTMLElement && n.isContentEditable) ||
    (n instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "file", "range", "color", "image"].includes(n.type));

  function onPaste(e: ClipboardEvent) {
    if (!active) return; // envoi en cours : le collage n'ajoute rien (S9)
    const r = fromPasteEvent(e, isTextEntry(document.activeElement));
    if (r.native) return;
    if (r.files.length === 0 && r.text === null) return;
    e.preventDefault();
    if (r.files.length > 0) void addFiles(r.files, "collage");
    else if (r.text !== null && !editorOpen) openEditor(null, r.text);
  }
  // ---------- Ordinateur : tout le composeur dans l'écran, sans défilement de page ----------
  // Exigence du propriétaire : à 1440 × 900 comme à 1920 × 1080, en-tête, capacité, liste,
  // options, phrase et bouton d'envoi tiennent dans l'écran ; seule la liste défile au besoin.
  // Le pied de page est juste en dessous (on le voit en faisant défiler), il ne tasse rien.
  // Hauteur de l'app = hauteur de l'écran − ce qui est au-dessus − le bas de <main> (mesurés).
  function fitViewport(node: HTMLElement) {
    let raf = 0;
    const fit = () => {
      raf = 0;
      // Ce qui est sous l'app jusqu'au bas de <main> (bas du cadre, marge) ; le pied de page,
      // après <main>, n'entre pas dans le calcul : il vient sous l'écran d'envoi.
      const r = node.getBoundingClientRect();
      const end = document.querySelector("main") ?? document.body;
      const tail = end.getBoundingClientRect().bottom - r.bottom;
      node.style.setProperty("--app-h", `${Math.max(520, Math.floor(innerHeight - (r.top + scrollY) - tail))}px`);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(fit);
    };
    fit();
    // Après la transition de vue et le chargement des polices, la place au-dessus peut changer.
    const late = setTimeout(queue, 500);
    void document.fonts?.ready.then(queue);
    addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(late);
      removeEventListener("resize", queue);
      node.style.removeProperty("--app-h");
    };
  }
  // Ordinateur, composeur ouvert : <main> resserré (règle globale plus bas).
  $effect(() => {
    document.documentElement.classList.toggle("composing", shown && !narrow);
    chrome.composing = shown; // téléphone : la barre d'onglets cède la place à la barre d'envoi
    return () => {
      document.documentElement.classList.remove("composing");
      chrome.composing = false;
    };
  });

  // ---------- Nettoyer tous les fichiers ----------
  // Le bouton n'apparaît que si le nettoyage est réel (Tasks 9a à 9c) : jamais un bouton qui ne
  // fait rien (scan UX B3). Les pastilles « Non nettoyé », honnêtes, restent.
  // ---------- Retrait, annulation ----------
  type Toast = { id: number; message: string; undo: () => void; focusId?: string };
  let toast = $state<Toast | null>(null);
  // L'annonce d'annulation se pose au-dessus de la barre d'envoi collée (elle ne couvre pas le bouton).
  let barH = $state(0);
  let toastSeq = 0;

  /** `safe` : jamais « Supprimer » (après un nettoyage, un second Entrée réflexe retirerait le
   *  fichier, audit D3) : « Réessayer », « Renommer »/« Modifier » ou le menu « … ». */
  async function focusRow(id: string | undefined, safe = false) {
    await tick();
    const row = id ? document.querySelector(`[data-row="${CSS.escape(id)}"]`) : null;
    const btn = row?.querySelector<HTMLButtonElement>(safe ? "[data-fix], [data-rename], [data-menu]" : "[data-remove], [data-menu]");
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
  const CAT = { texte: "compose.cat.text", photos: "compose.cat.photos", videos: "compose.cat.videos", audio: "compose.cat.audio", documents: "compose.cat.documents", archives: "compose.cat.archives", autres: "compose.cat.autres" } as const;
  function sayPosition(id: string) {
    const it = composer.items.find((i) => i.id === id);
    const p = composer.positionOf(id);
    if (!it || !p) return;
    announce(t("compose.moved", { name: it.kind === "text" ? it.base : it.base + it.ext, i: p.index, n: p.of, category: t(CAT[p.category]) }));
  }

  // ---------- Envoi ----------
  const composerBlock = $derived(composer.blockReason());
  // Résumé discret près d'Envoyer (D41-23) : les lignes portent chacune leur marque et leur raison.
  const uncleaned = $derived(composer.uncleanedCount);
  // Format jamais lu : dit à part, sans parler d'échec (audit D5).
  const unsupported = $derived(composer.unsupportedCount);
  const reasonText = $derived(composerBlock ? t(blockKey(composerBlock), { max: composerBlock === "trop_gros" ? formatBytes(CONTENT_MAX, lang) : num(TEXT_MAX) }) : "");
  // Chaque fichier part dès son ajout ; un retrait interrompt son envoi et l'efface du serveur.
  // untrack : le brouillon met à jour l'état des lignes pendant l'appel (pas une dépendance).
  $effect(() => {
    const list = toDraftList(composer.items);
    untrack(() => onitems?.(list));
  });
  const upload = (i: (typeof composer.items)[number]) => (void uploadVersion, rowStatus(uploadOf?.(i.id)));
  const culprits = $derived(composer.culprits());
  const unviewable = $derived(viewOnlyBlockers(composer.items));
  const cannotOpen = (i: (typeof composer.items)[number]) => !options.allowDownload && !viewableInBrowser(i);
  const shortSummary = $derived(
    [formatDuration(options.ttlHours * 3600, lang), t("options.opens.count", { n: options.maxOpens }), t(options.allowDownload ? "options.short.on" : "options.short.off")].join(" · "),
  );

  // ---------- Feuilles du téléphone : options, actions d'un élément ----------
  let optionsOpen = $state(false);
  $effect(() => {
    if (!narrow) optionsOpen = false;
  });
  let menuId = $state<string | null>(null);
  let menuRenaming = $state(false);
  let menuDraft = $state("");
  let menuError = $state<null | "vide" | "trop_long" | "interdit">(null);
  const menuItem = $derived(composer.items.find((i) => i.id === menuId) ?? null);
  // Vocal pris ici : extension interne, jamais affichée (comme sur sa ligne).
  const menuExt = $derived(menuItem && menuItem.kind !== "text" && !menuItem.voice ? menuItem.ext : "");
  const menuName = $derived(menuItem ? menuItem.base + menuExt : "");
  // Menu (retours UI6) : Aperçu (si permis), Renommer ou Modifier, Nettoyer ou Réessayer (si
  // utile), Supprimer. Plus de Monter ni Descendre.
  const menuPeek = $derived(menuItem ? composePreview(menuItem) !== null : false);
  const menuFix = $derived(menuItem ? fixOf(menuItem) : null);
  $effect(() => {
    if (menuId !== null && !menuItem) menuId = null;
  });
  // Un seul en-tête de tableau visible : celui du premier groupe en tableau (ordinateur).

  function openMenu(id: string) {
    menuRenaming = false;
    menuError = null;
    menuId = id;
  }
  function menuEdit() {
    const it = menuItem;
    if (!it) return;
    if (it.kind === "text") {
      menuId = null;
      void tick().then(() => editText(it.id));
    } else {
      menuDraft = it.base;
      menuError = null;
      menuRenaming = true;
    }
  }
  function menuRenameSave() {
    if (!menuItem) return;
    const r = menuDraft === menuItem.base ? null : composer.rename(menuItem.id, menuDraft);
    if (r) menuError = r;
    else menuId = null;
  }
  function menuPreview() {
    const id = menuId;
    menuId = null;
    if (id) void tick().then(() => preview(id));
  }
  function menuFixRun() {
    const id = menuId;
    menuId = null;
    if (!id) return;
    // « Nettoyer » : la même confirmation que le balai, posée sur le balai de la ligne.
    void tick().then(() => {
      const broom = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] button.broom`);
      if (broom) askClean(id, broom);
      else void fixRun(id);
    });
  }
  function menuRemove() {
    const id = menuId;
    menuId = null;
    if (id) void tick().then(() => remove(id));
  }

  // ---------- Aperçu, Nettoyer, Réessayer (retours UI6) ----------
  // Ordre de la visionneuse : celui de la liste ; seulement les éléments qui ont un aperçu.
  const viewList = $derived(composer.items.flatMap((i) => {
    const k = composePreview(i);
    return k ? [{ item: i, kind: k }] : [];
  }));
  const viewItems = $derived<ViewItem[]>(viewList.map((v, n) => ({ i: n, name: v.item.kind === "text" ? v.item.base : v.item.base + (v.item.voice ? "" : v.item.ext), kind: v.kind, size: v.item.size, text: v.item.kind === "text" ? (v.item.text ?? "") : undefined })));
  let viewAt = $state<number | null>(null);
  function preview(id: string) {
    const n = viewList.findIndex((v) => v.item.id === id);
    if (n >= 0) viewAt = n;
  }
  // Type du Blob par la table fixe de la visionneuse (jamais le type annoncé tel quel).
  async function loadLocal(n: number): Promise<Blob> {
    const v = viewList[n];
    const type = v ? safeBlobType(v.kind, v.item.mime) : null;
    if (!v || !type || !(v.item.data instanceof Blob)) throw new Error("apercu_impossible");
    return v.item.data.slice(0, v.item.data.size, type);
  }
  $effect(() => {
    if (viewAt !== null && viewAt >= viewList.length) viewAt = null;
  });
  /** Nettoyer (Original), Réessayer (échec du nettoyage ou de l'envoi) ; null : rien à proposer. */
  function fixOf(i: ComposeItem): "nettoyer" | "reessayer" | null {
    const c = canClean(i);
    if (c) return c;
    return upload(i)?.key === "compose.up.erreur" && onretry ? "reessayer" : null;
  }
  async function fixRun(id: string) {
    const it = composer.items.find((i) => i.id === id);
    if (!it) return;
    const name = it.kind === "text" ? it.base : it.base + (it.voice ? "" : it.ext);
    if (canClean(it)) {
      await composer.clean(id);
      const now = composer.items.find((i) => i.id === id);
      if (now) announce(t(now.clean === "nettoye" ? "compose.cleaned" : "compose.clean.failed", { name }));
      // Le contenu a changé : le brouillon renvoie la version nettoyée (sync) ; sinon, l'envoi
      // en échec est relancé tel quel.
      if (now && now.data === it.data && upload(now)?.key === "compose.up.erreur") onretry?.(id);
    } else onretry?.(id);
  }

  // ---------- Balai : confirmation, puis nettoyage (retours du propriétaire du 12 novembre) ----------
  // Rien n'est nettoyé à l'ajout ni sans validation : le balai d'une ligne ou « Tout nettoyer »
  // ouvre une petite confirmation qui dit ce qui sera retiré ; « Nettoyer » lance le nettoyage.
  const cleanable = $derived(composer.items.filter((i) => canClean(i) === "nettoyer" && !composer.isCleaning(i.id)));
  let cleanAllBtn: HTMLButtonElement | undefined = $state();
  let cleanAsk = $state<{ ids: string[]; anchor: HTMLElement; title: string; body: string } | null>(null);
  function askClean(id: string, anchor: HTMLElement) {
    const it = composer.items.find((i) => i.id === id);
    if (!it) return;
    if (canClean(it) !== "nettoyer") return void fixRun(id); // Réessayer : sans confirmation
    cleanAsk = { ids: [id], anchor, title: t("clean.confirm.title"), body: `${t(cleanWhatKey(it.category))} ${t("clean.confirm.local")}` };
  }
  function askCleanAll(anchor: HTMLElement) {
    const ids = cleanable.map((i) => i.id);
    if (ids.length === 0) return;
    cleanAsk = { ids, anchor, title: t("clean.confirm.all", { n: ids.length }), body: `${t("clean.what.all")} ${t("clean.confirm.local")}` };
  }
  async function runClean(ids: string[]) {
    if (ids.length === 1) {
      await fixRun(ids[0]!);
      void focusRow(ids[0], true);
      return;
    }
    focusTitle();
    await Promise.all(ids.map((id) => composer.clean(id)));
    const now = composer.items.filter((i) => ids.includes(i.id));
    // « sans » : rien à retirer, ce n'est pas un échec.
    const failed = now.filter((i) => isCleanFailure(i));
    announce(t("compose.cleaned.all", { n: now.length - failed.length }));
    for (const i of failed) announce(t("compose.clean.failed", { name: i.base + i.ext }));
  }

  function send() {
    if (reasonText) return;
    const state: SendState = { items: composer.toApiItems(), ids: composer.items.map((i) => i.id), ttlHours: options.ttlHours, maxOpens: options.maxOpens, password: options.password, ...sendRights(options) };
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

</script>

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />
<svelte:document onpaste={onPaste} />

{#snippet adder()}
  <!-- Ordinateur : sous l'en-tête de la liste, la même liste d'actions que la feuille du téléphone ;
       la zone de dépôt (« Fichiers ») est dessous, en filigrane dans l'espace vide (retours DROP). -->
  <div class="adder bar">
    <div class="make" role="group" aria-label={t("compose.create.label")}>
      {#each rowActions as a (a.id)}
        <button type="button" class="mk" data-add={a.id} onclick={() => addAct(a.id, a.live)}>
          <AddIcon id={a.id} size={18} />
          <span>{t(`compose.row.${a.id as "media" | "voice" | "note"}`)}</span>
        </button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet offers()}<OffersStrip newTab={filled} onpaid={showPaid} />{/snippet}

{#snippet app()}
  <div class={["app", { narrow }]} data-composer {@attach narrow ? null : fitViewport}>
    <div class="list-col">
      <!-- Offres (retours du propriétaire du 12 novembre, remplace la ligne discrète d'audit M17) :
           Gratuit, Plus, Pro et leurs limites, « bientôt », lien vers /offres (nouvel onglet si la
           liste n'est pas vide : elle serait perdue en quittant la page). Téléphone : avant la
           carte « Votre envoi » entière, jamais entre ses boutons et son compteur (audit R4) ;
           ordinateur : au-dessus de « Chiffrer et envoyer », la liste garde sa hauteur. -->
      {#if narrow}<div class="offers">{@render offers()}</div>{/if}
      <div class="top">
        <div class="tt">
          <h2 id="compose-title" class="title" tabindex="-1" data-large-title bind:this={title}>{t("compose.title")}</h2>
          <NamesTip />
        </div>
        {#if filled}
          <div class="clear">
            {#if cleanable.length > 0}
              <!-- « Tout nettoyer » (retours du 12 novembre) : seulement s'il reste un fichier à
                   nettoyer ; même confirmation que le balai d'une ligne. -->
              <Button variant="secondary" dense bind:el={cleanAllBtn} onpress={() => cleanAllBtn && askCleanAll(cleanAllBtn)} aria-haspopup="dialog" data-clean-all>
                {#snippet icon()}<Broom size={18} strokeWidth={1.8} />{/snippet}
                {t("compose.clean.all")}
              </Button>
            {/if}
            <Button variant="secondary" dense onpress={clearAll}>
              {#snippet icon()}<Trash2 size={18} strokeWidth={1.8} />{/snippet}
              {t("compose.clear")}
            </Button>
          </div>
        {/if}
        <div class="cap">
          <div class="capg"><CapacityGauge bytes={composer.totalBytes + removing} count={composer.count} head /></div>
        </div>
        {#if removing > 0}<p class="removing" role="status">{t("compose.up.removing")}</p>{/if}
      </div>
      <!-- Ordinateur : « Créer sur place » en haut, bien visible, au-dessus de la zone de dépôt
           (retours du propriétaire du 11 novembre). -->
      {#if !narrow}{@render adder()}{/if}



      <!-- Seule la liste défile (ordinateur) : la page, jamais. -->
      <div class="lc-scroll">
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
            compact={narrow}
            onmenu={openMenu}
            {cannotOpen}
            danger={(i) => culprits.has(i.id)}
            {upload}
            {onretry}
            onpreview={(i) => (composePreview(i) ? () => preview(i.id) : undefined)}
            fix={fixOf}
            onclean={askClean}
            cleaning={(i) => composer.isCleaning(i.id)}
          />
        {/each}
      </div>
      {#if narrow && !filled}
        <!-- Page d'envoi vide, téléphone : « Ajouter » au centre (ouvre la feuille d'ajout). -->
        <button type="button" class="dropzone empty" aria-haspopup="dialog" onclick={() => (addOpen = true)}>
          <span class="dz-ic" aria-hidden="true"><Plus size={22} strokeWidth={2.2} /></span>
          <span class="dz-tx">
            <span class="dz-t">{t("add.open")}</span>
            <span class="dz-s">{t("add.big.sub")}</span>
          </span>
        </button>
      {:else if !narrow}
        <!-- Filigrane (retours DROP) : l'espace vide sous la liste est la zone de dépôt ; un clic y
             ouvre le choix de fichiers ; on dépose aussi n'importe où sur la page. Texte entier,
             jamais tronqué. Liste vide (page d'envoi) : grand cadre au centre, texte blanc. -->
        <!-- Liste vide : la flèche SOUS le texte (retours du propriétaire du 11 novembre). -->
        {#snippet upIcon()}<span class="dz-ic" aria-hidden="true"><Upload size={18} strokeWidth={1.8} /></span>{/snippet}
        <button type="button" class={["dropzone", filled ? "ghost" : "empty"]} onclick={() => filesIn?.click()}>
          {#if filled}{@render upIcon()}{/if}
          <span class="dz-tx">
            <span class="dz-t">{t("compose.dropzone.title")}</span>
            <span class="dz-s">{t("compose.dropzone.sub")}</span>
          </span>
          {#if !filled}{@render upIcon()}{/if}
        </button>
      {/if}
      </div>
    </div>

    {#if narrow}
      <!-- Téléphone : barre d'action collée (zone du pouce) : réglages en une ligne, puis
           « Ajouter » (+, ouvre la feuille) à côté de l'action principale. -->
      <div class="sendbar m dock" bind:clientHeight={barH}>
        <button type="button" class="optbtn" aria-haspopup="dialog" onclick={() => (optionsOpen = true)}>
          <SlidersHorizontal size={18} strokeWidth={1.9} aria-hidden="true" />
          <span class="ob-tx"><span class="ob-t">{t("options.open")}</span><span class="sr-only"> · </span><span class="ob-s num">{shortSummary}</span></span>
          <ChevronDown size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <div class="acts">
          <button type="button" class="plus" aria-haspopup="dialog" aria-label={t("add.open")} onclick={() => (addOpen = true)}>
            <Plus size={26} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <Button variant="primary" lock disabled={reasonText !== ""} aria-describedby={reasonText ? "send-reason" : undefined} onpress={send}>{t("options.submit")}</Button>
        </div>
        {#if reasonText}<p id="send-reason" class="reason">{reasonText}</p>{:else if uncleaned + unsupported > 0}{@render uncleanSum()}{/if}
      </div>
    {:else}
      <!-- Ordinateur : colonne collée, défilement propre, pied collé : le bouton reste visible. -->
      <div class="side">
        <div class="side-scroll">
          <Options {options} {unviewable} part="controls" />
        </div>
        <div class="sendbar foot">
          <Options {options} {unviewable} part="summary" />
          <div class="offers side-offers">{@render offers()}</div>
          <Button variant="primary" lock disabled={reasonText !== ""} aria-describedby={reasonText ? "send-reason" : undefined} onpress={send}>{t("options.submit")}</Button>
          {#if reasonText}<p id="send-reason" class="reason">{reasonText}</p>{:else if uncleaned + unsupported > 0}{@render uncleanSum()}{/if}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet uncleanSum()}
  <p class="unclean-sum" data-unclean-sum>
    {#if uncleaned > 0}<span>{t("compose.uncleaned", { n: uncleaned })}</span>{/if}
    {#if unsupported > 0}<span>{t("compose.unsupported", { n: unsupported })}</span>{/if}
  </p>
{/snippet}

<!-- Sélecteurs (hors du composeur : l'accueil vide s'en sert aussi). -->
<input bind:this={filesIn} type="file" multiple hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "fichiers")} />
<input bind:this={galleryIn} type="file" accept="image/*,video/*" multiple hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "fichiers")} />
<input bind:this={photoIn} type="file" accept="image/*" capture="environment" hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "photo")} />
<input bind:this={videoIn} type="file" accept="video/*" capture="environment" hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "video")} />

<!-- « Commencer » (accueil) mène à la page d'envoi « /envoyer » (retours DROP). -->
<Home {active} compact={shown} onadd={() => navigate("/envoyer")} children={shown ? app : undefined} onfiles={(f, s, folders) => void addFiles(f, s, folders)} onaction={act} />

<Sheet bind:open={editorOpen} title={editorId ? t("text.title.edit") : t("text.title.new")}>
  <div class="editor">
    <TextField
      label={t("text.title.label")}
      bind:value={editorTitle}
      bind:el={titleEl}
      placeholder={t("compose.name.note")}
      hint={t("text.title.hint")}
      maxlength={NAME_MAX}
      autocomplete="off"
      {...{ autocorrect: "off" } as Record<string, string>}
      autocapitalize="off"
      spellcheck={false}
      translate="no"
      enterkeyhint="next"
    />
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

<Sheet bind:open={optionsOpen} title={t("options.title")}>
  <div class="opt-sheet">
    <Options {options} {unviewable} compact />
    <Button variant="primary" onpress={() => void (optionsOpen = false)}>{t("compose.move.done")}</Button>
  </div>
</Sheet>

{#snippet menuBody()}
  {#if menuItem}
    {#if menuRenaming}
      <div class="mrename">
        <label class="fl" for="menu-rename">{t("compose.rename.field", { name: menuName })}</label>
        <span class="mfield">
          <input
            id="menu-rename"
            bind:value={menuDraft}
            type="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            translate="no"
            enterkeyhint="done"
            aria-invalid={menuError ? "true" : undefined}
            aria-describedby={menuError ? "menu-rename-err" : undefined}
            onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), menuRenameSave())}
            {@attach (el) => { el.focus(); el.select(); }}
          />
          {#if menuExt}<span class="ext" translate="no">{menuExt}</span>{/if}
        </span>
        {#if menuError}<p id="menu-rename-err" class="err" role="alert">{t(`compose.rename.${menuError}`, { max: NAME_MAX })}</p>{/if}
        <div class="ed-acts">
          <Button variant="ghost" onpress={() => void (menuRenaming = false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onpress={menuRenameSave}>{t("text.save")}</Button>
        </div>
      </div>
    {:else}
      <div class="mlist">
        {#if menuPeek}
          <button type="button" class="mi" onclick={menuPreview}><Eye size={20} strokeWidth={1.8} aria-hidden="true" />{t("compose.preview.short")}</button>
        {/if}
        <button type="button" class="mi" onclick={menuEdit}><Pencil size={20} strokeWidth={1.8} aria-hidden="true" />{menuItem.kind === "text" ? t("compose.edit.short") : t("compose.rename.short")}</button>
        {#if menuFix}
          <button type="button" class="mi" onclick={menuFixRun} disabled={composer.isCleaning(menuItem.id)} data-fix={menuFix}>
            {#if menuFix === "nettoyer"}<Broom size={20} strokeWidth={1.8} aria-hidden="true" />{t("compose.clean.short")}{:else}<RefreshCw size={20} strokeWidth={1.8} aria-hidden="true" />{t("common.retry")}{/if}
          </button>
        {/if}
        <button type="button" class="mi danger" onclick={menuRemove}><X size={20} strokeWidth={1.8} aria-hidden="true" />{t("compose.remove.short")}</button>
      </div>
    {/if}
  {/if}
{/snippet}

<!-- Menu « … » d'un élément : téléphone seulement (lignes compactes). -->
<Sheet bind:open={() => menuId !== null, (v) => { if (!v) menuId = null; }} title={menuName}>{@render menuBody()}</Sheet>


<!-- Aperçu d'un élément avant l'envoi (retours UI6) : la visionneuse du destinataire, sans
     téléchargement ; le contenu ne quitte jamais la mémoire de la page. -->
<ViewerPanel items={viewItems} bind:at={viewAt} viewOnly={false} load={loadLocal} held={false} onclose={() => undefined} />

<PaidSheet bind:open={paidOpen} tier={paidTier} />

<CleanConfirm anchor={cleanAsk?.anchor ?? null} title={cleanAsk?.title ?? ""} body={cleanAsk?.body ?? ""} onconfirm={() => { const ids = cleanAsk?.ids ?? []; void runClean(ids); }} onclose={() => (cleanAsk = null)} />

<AddSheet bind:open={addOpen} actions={sheetActions} onpick={addAct} />

<CaptureScreen
  bind:open={capOpen}
  canVideo={support.video}
  ondone={captured}
  onfallback={(m) => (m === "photo" ? photoIn : videoIn)?.click()}
  ongallery={() => galleryIn?.click()}
/>

<VoiceRecorder bind:open={voiceOpen} ondone={recorded} />

{#if toast}
  <div class="toast-slot" style:--lift="{shown ? barH : 0}px">
    {#key toast.id}
      <UndoToast message={toast.message} durationMs={narrow ? 5000 : 6000} onundo={undo} ondismiss={() => (toast = null)} onclose={() => undefined} />
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
  .app.narrow {
    gap: var(--sp-3);
    padding: var(--sp-2) 0 0;
  }
  .app.narrow .sendbar {
    margin-inline: calc(-1 * var(--sp-4));
    border-radius: 0;
    /* Opaque : la liste qui défile dessous ne se lit pas à travers les commandes. */
    background: var(--bg);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .app.narrow .top {
    padding-inline: 0;
  }
  /* Téléphone : « Tout nettoyer » et « Tout supprimer » sur leur propre rangée, sous le titre
     (le titre ne se coupe plus en deux). */
  .app.narrow .clear {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-start;
  }
  .narrow .list-col {
    gap: var(--sp-2);
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
  /* En-tête : « Votre envoi », « Tout supprimer », et la capacité bien visible (nombre et taille). */
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
    padding-inline: 4px;
  }
  .removing {
    margin: 0;
    font-size: var(--fs-xs, 0.8125rem);
    color: var(--ink-3, var(--muted));
  }
  .cap {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
    min-width: 0;
  }
  .capg {
    flex: 1 1 220px;
    min-width: 0;
  }
  .offers {
    grid-column: 1 / -1;
    min-width: 0;
  }
  /* Téléphone : avant la carte « Votre envoi », un peu détachées de son titre (audit R4). */
  .list-col > .offers {
    margin-block-end: var(--sp-2);
  }

  /* Zone de dépôt : un clic ouvre le sélecteur ; on peut aussi déposer n'importe où sur la page. */
  .dropzone {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    width: 100%;
    min-height: 72px;
    padding: var(--sp-3) var(--sp-4);
    border: 1.5px dashed rgb(233 236 242 / 0.2);
    border-radius: 18px;
    background: rgb(255 255 255 / 0.025);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .dropzone:active {
    transform: scale(0.99);
  }
  @media (hover: hover) {
    .dropzone:hover {
      border-color: rgb(95 227 181 / 0.55);
      background: rgb(95 227 181 / 0.05);
    }
    .dropzone:hover .dz-ic {
      color: var(--accent);
      transform: translateY(-2px);
    }
  }
  :global(.vessel.drop) .dropzone {
    border-color: var(--accent);
    background: rgb(95 227 181 / 0.08);
  }
  .dz-ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.06);
    color: var(--text-2);
    transition:
      color var(--dur-fast) var(--ease-out),
      transform 400ms var(--ease-settle);
  }
  /* Page d'envoi vide (retours DROP) : cadre en tête de la liste, texte blanc entier. Compact
     depuis les retours du 12 novembre (il prenait tout l'écran) : titre, offres et Salon restent
     au premier écran ; la cible garde 120 px de haut au doigt, 184 px sur ordinateur. */
  .dropzone.empty {
    flex: none;
    flex-direction: column;
    justify-content: center;
    gap: var(--sp-2);
    min-height: 120px;
    padding: var(--sp-4) var(--sp-4);
    /* Retours LIGHT : cadre en pointillés bien visible, arrondi doux, sans fond. */
    border: 1.5px dashed rgb(233 236 242 / 0.34);
    border-radius: var(--r-xl);
    background: none;
    text-align: center;
    color: var(--text);
  }
  .dropzone.empty .dz-tx {
    justify-items: center;
  }
  .dropzone.empty .dz-t {
    font-size: var(--fs-body);
  }
  .dropzone.empty:active {
    transform: none;
  }
  .dz-tx {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .dz-t {
    font-weight: 600;
  }
  .dz-s {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .make {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .mk {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 14px 0 12px;
    border: 0;
    border-radius: var(--r-pill);
    background: rgb(255 255 255 / 0.05);
    box-shadow: inset 0 0 0 1px var(--hair);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 560;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .mk :global(svg) {
    color: var(--text-2);
  }
  .mk:active {
    transform: scale(0.96);
  }
  @media (hover: hover) {
    .mk:hover {
      background: rgb(255 255 255 / 0.09);
    }
    .mk:hover :global(svg) {
      color: var(--accent);
    }
  }
  /* Téléphone : pastilles « Créer » plus serrées (deux rangées au plus). */
  .narrow .make {
    gap: 6px;
  }
  .narrow .mk {
    min-height: 44px;
    padding: 0 12px 0 10px;
    font-size: var(--fs-micro);
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
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--sp-2);
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
  /* Tableau unique et sobre de l'envoi (retours TABLE) : un seul contenant fin pour tous les
     fichiers, une catégorie = un sous-en-tête (CategoryGroup), jamais un cadre par type. */
  .groups {
    display: grid;
    gap: var(--sp-2);
    padding: 6px var(--sp-2);
    border: 1px solid var(--hair);
    border-radius: 16px;
    background: rgb(255 255 255 / 0.012);
  }
  .groups:empty {
    display: none;
  }
  @media (forced-colors: active) {
    .groups {
      border-color: CanvasText;
    }
  }
  .tt {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
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

  
  
  

  /* ---------- Barre d'envoi du téléphone ---------- */
  .sendbar.m {
    gap: 10px;
    padding-top: var(--sp-3);
  }
  .optbtn {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 6px 12px 6px 14px;
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.06);
    box-shadow: inset 0 0 0 1px var(--hair-2);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .optbtn:active {
    transform: scale(0.98);
    background: rgb(255 255 255 / 0.1);
  }
  .optbtn > :global(svg) {
    color: var(--text-2);
  }
  .optbtn > :global(svg:last-child) {
    transform: rotate(180deg);
  }
  .ob-tx {
    display: grid;
    min-width: 0;
    line-height: 1.3;
  }
  .ob-t {
    font-weight: 600;
    font-size: var(--fs-small);
  }
  .ob-s {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .sendbar.m :global(.btn) {
    min-height: 56px;
  }
  /* « Ajouter » (+) à gauche de l'action principale, même hauteur : le pouce trouve les deux. */
  .acts {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    gap: var(--sp-2);
  }
  .plus {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    padding: 0;
    border: 0;
    border-radius: 14px;
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--hair-2);
    color: var(--accent);
    cursor: pointer;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .plus:active {
    transform: scale(0.94);
    background: var(--accent-tint);
  }
  .plus:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---------- Feuilles ---------- */
  .opt-sheet {
    display: grid;
    gap: var(--sp-4);
  }
  .opt-sheet :global(.btn) {
    width: 100%;
  }
  .mlist {
    display: grid;
    margin-inline: calc(-1 * var(--sp-2));
  }
  .mi {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 52px;
    padding: 0 var(--sp-3);
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    font-weight: 520;
    text-align: start;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .mi > :global(svg) {
    color: var(--text-2);
  }
  .mi:active {
    transform: scale(0.98);
    background: rgb(255 255 255 / 0.07);
  }
  @media (hover: hover) {
    .mi:hover {
      background: rgb(255 255 255 / 0.05);
    }
  }
  .mi.danger,
  .mi.danger > :global(svg) {
    color: var(--danger);
  }
  .mrename {
    display: grid;
    gap: var(--sp-2);
  }
  .fl {
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .mfield {
    display: flex;
    align-items: center;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface-1);
  }
  .mfield:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .mfield input {
    flex: 1;
    min-width: 0;
    height: 48px;
    padding: 0 var(--sp-3);
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: max(1rem, 16px);
    outline: none;
  }
  .ext {
    padding-inline-end: var(--sp-3);
    color: var(--text-3);
  }
  .err {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-small);
  }
  .toast-slot :global(.toast) {
    inset-block-end: calc(var(--lift) + var(--sp-3) + env(safe-area-inset-bottom, 0px));
  }
  .reason {
    margin: -4px 0 0;
    color: var(--warn);
    font-size: var(--fs-small);
    text-align: center;
  }
  .unclean-sum {
    display: grid;
    margin: -4px 0 0;
    color: var(--text-2);
    font-size: var(--fs-micro);
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
  /* Ordinateur : l'app tient dans l'écran (hauteur --app-h mesurée) ; seule la liste défile.
     760–1179 px : deux colonnes (liste | options avec l'envoi en pied) ; ≥ 1180 px : trois
     colonnes (liste | réglages | phrase, estimation et envoi). */
  @media (min-width: 760px) {
    .app {
      height: var(--app-h, auto);
      grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
      grid-template-rows: minmax(0, 1fr);
      column-gap: 32px;
      padding: var(--sp-5) var(--sp-5) var(--sp-5);
    }
    .list-col {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-height: 0;
    }
    /* « Créer sur place » en haut de la liste, sous l'en-tête et la capacité (retours du
       propriétaire du 11 novembre) : bien visible, icône et libellé. */
    .adder.bar {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: var(--sp-2);
      padding-inline: 4px;
    }
    .dropzone.empty {
      min-height: 184px;
    }
    /* Filigrane : occupe l'espace vide sous la liste, discret (texte plus clair, sans cadre) ;
       le cadre réapparaît au survol et pendant un glisser-déposer. */
    .dropzone.ghost {
      flex: 1 0 128px;
      flex-direction: column;
      justify-content: center;
      gap: var(--sp-2);
      min-height: 128px;
      border-color: transparent;
      background: none;
      color: var(--text-3);
      text-align: center;
    }
    .dropzone.ghost .dz-ic {
      background: none;
      color: var(--text-3);
    }
    .dropzone.ghost .dz-tx {
      justify-items: center;
    }
    .dropzone.ghost .dz-t {
      font-weight: 560;
    }
    .dropzone.ghost .dz-s {
      color: var(--text-3);
      opacity: 0.8;
    }
    .dropzone.ghost:active {
      transform: none;
    }
    .dropzone.ghost:focus-visible {
      border-color: var(--accent);
    }
    /* Photos et vidéos côte à côte (petites vignettes) : toutes les catégories tiennent ensemble. */
    .groups {
      display: flex;
      flex-wrap: wrap;
      column-gap: var(--sp-4);
      row-gap: var(--sp-2);
    }
    .groups > :global(section) {
      flex: 1 1 100%;
      min-width: 0;
    }
    .groups > :global(section.media) {
      flex: 1 1 200px;
    }
    .adder.bar .make {
      flex: none;
      flex-wrap: nowrap;
      gap: 6px;
    }
    /* Liste très étroite seulement : les pastilles « Créer » gardent leur icône, le libellé passe
       aux lecteurs d'écran ; la zone de dépôt garde sa phrase. */
    .list-col {
      container-type: inline-size;
    }
    @container (max-width: 380px) {
      .adder.bar .mk {
        padding: 0 12px;
      }
      .adder.bar .mk > span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    }
    /* position: relative : les éléments « sr-only » (absolus) restent dans le défilement de la liste. */
    .lc-scroll {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      overflow-y: auto;
      /* Pas d'overscroll-behavior: contain (retours du 12 novembre) : dans Chromium, un conteneur
         défilant qui le porte garde la molette même quand il n'a rien à faire défiler ; la page
         (pied de page dessous) ne défilait plus, souris sur la zone de dépôt ou la liste. Arrivée
         au bout de la liste, la molette passe à la page. */
      margin-inline-end: -10px;
      padding-inline-end: 10px;
      scrollbar-width: thin;
      scrollbar-color: rgb(233 236 242 / 0.18) transparent;
    }
    .side {
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding-inline-start: 32px;
      margin-inline-start: -32px;
      border-inline-start: 1px solid var(--hair);
    }
    .side-scroll {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      /* Même raison que .lc-scroll : la molette passe à la page au bout de la colonne. */
      /* 4 px de marge intérieure : le contour de focus (2 + 2 px) n'est pas rogné (scan UX B4). */
      margin-inline: -4px -10px;
      padding: 4px 10px var(--sp-4) 4px;
      scrollbar-width: thin;
      scrollbar-color: rgb(233 236 242 / 0.18) transparent;
    }
    .sendbar.foot {
      position: static;
      flex: none;
      display: grid;
      gap: var(--sp-3);
      margin: 0;
      padding: var(--sp-4) 0 0;
      border-radius: 0;
      background: none;
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: 0 -1px 0 var(--hair);
    }
  }
  @media (min-width: 1180px) {
    .app {
      grid-template-columns: minmax(0, 1fr) minmax(300px, 340px) minmax(210px, 250px);
      column-gap: 36px;
      padding: var(--sp-5) 32px;
    }
    .side {
      display: contents;
    }
    .side-scroll {
      margin: 0;
      padding: 2px 10px 0 36px;
      margin-inline-start: -36px;
      border-inline-start: 1px solid var(--hair);
    }
    .sendbar.foot {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      min-height: 0;
      padding: 0 0 0 36px;
      margin-inline-start: -36px;
      border-inline-start: 1px solid var(--hair);
      box-shadow: none;
    }
    /* Les offres juste au-dessus du bouton, en bas de la colonne (la place libre est au-dessus). */
    .side-offers {
      margin-top: auto;
    }
  }
  /* Composeur ouvert sur ordinateur : <main> resserré, l'écran d'envoi tient dans la hauteur ;
     le pied de page vient dessous, inchangé. */
  :global(html.composing main) {
    min-height: 0;
    padding-block: var(--sp-3) var(--sp-2);
  }

  .editor {
    display: grid;
    gap: var(--sp-3);
  }
  .ed-acts {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
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
    .floating {
      transition: none;
    }
  }
  @media (forced-colors: active) {
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
