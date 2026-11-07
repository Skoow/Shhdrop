// Lecture d'un élément pour l'aperçu (UI §9.8) : saveItem en flux, octets comptés, Blob du
// type sûr (TYPE_SUR), tranches remises à zéro ensuite. Un seul aperçu à la fois.
import type { Opened } from "../index";
import { safeBlobType } from "./blobs";

const aborted = () => new DOMException("Aperçu annulé", "AbortError");

/**
 * Blob d'aperçu de l'élément i. `onBytes(lus, total)` après chaque tranche. `signal` arrête
 * la lecture (AbortError) ; les tranches déjà lues sont mises à zéro dans tous les cas.
 * Error("type_refuse") si l'élément n'a pas de type d'aperçu sûr.
 */
export async function collectPreview(
  opened: Opened,
  i: number,
  onBytes: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const type = safeBlobType(opened.previewKind(i), opened.manifest.items[i]?.mime ?? "");
  if (type === null) throw new Error("type_refuse");
  if (signal?.aborted) throw aborted();
  const total = opened.manifest.items[i]!.size;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let done = 0;
  try {
    await opened.saveItem(i, (chunk) => {
      if (signal?.aborted) throw aborted();
      parts.push(chunk);
      done += chunk.length;
      onBytes(done, total);
    });
    if (signal?.aborted) throw aborted();
    return new Blob(parts, { type });
  } finally {
    for (const p of parts) p.fill(0);
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
