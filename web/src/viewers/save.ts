// Destinations des téléchargements reçus (UI §9.9, §9.8.6 ; spec §12, §18.7). Chaque
// destination rend, pour un élément, un puits { write, close, abort } :
// - fichier choisi (showSaveFilePicker) : écriture en flux, abort() supprime le partiel ;
// - dossier choisi une fois (showDirectoryPicker) : un fichier par élément, jamais d'écrasement
//   (« (2) ») ;
// - repli : assemblage en Blob application/octet-stream puis <a download>, 1 s entre deux.
// Le nom est toujours le nom nettoyé (safeName, puis zipName pour le dossier) ; le type MIME
// du manifeste n'est jamais utilisé. close() n'est appelé qu'à la fin d'une lecture complète.
import type { ItemSink } from "../flows/downloads.svelte";
import { lowMemory } from "../app/env";
import { zipName } from "../zip/store-zip";

/** Délai avant la révocation de l'URL du repli : le téléchargement a le temps de démarrer. */
export const REVOKE_AFTER_MS = 60_000;
/** Écart entre deux téléchargements du repli (« Tout télécharger » sans dossier). */
export const CLICK_GAP_MS = 1000;
/** Tranches repliées dans le Blob tous les 64 Mio (au plus ~64 Mio de tranches en mémoire JS). */
export const FOLD_BYTES = 64 * 1048576;

type Writable = { write(chunk: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(reason?: unknown): Promise<void> };
type FileHandle = { createWritable(): Promise<Writable> };
export type DirHandle = { getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle> };
export type SavePicker = (o: { suggestedName: string }) => Promise<FileHandle>;

const named = (e: unknown, name: string) => typeof e === "object" && e !== null && (e as { name?: unknown }).name === name;

/** Puits d'un fichier ouvert en écriture ; abort() efface le partiel. */
function writableSink(w: Writable): ItemSink {
  return { write: (c) => w.write(c), close: () => w.close(), abort: () => w.abort() };
}

/** Un fichier choisi par élément ; null si le sélecteur est fermé (AbortError). */
export async function pickFile(picker: SavePicker, name: string): Promise<ItemSink | null> {
  let h: FileHandle;
  try {
    h = await picker({ suggestedName: name });
  } catch (e) {
    if (named(e, "AbortError")) return null;
    throw e;
  }
  return writableSink(await h.createWritable());
}

/** Dossier choisi une fois : chaque élément y reçoit un nom libre (aucun écrasement). */
export function inDirectory(dir: DirHandle) {
  const taken = new Set<string>();
  return async (name: string): Promise<ItemSink> => {
    for (;;) {
      const n = zipName(name, taken);
      try {
        await dir.getFileHandle(n); // déjà présent : on essaie le nom suivant
        continue;
      } catch (e) {
        if (!named(e, "NotFoundError")) throw e;
      }
      return writableSink(await (await dir.getFileHandle(n, { create: true })).createWritable());
    }
  };
}

export type BlobDeps = {
  click: (url: string, name: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Repli : assemblage en Blob puis lien <a download>. Les déclenchements d'une même série sont
 * espacés de CLICK_GAP_MS (les navigateurs bloquent les rafales).
 */
export function blobDownloads(d: BlobDeps, foldBytes = FOLD_BYTES) {
  let lastClick = -Infinity;
  return (name: string): ItemSink => {
    const mime = "application/octet-stream";
    let acc: Blob | null = new Blob([], { type: mime });
    let parts: Uint8Array<ArrayBuffer>[] = [];
    let pending = 0;
    const zero = () => {
      for (const p of parts) p.fill(0);
      parts = [];
      pending = 0;
    };
    const fold = () => {
      acc = new Blob([acc!, ...parts], { type: mime });
      zero();
    };
    return {
      async write(c) {
        if (!acc) throw new Error("ferme");
        parts.push(c);
        pending += c.length;
        if (pending >= foldBytes) fold();
      },
      async close() {
        if (!acc) throw new Error("ferme");
        fold();
        const blob = acc;
        acc = null;
        const wait = lastClick + CLICK_GAP_MS - d.now();
        if (wait > 0) await d.sleep(wait);
        lastClick = d.now();
        const url = URL.createObjectURL(blob);
        try {
          d.click(url, name);
        } catch (e) {
          URL.revokeObjectURL(url);
          throw e;
        }
        setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
      },
      async abort() {
        zero();
        acc = null;
      },
    };
  };
}

/**
 * Sans sélecteur de fichier (iPhone, Firefox), un fichier est assemblé en mémoire avant d'être
 * enregistré (spec §18.7). Vrai si l'un des éléments risque d'épuiser la mémoire de cet appareil
 * (plus de 200 Mio sur un petit appareil, lowMemory) : l'écran prévient, sans rien bloquer.
 */
export function needsMemoryWarning(sizes: readonly number[], hasPicker: boolean, nav: Navigator): boolean {
  return !hasPicker && sizes.some((n) => lowMemory(nav, n));
}

/** Lien <a download> cliqué par le code, retiré aussitôt (repli sans sélecteur). */
export function clickDownload(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.hidden = true;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}
