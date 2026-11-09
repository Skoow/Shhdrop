// Composeur (UI §9.2) : liste des éléments à envoyer, en mémoire seulement (aucun stockage).
// Toute addition passe par `add` (sélecteur, dépôt, collage, photo, vidéo) ou `addText` /
// `addVoice` : lecture d'essai → limite de nombre → nettoyage des métadonnées → doublons →
// insertion à la fin de sa catégorie. L'ordre de `items` est l'ordre du manifeste.
//
// Nettoyage (spec §35.2 ; D41-23) : automatique, à l'ajout, avant tout chiffrement ; l'élément
// n'entre dans la liste qu'une fois la décision prise (il n'est donc jamais confié à l'envoi
// anticipé avant). Échec, format non pris en charge : l'élément part sans clic, marqué « Non
// nettoyé » avec sa raison. Réglage désactivé : rien n'est modifié (« Original »).
import { CONTENT_MAX, DATA_SEGMENTS, MANIFEST_MAX, MAX_ITEMS, NAME_MAX, TEXT_MAX, cleanName, isRiskyName, segmentsNeeded, type Item } from "../index";
import { isUncleaned, type ItemCleanState } from "../media/clean-label";
import { DOC_FORMATS, IMAGE_FORMATS, detectFormat, type Format } from "../media/format";
import { stripMetadata, type CleanFamily, type StripResult } from "../media/strip";
import { approve } from "./clean-gate";
import { CATEGORY_ORDER, categoryOf, extOf, type Category } from "./kinds";
import { HEAD_BYTES, isExecutableSniff, sniff, type Sniffed } from "./sniff";

/** `photo-ici`, `video-ici` : pris dans l'interface (caméra maison, media/capture.ts), jamais dans la galerie. */
export type Source = "fichiers" | "photo" | "video" | "depot" | "collage" | "photo-ici" | "video-ici";

export type ComposeItem = {
  readonly id: string;
  readonly kind: "file" | "text";
  readonly category: Category;
  /** Nom sans l'extension (renommable). */
  readonly base: string;
  /** Extension avec son point (« .jpg »), ou "" ; jamais modifiable. */
  readonly ext: string;
  readonly mime: string;
  readonly size: number;
  /** Fichier d'origine (jamais lu en entier), image nettoyée, ou vocal. Vide pour un texte. */
  readonly data: Blob | Uint8Array<ArrayBuffer>;
  /** Contenu d'un élément texte. */
  readonly text?: string;
  /** État du nettoyage (media/clean-label.ts) ; « sans » pour un texte. */
  readonly clean: ItemCleanState;
  readonly cleanFamily?: CleanFamily;
  /** Format reconnu d'un fichier non pris en charge (raison de la marque « Non nettoyé »). */
  readonly cleanFormat?: Format;
  /** Remarques d'un élément nettoyé (modifications suivies, versions précédentes d'un PDF). */
  readonly duplicate: boolean;
  /** Type reconnu par le contenu (octets de tête), ou null. */
  readonly sniffed?: Sniffed;
  /** Vocal pris ici : forme d'onde (0 à 1) et durée, pour la réécoute dans la liste. */
  readonly voice?: { readonly peaks: readonly number[]; readonly ms: number };
  /** Vocal pris ici : nom générique (« Mémo vocal 1 ») repris si on efface le nom. */
  readonly generic?: string;
  /** Exécutable ou script (extension à risque, ou contenu exécutable) : prévenir. */
  readonly risky?: boolean;
  /** Vidéo ou vocal pris ici : un nouveau nettoyage passe par strip-capture (`recorded`). */
  readonly recorded?: boolean;
  /** Format que le nettoyage sait traiter (images, PDF, bureautique, vidéo ou vocal pris ici) :
   *  « Nettoyer » n'est proposé qu'à ceux-là (un élément « Original » d'un autre format n'y gagnerait rien). */
  readonly cleanable?: boolean;
  /** Le contenu ne correspond pas à l'extension (exécutable déguisé, par exemple). */
  readonly mismatch?: boolean;
};

export type AddReport = {
  added: string[];
  refusedCount: string[];
  unreadable: string[];
  folders: string[];
  duplicates: string[];
};

