// Composeur (UI §9.2) : liste des éléments à envoyer, en mémoire seulement (aucun stockage).
// Toute addition passe par `add` (sélecteur, dépôt, collage, photo, vidéo) ou `addText` /
// `addVoice` : lecture d'essai → limite de nombre → nettoyage des images → doublons →
// insertion à la fin de sa catégorie. L'ordre de `items` est l'ordre du manifeste.
import { CONTENT_MAX, DATA_SEGMENTS, MANIFEST_MAX, MAX_ITEMS, NAME_MAX, STRIP_MAX, TEXT_MAX, cleanName, isRiskyName, segmentsNeeded, type Item } from "../index";
import { CATEGORY_ORDER, categoryOf, extOf, type Category } from "./kinds";
import { HEAD_BYTES, isExecutableSniff, sniff, type Sniffed } from "./sniff";

/** `photo-ici`, `video-ici` : pris dans l'interface (caméra maison, media/capture.ts), jamais dans la galerie. */
export type Source = "fichiers" | "photo" | "video" | "depot" | "collage" | "photo-ici" | "video-ici";
/** nettoye : métadonnées retirées (Task 9) ; non_nettoye : le fichier peut en contenir ; sans_objet : texte, vocal. */
export type CleanState = "nettoye" | "non_nettoye" | "sans_objet";

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
  readonly clean: CleanState;
  readonly duplicate: boolean;
  /** Type reconnu par le contenu (octets de tête), ou null. */
  readonly sniffed?: Sniffed;
  /** Exécutable ou script (extension à risque, ou contenu exécutable) : prévenir. */
  readonly risky?: boolean;
  /** Le contenu ne correspond pas à l'extension (exécutable déguisé, par exemple). */
  readonly mismatch?: boolean;
};

/** Nettoyage d'un fichier (Task 9a, media/strip) : rend le fichier nettoyé ou l'original. */
export type CleanFile = (file: File) => Promise<{ file: Blob; cleaned: boolean; removed: string[] }>;

export type AddReport = {
  added: string[];
  refusedCount: string[];
  unreadable: string[];
  folders: string[];
  failedClean: string[];
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
  /** Nettoyage automatique à l'ajout (Task 9a, media/strip). Absent : rien n'est marqué « nettoyé ». */
  clean?: CleanFile;
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

/** Clé de la mention « peut contenir… » d'un élément non nettoyé (UI §9.2.6) ; null sinon. */
export function metaNoteKey(i: Pick<ComposeItem, "clean" | "category" | "ext" | "mime">) {
  if (i.clean !== "non_nettoye") return null;
  if (i.category === "photos") return "compose.meta.photo" as const;
  if (i.category === "videos") return "compose.meta.video" as const;
  if (i.category === "documents") return i.ext.toLowerCase() === ".pdf" || i.mime === "application/pdf" ? ("compose.meta.pdf" as const) : ("compose.meta.doc" as const);
  return null;
}

const PLAIN_TEXT = new Set(["txt", "md", "csv"]);
/** Fichiers qui peuvent porter des métadonnées non retirées (un texte brut n'en a pas). */
function takeCodePoints(s: string, n: number): string {
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let out = "";
  for (const { segment } of seg.segment(s)) {
    if ([...out].length + [...segment].length > n) break;
    out += segment;
  }
  return out;
}

function cleanStateOf(category: Category, name: string, mime: string): CleanState {
  if (category === "documents" && (PLAIN_TEXT.has(extOf(name)) || mime.toLowerCase().startsWith("text/plain"))) return "sans_objet";
  return category === "photos" || category === "videos" || category === "documents" ? "non_nettoye" : "sans_objet";
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

  async function add(files: File[], source: Source): Promise<AddReport> {
    const report: AddReport = { added: [], refusedCount: [], unreadable: [], folders: [], failedClean: [], duplicates: [] };
    if (files.length === 0) return report;
    pending++;
    let held = 0;
    try {
      const readable: File[] = [];
      const heads = new Map<File, Sniffed>();
      for (const f of files) {
        try {
          const head = await probe(f);
          heads.set(f, head ? sniff(head) : null);
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
        let data: Blob | Uint8Array<ArrayBuffer> = f;
        let size = f.size;
        // Photo prise ici : JPEG tiré d'un <canvas>, sans EXIF ni position par construction.
        let clean = source === "photo-ici" && category === "photos" ? "nettoye" : cleanStateOf(category, base + ext, mime);
        if (deps.clean && clean === "non_nettoye" && (category !== "photos" || f.size <= STRIP_MAX)) {
          try {
            const r = await deps.clean(f);
            if (r.cleaned) {
              data = r.file;
              size = r.file.size;
              clean = "nettoye";
            }
          } catch {
            report.failedClean.push(base + ext);
            continue;
          }
        }
        ready.push({ id: nextId(), kind: "file", category, base, ext, mime, size, data, clean, duplicate: false, sniffed, risky, mismatch });
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
      clean: "sans_objet",
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

  /**
   * « Nettoyer tous les fichiers » : nettoie chaque élément « non nettoyé » ; ceux que la
   * bibliothèque ne sait pas (encore) nettoyer, ou qui échouent, restent tels quels.
   */
  async function cleanAll(clean: CleanFile): Promise<{ cleaned: string[]; failed: string[] }> {
    const out = { cleaned: [] as string[], failed: [] as string[] };
    const todo = items.filter((i) => i.kind === "file" && i.clean === "non_nettoye");
    pending++;
    try {
      for (const it of todo) {
        const name = it.base + it.ext;
        try {
          const src = it.data instanceof File ? it.data : new File([it.data as BlobPart], name, { type: it.mime });
          const r = await clean(src);
          if (!r.cleaned) {
            out.failed.push(name);
            continue;
          }
          set(items.map((x) => (x.id === it.id ? { ...x, data: r.file, size: r.file.size, clean: "nettoye" as const } : x)));
          out.cleaned.push(name);
        } catch {
          out.failed.push(name);
        }
      }
    } finally {
      pending--;
    }
    return out;
  }

  function addVoice(blob: Blob, mime: string): string | null {
    if (items.length + reserved >= MAX_ITEMS) return null;
    const ext = mime.startsWith("audio/mp4") ? ".m4a" : ".webm";
    const it: ComposeItem = {
      id: nextId(),
      kind: "file",
      category: "audio",
      base: names.voice(++counters.voice),
      ext,
      mime,
      size: blob.size,
      data: blob,
      clean: "sans_objet",
      duplicate: false,
    };
    commit(() => set(insertSorted(items, it)));
    return it.id;
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
    cleanAll,
    addVoice,
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
