// WAV (spec §35.2, Task 9c, technique 3) : seuls les blocs « fmt », « fact », « cue » et
// « data » sont gardés (recopiés tels quels, « data » par tranche du Blob) ; LIST/INFO, bext
// (auteur, date, UMID), iXML, axml, « id3 », _PMX (XMP), cart et tout autre bloc retirés ; taille
// RIFF corrigée ; ce qui suit la fin RIFF est retiré. RF64, tailles incohérentes → `Malformed`.
import { Malformed, concat, startsWith } from "./bytes";

const KEEP: ReadonlySet<string> = new Set(["fmt ", "fact", "cue ", "data"]);
const SMALL_MAX = 1 << 20;

/** Fichier nettoyé, ou null s'il n'y a rien à retirer. */
export async function cleanWav(file: Blob): Promise<Blob | null> {
  const h = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!startsWith(h, 0, "RIFF") || !startsWith(h, 8, "WAVE")) throw new Malformed(startsWith(h, 0, "RF64") ? "rf64" : "wav");
  const riffEnd = 8 + new DataView(h.buffer).getUint32(4, true);
  if (riffEnd > file.size || riffEnd < 12) throw new Malformed("taille_riff");
  const parts: BlobPart[] = [];
  let size = 4; // « WAVE »
  let dropped = riffEnd !== file.size;
  let fmt = false;
  let data = false;
  for (let o = 12; o < riffEnd; ) {
    if (riffEnd - o < 8) throw new Malformed("bloc_court");
    const ch = new Uint8Array(await file.slice(o, o + 8).arrayBuffer());
    const id = String.fromCharCode(...ch.subarray(0, 4));
    const len = new DataView(ch.buffer).getUint32(4, true);
    const padded = len + (len & 1);
    if (o + 8 + len > riffEnd) throw new Malformed("bloc_deborde");
    if (KEEP.has(id)) {
      if (id === "fmt ") fmt = true;
      if (id === "data") {
        if (data) throw new Malformed("data_double");
        data = true;
      }
      if (id !== "data" && len > SMALL_MAX) throw new Malformed("bloc_trop_gros");
      // Octet de bourrage absent en fin de fichier : on l'ajoute (bloc impair).
      const end = Math.min(o + 8 + padded, riffEnd);
      parts.push(file.slice(o, end));
      if (end < o + 8 + padded) parts.push(new Uint8Array(1));
      size += 8 + padded;
    } else dropped = true;
    o += 8 + padded;
  }
  if (!fmt || !data) throw new Malformed("fmt_data");
  if (!dropped) return null;
  const head = concat([new TextEncoder().encode("RIFF"), new Uint8Array(4), new TextEncoder().encode("WAVE")]);
  new DataView(head.buffer).setUint32(4, size, true);
  return new Blob([head, ...parts], { type: file.type });
}