export const BLOCK_REASONS = ["vide", "trop_gros", "segments", "texte_trop_long", "manifeste", "nettoyage", "hors_ligne"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
export function blockKey(r: BlockReason) {
  return `compose.block.${r}` as const;
}

export type Names = {
  photo: (n: number) => string;
  video: (n: number) => string;
  pasted: (n: number) => string;
  text: (n: number) => string;
  voice: (n: number) => string;
};
const FR_NAMES: Names = {
  photo: (n) => `Photo ${n}`,
  video: (n) => `Vidéo ${n}`,
  pasted: (n) => `Image collée ${n}`,
  text: (n) => (n === 1 ? "Note" : `Note ${n}`),
  voice: (n) => `Mémo vocal ${n}`,
};

export type ComposeDeps = {
  /** Porte du nettoyage (media/strip.ts) ; par défaut `stripMetadata`. */
  strip?: (file: Blob, mime: string, name: string, opts?: { recorded?: boolean }) => Promise<StripResult>;
  /** Réglage « Nettoyer automatiquement les fichiers » (vrai par défaut). */
  autoClean?: () => boolean;
  /** Lecture d'essai (UI §9.2.8) ; par défaut le premier octet. Rejet → « illisible ». */
  probe?: (f: Blob) => Promise<Uint8Array | void>;
  /** La liste passe de 0 à 1 élément (déclencheur du pré-calcul anti-robot, Task 14). */
  onFirstItem?: () => void;
  /** La liste redevient vide. */
  onEmpty?: () => void;
  /** Applique une insertion ; l'écran l'enveloppe d'une transition de vue (rappel synchrone). */
  commit?: (apply: () => void) => void;
  names?: Names;
  online?: () => boolean;
};

const EXT_MAX = 16;
const FORBIDDEN = /[/\\\u0000-\u001F\u007F-\u009F]/u;
const utf8 = new TextEncoder();
const codePoints = (s: string) => [...s].length;

/** Base et extension d'un nom déjà nettoyé : l'extension compte 1 à 16 caractères après le dernier point. */
export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot - 1 >= 1 && name.length - dot - 1 <= EXT_MAX) return { base: name.slice(0, dot), ext: name.slice(dot) };
  return { base: name, ext: "" };
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
};
function extFor(f: { name: string; type: string }, fallback: string): string {
  return extOf(f.name) || MIME_EXT[f.type.split(";")[0]!.toLowerCase()] || fallback;
}

function takeCodePoints(s: string, n: number): string {
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let out = "";
  for (const { segment } of seg.segment(s)) {
    if ([...out].length + [...segment].length > n) break;
    out += segment;
  }
  return out;
}

type CleanFields = Pick<ComposeItem, "clean" | "cleanFamily" | "cleanFormat">;
/**
 * Contenu passé par la décision de nettoyage (nettoyé, sans objet, original, ou « non
 * nettoyable » marqué) : seul celui-là peut être chiffré (clean-gate.ts).
 */
function cleared<T extends { data: Blob | Uint8Array<ArrayBuffer> } & CleanFields>(it: T): T {
  if (it.data instanceof Blob) approve(it.data);
  return it;
}

/**
 * « Nettoyer » (élément laissé « Original » par le réglage) ou « Réessayer » (échec) : seulement
 * un fichier qui pourrait être nettoyé. Archive : jamais ouverte (D41-27), donc jamais proposée.
 */
export function canClean(i: Pick<ComposeItem, "kind" | "clean" | "category" | "cleanable">): "nettoyer" | "reessayer" | null {
  if (i.kind !== "file" || i.category === "archives") return null;
  if (i.clean === "original") return i.cleanable ? "nettoyer" : null;
  if (i.clean === "echec") return "reessayer";
  return null;
}

function catRank(c: Category): number {
  return CATEGORY_ORDER.indexOf(c);
}

