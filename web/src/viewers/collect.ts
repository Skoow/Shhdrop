// Lecture d'un élément pour l'aperçu (UI §9.8) : saveItem en flux, octets comptés, Blob du
// type sûr (TYPE_SUR), tranches repliées tous les 64 Mio et remises à zéro aussitôt. Un seul aperçu à la fois.
import type { Opened } from "../index";
import { safeBlobType } from "./blobs";

const aborted = () => new DOMException("Aperçu annulé", "AbortError");

/** Tranches repliées dans le Blob tous les 64 Mio (comme blobDownloads, save.ts) : au plus ~64 Mio de clair en mémoire JS. */
export const PREVIEW_FOLD = 64 * 1048576;

/**
 * Blob d'aperçu de l'élément i. `onBytes(lus, total)` après chaque tranche. `signal` arrête
 * la lecture (AbortError) ; les tranches lues sont mises à zéro dès qu'elles sont repliées
 * dans le Blob (tous les `foldBytes`), et dans tous les cas à la fin.
 * Error("type_refuse") si l'élément n'a pas de type d'aperçu sûr.
 */
export async function collectPreview(
  opened: Opened,
  i: number,
  onBytes: (done: number, total: number) => void,
  signal?: AbortSignal,
  foldBytes = PREVIEW_FOLD,
): Promise<Blob> {
  const type = safeBlobType(opened.previewKind(i), opened.manifest.items[i]?.mime ?? "");
  if (type === null) throw new Error("type_refuse");
  if (signal?.aborted) throw aborted();
  const total = opened.manifest.items[i]!.size;
  let acc = new Blob([], { type });
  let parts: Uint8Array<ArrayBuffer>[] = [];
  let pending = 0;
  const zero = () => {
    for (const p of parts) p.fill(0);
    parts = [];
    pending = 0;
  };
  const fold = () => {
    acc = new Blob([acc, ...parts], { type });
    zero();
  };
  let done = 0;
  try {
    await opened.saveItem(i, (chunk) => {
      if (signal?.aborted) throw aborted();
      parts.push(chunk);
      pending += chunk.length;
      done += chunk.length;
      if (pending >= foldBytes) fold();
      onBytes(done, total);
    });
    if (signal?.aborted) throw aborted();
    fold();
    return acc;
  } finally {
    zero();
  }
}

/** File d'aperçus : une lecture à la fois (borne mémoire et bande passante). */
export function previewQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>) => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
