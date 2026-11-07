// Enregistrer un élément reçu (UI §9.9, spec §12, §18.7). En flux vers le sélecteur de
// fichier quand il existe (fichier partiel supprimé par abort() en cas d'échec ou
// d'annulation), sinon assemblage en Blob application/octet-stream puis <a download>. Le nom
// proposé est toujours safeName(i) ; le type MIME du manifeste n'est jamais utilisé ici.
// « saved » n'est rendu qu'après close() réussi, ou après le déclenchement du lien (repli).
import type { Opened } from "../index";

export type SaveResult = "saved" | "cancelled" | "failed" | "disk_full";

type Writable = { write(chunk: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(reason?: unknown): Promise<void> };
type Handle = { createWritable(): Promise<Writable> };
export type SaveDeps = {
  showSaveFilePicker?: (o: { suggestedName: string }) => Promise<Handle>;
  collectToBlob: (o: Opened, i: number) => Promise<Blob>;
  /** Déclenche le téléchargement de `url` sous le nom `name` (lien <a download> cliqué par le code). */
  click: (url: string, name: string) => void;
  /** Horloge en millisecondes (vitesse mesurée). */
  now: () => number;
};

/** Délai avant la révocation de l'URL du repli : le téléchargement a le temps de démarrer. */
export const REVOKE_AFTER_MS = 60_000;

const abortError = () => new DOMException("Enregistrement annulé", "AbortError");
const named = (e: unknown, name: string) => typeof e === "object" && e !== null && (e as { name?: unknown }).name === name;

export async function saveItemTo(
  opened: Opened,
  i: number,
  deps: SaveDeps,
  onBytes: (done: number, total: number, bytesPerS: number) => void,
  signal?: AbortSignal,
): Promise<SaveResult> {
  const name = opened.safeName(i);
  const total = opened.manifest.items[i]?.size ?? 0;
  const start = deps.now();
  let done = 0;
  const count = (n: number) => {
    done += n;
    const s = (deps.now() - start) / 1000;
    onBytes(done, total, s > 0 ? done / s : 0);
  };
  if (signal?.aborted) return "cancelled";

  if (deps.showSaveFilePicker) {
    let handle: Handle;
    try {
      handle = await deps.showSaveFilePicker({ suggestedName: name });
    } catch (e) {
      // Sélecteur fermé : retour silencieux, rien n'a été écrit.
      if (named(e, "AbortError")) return "cancelled";
      return "failed";
    }
    let w: Writable;
    try {
      w = await handle.createWritable();
    } catch (e) {
      return named(e, "QuotaExceededError") ? "disk_full" : "failed";
    }
    try {
      await opened.saveItem(i, async (chunk) => {
        if (signal?.aborted) throw abortError();
        await w.write(chunk);
        count(chunk.length);
      });
      if (signal?.aborted) throw abortError();
      await w.close();
      return "saved";
    } catch (e) {
      await w.abort().catch(() => undefined); // le fichier partiel est supprimé
      if (signal?.aborted) return "cancelled";
      return named(e, "QuotaExceededError") ? "disk_full" : "failed";
    }
  }

  // Repli : même progression, en lisant à travers un Opened qui compte et s'arrête au signal.
  const counted: Opened = {
    ...opened,
    saveItem: (j, sink) =>
      opened.saveItem(j, async (chunk) => {
        if (signal?.aborted) throw abortError();
        const n = chunk.length; // avant sink : collectToBlob peut remettre la tranche à zéro
        await sink(chunk);
        count(n);
      }),
  };
  let blob: Blob;
  try {
    blob = await deps.collectToBlob(counted, i);
  } catch (e) {
    if (signal?.aborted) return "cancelled";
    return named(e, "QuotaExceededError") ? "disk_full" : "failed";
  }
  if (signal?.aborted) return "cancelled";
  // collectToBlob rend déjà du application/octet-stream ; on l'impose de toute façon.
  const safe = blob.type === "application/octet-stream" ? blob : new Blob([blob], { type: "application/octet-stream" });
  const url = URL.createObjectURL(safe);
  try {
    deps.click(url, name);
  } catch {
    URL.revokeObjectURL(url);
    return "failed";
  }
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return "saved";
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