function withDuplicates(list: ComposeItem[]): ComposeItem[] {
  const key = (i: ComposeItem) => (i.kind === "file" ? `${cleanName(i.base + i.ext).toLowerCase()}\u0000${i.size}` : null);
  const counts = new Map<string, number>();
  for (const i of list) {
    const k = key(i);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return list.map((i) => {
    const k = key(i);
    const dup = k !== null && counts.get(k)! > 1;
    return dup === i.duplicate ? i : { ...i, duplicate: dup };
  });
}

/** Insère à la fin de sa catégorie (l'ordre des catégories est celui du manifeste). */
function insertSorted(list: ComposeItem[], it: ComposeItem): ComposeItem[] {
  const r = catRank(it.category);
  let at = list.length;
  for (let i = 0; i < list.length; i++)
    if (catRank(list[i]!.category) > r) {
      at = i;
      break;
    }
  return [...list.slice(0, at), it, ...list.slice(at)];
}

export function createComposer(deps: ComposeDeps = {}) {
  const names = deps.names ?? FR_NAMES;
  // Lecture d'essai : les premiers octets seulement (type par le contenu, sniff.ts).
  const probe = deps.probe ?? (async (f: Blob) => new Uint8Array(await f.slice(0, HEAD_BYTES).arrayBuffer()));
  const commit = deps.commit ?? ((apply: () => void) => apply());
  const online = deps.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const strip = deps.strip ?? stripMetadata;
  const autoClean = deps.autoClean ?? (() => true);

  /** Nettoyage d'un fichier à l'ajout : données à envoyer et état. */
  async function cleanOf(f: File, source: Source, name: string, category: Category, captureStripped: boolean | undefined): Promise<{ data: Blob; c: CleanFields }> {
    // Photo prise ici : JPEG tiré d'un <canvas>, sans EXIF ni position par construction.
    if (source === "photo-ici" && category === "photos") return { data: f, c: { clean: "nettoye", cleanFamily: "image" } };
    // Vidéo prise ici : déjà passée par strip-capture.ts (CaptureScreen) ; un échec y a déjà été
    // montré à la personne (« Garder tel quel »).
    if (source === "video-ici" && captureStripped !== undefined) return { data: f, c: captureStripped ? { clean: "nettoye", cleanFamily: "video" } : { clean: "echec" } };
    if (!autoClean()) return { data: f, c: { clean: "original" } };
    // Archives : jamais ouvertes ni modifiées (décision du propriétaire, D41-27).
    if (category === "archives") return { data: f, c: { clean: "intact" } };
    const r = await strip(f, f.type, name, { recorded: source === "video-ici" });
    if (r.state === "nettoye") return { data: r.data, c: { clean: "nettoye", cleanFamily: r.family } };
    if (r.state === "non_pris_en_charge") return { data: f, c: { clean: r.state, cleanFormat: r.format } };
    return { data: f, c: { clean: r.state } };
  }

  let items = $state.raw<ComposeItem[]>([]);
  let pending = $state(0);
  let reserved = 0; // places prises par des ajouts en cours (avant insertion)
  let seq = 0;
  const counters = { photo: 0, video: 0, pasted: 0, text: 0, voice: 0 };
  const nextId = () => `i${++seq}`;

  function set(next: ComposeItem[]) {
    const before = items.length;
    items = withDuplicates(next);
    if (before === 0 && items.length > 0) deps.onFirstItem?.();
    if (before > 0 && items.length === 0) deps.onEmpty?.();
  }

  function named(f: File, source: Source): { base: string; ext: string } {
    const img = categoryOf("file", f.name, f.type) === "photos";
    if ((source === "photo" || source === "photo-ici") && img) return { base: names.photo(++counters.photo), ext: "." + extFor(f, "jpg") };
    if (source === "video" || source === "video-ici") return { base: names.video(++counters.video), ext: "." + extFor(f, "mp4") };
    if (source === "collage" && img) return { base: names.pasted(++counters.pasted), ext: "." + extFor(f, "png") };
    return splitName(cleanName(f.name));
  }

  /** `captureStripped` : vidéo prise ici, résultat du nettoyage de strip-capture.ts. */
  async function add(files: File[], source: Source, captureStripped?: boolean): Promise<AddReport> {
    const report: AddReport = { added: [], refusedCount: [], unreadable: [], folders: [], duplicates: [] };
    if (files.length === 0) return report;
    pending++;
    let held = 0;
    try {
      const readable: File[] = [];
      const heads = new Map<File, Sniffed>();
      const formats = new Map<File, Format>();
      for (const f of files) {
        try {
          const head = await probe(f);
          heads.set(f, head ? sniff(head) : null);
          formats.set(f, head ? detectFormat(head, f.type, f.name) : "inconnu");
          readable.push(f);
        } catch {
          report.unreadable.push(cleanName(f.name));
        }
      }
      const free = Math.max(0, MAX_ITEMS - items.length - reserved);
      const accepted = readable.slice(0, free);
      held = accepted.length;
      reserved += held;
      report.refusedCount = readable.slice(free).map((f) => cleanName(f.name));

      const ready: ComposeItem[] = [];
      for (const f of accepted) {
        const mime = f.type;
        const { base, ext } = named(f, source);
        const sniffed = heads.get(f) ?? null;
        const category = categoryOf("file", base + ext, mime, sniffed);
        const exec = isExecutableSniff(sniffed) || sniffed === "iso";
        const risky = exec || isRiskyName(base + ext);
        const mismatch = exec && !isRiskyName(base + ext);
        const { data, c } = await cleanOf(f, source, base + ext, category, captureStripped);
        const fmt = formats.get(f) ?? "inconnu";
        const recorded = source === "video-ici";
        const cleanable = (IMAGE_FORMATS as readonly string[]).includes(fmt) || (DOC_FORMATS as readonly string[]).includes(fmt) || (recorded && (fmt === "mp4" || fmt === "webm"));
        ready.push(cleared({ id: nextId(), kind: "file", category, base, ext, mime, size: data.size, data, ...c, duplicate: false, sniffed, risky, mismatch, cleanable, ...(recorded ? { recorded } : {}) }));
      }
      if (ready.length > 0) {
        const all = [...items, ...ready];
        const marked = withDuplicates(all).slice(items.length);
        report.duplicates = marked.filter((i) => i.duplicate).map((i) => i.base + i.ext);
        report.added = ready.map((i) => i.base + i.ext);
        commit(() => {
          let next = items;
          for (const it of ready) next = insertSorted(next, it);
          set(next);
        });
      }
      return report;
    } finally {
      reserved -= held;
      pending--;
    }
  }

  /** Titre d'une note : nettoyé, borné ; vide → « Note », « Note 2 »… */
  function noteTitle(title: string | undefined): string {
    const tt = (title ?? "").trim();
    if (tt === "" || cleanName(`a${tt}a`) === "aa") return names.text(++counters.text);
    return takeCodePoints(cleanName(tt), NAME_MAX);
  }

  function addText(text: string, title?: string): string | null {
    if (items.length + reserved >= MAX_ITEMS) return null;
    const it: ComposeItem = {
      id: nextId(),
      kind: "text",
      category: "texte",
      base: noteTitle(title),
      ext: "",
      mime: "text/plain;charset=utf-8",
      size: utf8.encode(text).byteLength,
      data: new Uint8Array(0),
      text,
      clean: "sans",
      duplicate: false,
    };
    commit(() => set(insertSorted(items, it)));
    return it.id;
  }

  function updateText(id: string, text: string, title?: string): void {
    set(
      items.map((i) => {
        if (i.id !== id || i.kind !== "text") return i;
        const base = title === undefined ? i.base : title.trim() === "" ? i.base : noteTitle(title);
        return { ...i, base, text, size: utf8.encode(text).byteLength };
      }),
    );
  }

  /** Vocal pris ici : `stripped` faux si strip-capture.ts a échoué et que la personne a gardé l'enregistrement tel quel. */
  function addVoice(blob: Blob, mime: string, stripped = true, voice?: ComposeItem["voice"]): string | null {
    if (items.length + reserved >= MAX_ITEMS) return null;
    const ext = mime.startsWith("audio/mp4") ? ".m4a" : ".webm";
    const generic = names.voice(++counters.voice);
    const it: ComposeItem = {
      id: nextId(),
      kind: "file",
      category: "audio",
      base: generic,
      generic,
      ext,
      mime,
      size: blob.size,
      data: blob,
      ...(stripped ? { clean: "nettoye" as const, cleanFamily: "vocal" as const } : { clean: "echec" as const }),
      ...(voice ? { voice } : {}),
      recorded: true,
      cleanable: true,
      duplicate: false,
    };
    cleared(it);
    commit(() => set(insertSorted(items, it)));
    return it.id;
  }

  /**
   * Nettoyage à la demande (menu « … ») : « Nettoyer » un élément « Original » (réglage
   * désactivé), « Réessayer » un échec. Les autres états n'ont rien à refaire (nettoyé, archive
   * intacte, protégé, format non pris en charge, texte). Le contenu de la ligne change : le
   * brouillon (transfer/draft.ts, `sync`) interrompt et efface l'envoi déjà fait, puis renvoie
   * la version nettoyée (rien de l'ancienne ne reste sur le serveur).
   */
  let cleaning = $state.raw<ReadonlySet<string>>(new Set());
  async function clean(id: string): Promise<void> {
    const it = items.find((i) => i.id === id);
    if (!it || !canClean(it) || cleaning.has(id) || !(it.data instanceof Blob)) return;
    cleaning = new Set([...cleaning, id]);
    try {
      const r = await strip(it.data, it.mime, it.base + it.ext, { recorded: it.recorded === true });
      const now = items.find((i) => i.id === id);
      // Retiré, ou déjà remplacé, pendant le nettoyage : rien à appliquer.
      if (!now || now.data !== it.data) return;
      const c: CleanFields =
        r.state === "nettoye"
          ? { clean: "nettoye", cleanFamily: it.voice || it.generic !== undefined ? "vocal" : r.family }
          : r.state === "non_pris_en_charge"
            ? { clean: r.state, cleanFormat: r.format }
            : { clean: r.state };
      const data = r.state === "nettoye" ? r.data : it.data;
      set(items.map((i) => (i.id === id ? cleared({ ...i, clean: c.clean, cleanFamily: c.cleanFamily, cleanFormat: c.cleanFormat, data, size: data.size }) : i)));
    } finally {
      const next = new Set(cleaning);
      next.delete(id);
      cleaning = next;
    }
  }

  /** Retire ; `undo()` (une seule fois) remet l'élément à sa place. */
  function remove(id: string): { undo(): void } {
    const at = items.findIndex((i) => i.id === id);
    if (at < 0) return { undo() {} };
    const it = items[at]!;
    set(items.filter((i) => i.id !== id));
    let done = false;
    return {
      undo() {
        if (done || items.length + reserved >= MAX_ITEMS) return;
        done = true;
        const next = [...items];
        next.splice(Math.min(at, next.length), 0, it);
        // La place d'origine reste dans sa catégorie (tri stable par catégorie).
        set(next.map((x, i) => [x, i] as const).sort((a, b) => catRank(a[0].category) - catRank(b[0].category) || a[1] - b[1]).map((p) => p[0]));
      },
    };
  }

  /** « Tout retirer » ; `undo()` remet toute la liste. */
  function clear(): { undo(): void } {
    const before = items;
    set([]);
    let done = false;
    return {
      undo() {
        if (done || items.length > 0) return;
        done = true;
        set(before);
      },
    };
  }

  function rename(id: string, base: string): null | "vide" | "trop_long" | "interdit" {
    const it = items.find((i) => i.id === id);
    if (!it || it.kind !== "file") return "interdit";
    const r = renameTo(it, base);
    if (r !== "vide" || it.generic === undefined) return r;
    // Vocal : nom vide (ou invisible) → retour au nom générique.
    set(items.map((i) => (i.id === id ? { ...i, base: it.generic! } : i)));
    return null;
  }

  function renameTo(it: ComposeItem, base: string): null | "vide" | "trop_long" | "interdit" {
    const id = it.id;
    if (FORBIDDEN.test(base)) return "interdit";
    if (base.trim() === "") return "vide";
    if (codePoints((base + it.ext).normalize("NFC")) > NAME_MAX) return "trop_long";
    // Rien de visible (seulement des caractères invisibles, des points ou des espaces) : vide.
    if (cleanName(`a${base}a`) === "aa" || /^[\s.]*$/u.test(base)) return "vide";
    const full = cleanName(base + it.ext);
    if (!full.endsWith(it.ext)) return "vide";
    const nb = full.slice(0, full.length - it.ext.length);
    if (nb === "") return "vide";
    set(items.map((i) => (i.id === id ? { ...i, base: nb } : i)));
    return null;
  }

  function siblings(id: string): { list: ComposeItem[]; index: number; first: number } {
    const it = items.find((i) => i.id === id);
    if (!it) return { list: [], index: -1, first: 0 };
    const first = items.findIndex((i) => i.category === it.category);
    const list = items.filter((i) => i.category === it.category);
    return { list, index: list.indexOf(it), first };
  }

  function moveTo(id: string, index: number): void {
    const { list, index: from, first } = siblings(id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(list.length - 1, Math.trunc(index)));
    if (to === from) return;
    const moved = [...list];
    const [x] = moved.splice(from, 1);
    moved.splice(to, 0, x!);
    set([...items.slice(0, first), ...moved, ...items.slice(first + list.length)]);
  }

  function move(id: string, delta: -1 | 1): "ok" | "premier" | "dernier" {
    const { list, index } = siblings(id);
    if (index < 0) return "ok";
    if (delta < 0 && index === 0) return "premier";
    if (delta > 0 && index === list.length - 1) return "dernier";
    moveTo(id, index + delta);
    return "ok";
  }

  function positionOf(id: string): { index: number; of: number; category: Category } | null {
    const { list, index } = siblings(id);
    return index < 0 ? null : { index: index + 1, of: list.length, category: list[index]!.category };
  }

  const totalBytes = $derived(items.reduce((s, i) => s + i.size, 0));
  // Envoi dès l'ajout (spec §41.14) : un fichier d'au moins 4 Mio occupe des segments entiers,
  // les petits se partagent des segments (audit H-2).
  const segments = $derived(segmentsNeeded(items.flatMap((i) => (i.kind === "file" ? [i.size] : []))));
  // Taille du manifeste, majorée (D41-17) : mêmes noms et textes que toApiItems, tailles et
  // positions à leur plus grand nombre de chiffres, droit le plus long. Au-delà de
  // MANIFEST_MAX, sealFinal refuserait (« manifeste_trop_gros ») : on bloque avant. Chaque
  // fichier porte sa graine `k` (43 caractères, spec §41.14).
  const manifestBytes = $derived(
    new TextEncoder().encode(
      JSON.stringify({
        v: 2,
        rights: "enregistrer",
        keep_ttl_h: 24,
        items: items.map((i) =>
          i.kind === "text"
            ? { kind: "text", name: cleanName(i.base), mime: i.mime, size: 0, offset: 0, text: i.text ?? "" }
            : { kind: "file", name: cleanName(i.base + i.ext), mime: i.mime || "application/octet-stream", size: CONTENT_MAX, offset: CONTENT_MAX, k: "k".repeat(43) },
        ),
      }),
    ).length,
  );

  function blockReason(): BlockReason | null {
    if (items.length === 0) return "vide";
    if (totalBytes > CONTENT_MAX) return "trop_gros";
    if (segments > DATA_SEGMENTS) return "segments";
    if (items.some((i) => i.kind === "text" && codePoints(i.text ?? "") > TEXT_MAX)) return "texte_trop_long";
    if (manifestBytes > MANIFEST_MAX) return "manifeste";
    if (pending > 0) return "nettoyage";
    if (!online()) return "hors_ligne";
    return null;
  }

  /**
   * Éléments en cause, marqués en rouge (S6) : programmes et scripts ; textes trop longs ;
   * au-delà de la taille permise, les plus gros fichiers qu'il suffit de retirer pour passer
   * sous la limite.
   */
  function culprits(): Set<string> {
    const out = new Set<string>();
    for (const i of items) {
      if (i.risky) out.add(i.id);
      if (i.kind === "text" && codePoints(i.text ?? "") > TEXT_MAX) out.add(i.id);
    }
    let over = totalBytes - CONTENT_MAX;
    if (over > 0)
      for (const i of [...items].filter((x) => x.kind === "file").sort((a, b) => b.size - a.size)) {
        if (over <= 0) break;
        out.add(i.id);
        over -= i.size;
      }
    return out;
  }

  function groups(): { category: Category; items: ComposeItem[]; count: number; bytes: number }[] {
    return CATEGORY_ORDER.map((category) => {
      const list = items.filter((i) => i.category === category);
      return { category, items: list, count: list.length, bytes: list.reduce((s, i) => s + i.size, 0) };
    }).filter((g) => g.count > 0);
  }

  function toApiItems(): Item[] {
    return items.map((i) =>
      i.kind === "text"
        ? { kind: "text", name: cleanName(i.base), mime: i.mime, data: utf8.encode(i.text ?? "") as Uint8Array<ArrayBuffer> }
        : { kind: "file", name: cleanName(i.base + i.ext), mime: i.mime || "application/octet-stream", data: i.data },
    );
  }

  return {
    get items() {
      return items;
    },
    get count() {
      return items.length;
    },
    get totalBytes() {
      return totalBytes;
    },
    /** Ajouts en cours (lecture d'essai, nettoyage). */
    get pending() {
      return pending;
    },
    groups,
    add,
    addText,
    updateText,
    /** Fichiers marqués « Non nettoyé » (résumé près d'Envoyer). */
    get uncleanedCount() {
      return items.filter(isUncleaned).length;
    },
    addVoice,
    clean,
    /** Nettoyage à la demande en cours pour cet élément. */
    isCleaning: (id: string) => cleaning.has(id),
    remove,
    clear,
    rename,
    move,
    moveTo,
    positionOf,
    blockReason,
    culprits,
    toApiItems,
  };
}

export type Composer = ReturnType<typeof createComposer>;
