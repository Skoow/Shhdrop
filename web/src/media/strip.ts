// Porte unique du nettoyage des métadonnées (spec §35.2) : dans le navigateur, avant tout
// chiffrement, sans réencodage ni dépendance. Le résultat n'est « nettoye » que s'il est
// vérifié : relu par le même analyseur, il ne demande plus aucun changement. Toute erreur
// d'analyse rend `echec` (jamais d'exception, jamais de fichier à moitié modifié) ; seul un
// abandon (signal) est propagé.
import { STRIP_MAX } from "../limits";
import { Malformed, equal } from "./bytes";
import { FORMAT_HEAD, SOON_FORMATS, detectFormat, type Format } from "./format";
import { cleanGif } from "./gif";
import { cleanHeif } from "./heif";
import { cleanJpeg } from "./jpeg";
import { patchedBlob } from "./patch";
import { cleanPng } from "./png";
import { stripCaptureMeta } from "./strip-capture";
import { cleanWebp } from "./webp";

export type CleanState = "nettoye" | "echec" | "protege" | "non_pris_en_charge" | "sans";
export type CleanNote = "suivi_modifs" | "pdf_revisions";
export type CleanFamily = "image" | "video" | "audio" | "pdf" | "bureautique" | "vocal";
export type StripResult =
  | { state: "nettoye"; data: Blob; notes: CleanNote[]; family: CleanFamily }
  | { state: "echec" | "protege"; reason: string } // reason : code interne, jamais affiché tel quel
  /** `soon` : nettoyage prévu (PDF, bureautique, vidéo, audio : Tasks 9b et 9c). */
  | { state: "non_pris_en_charge"; soon: boolean }
  | { state: "sans" };

export type StripOpts = { recorded?: boolean; signal?: AbortSignal };

const SMALL: Partial<Record<Format, (b: Uint8Array) => Uint8Array<ArrayBuffer>>> = { jpeg: cleanJpeg, png: cleanPng, webp: cleanWebp, gif: cleanGif };

async function run(file: Blob, mime: string, fmt: Format, opts: StripOpts): Promise<StripResult> {
  const type = mime || file.type;
  const small = SMALL[fmt];
  if (small) {
    if (file.size > STRIP_MAX) return { state: "echec", reason: "trop_gros" };
    const src = new Uint8Array(await file.arrayBuffer());
    opts.signal?.throwIfAborted();
    const out = small(src);
    if (!equal(small(out), out)) return { state: "echec", reason: "verification" };
    return { state: "nettoye", data: new Blob([out], { type }), notes: [], family: "image" };
  }
  if (fmt === "heif") {
    const data = patchedBlob(file, await cleanHeif(file), [], type);
    opts.signal?.throwIfAborted();
    if ((await cleanHeif(data)).length > 0) return { state: "echec", reason: "verification" };
    return { state: "nettoye", data, notes: [], family: "image" };
  }
  if (opts.recorded && (fmt === "webm" || fmt === "mp4")) {
    // Vidéos et vocaux pris dans l'interface : nom du navigateur et dates (strip-capture.ts).
    const r = await stripCaptureMeta(file);
    if (!r.stripped) return { state: "echec", reason: "capture" };
    return { state: "nettoye", data: r.blob, notes: [], family: type.startsWith("audio/") ? "vocal" : "video" };
  }
  if (fmt === "texte") return { state: "sans" };
  return { state: "non_pris_en_charge", soon: (SOON_FORMATS as readonly string[]).includes(fmt) };
}

export async function stripMetadata(file: Blob, mime: string, name: string, opts: StripOpts = {}): Promise<StripResult> {
  try {
    const head = new Uint8Array(await file.slice(0, FORMAT_HEAD).arrayBuffer());
    return await run(file, mime, detectFormat(head, mime, name), opts);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    // Structure invalide, lecture impossible (fichier modifié ou retiré du disque) : échec.
    return { state: "echec", reason: e instanceof Malformed ? e.message : "lecture" };
  }
}
