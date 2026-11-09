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
import { cleanOffice } from "./office";
import { patchedBlob } from "./patch";
import { cleanPdf } from "./pdf";
import { cleanPng } from "./png";
import { stripCaptureMeta } from "./strip-capture";
import { cleanWebp } from "./webp";

/** `intact` : laissé tel quel par décision (archives, D41-27 ; posé par le composeur). */
export type CleanState = "nettoye" | "echec" | "protege" | "non_pris_en_charge" | "sans" | "intact";
export type CleanFamily = "image" | "video" | "audio" | "pdf" | "bureautique" | "vocal";
export type StripResult =
  | { state: "nettoye"; data: Blob; family: CleanFamily }
  | { state: "echec" | "protege"; reason: string } // reason : code interne, jamais affiché tel quel
  /** `soon` : nettoyage prévu (vidéo, audio : Task 9c) ; `format` reconnu. */
  | { state: "non_pris_en_charge"; soon: boolean; format: Format }
  | { state: "sans" }
  | { state: "intact" };

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
    return { state: "nettoye", data: new Blob([out], { type }), family: "image" };
  }
  if (fmt === "heif") {
    const data = patchedBlob(file, await cleanHeif(file), [], type);
    opts.signal?.throwIfAborted();
    if ((await cleanHeif(data)).length > 0) return { state: "echec", reason: "verification" };
    return { state: "nettoye", data, family: "image" };
  }
  // PDF (D41-31) : seules les informations cachées (/Info, XMP /Metadata, miniatures /Thumb)
  // deviennent « null » à longueur constante ; pages et texte intacts ; résultat relu.
  if (fmt === "pdf") {
    const r = await cleanPdf(file);
    if (r.state === "protege") return { state: "protege", reason: "pdf" };
    const data = patchedBlob(file, r.patches, [], type);
    opts.signal?.throwIfAborted();
    const again = await cleanPdf(data);
    if (again.state !== "ok" || again.patches.length > 0 || data.size !== file.size) return { state: "echec", reason: "verification" };
    return { state: "nettoye", data, family: "pdf" };
  }
  if (fmt === "ooxml" || fmt === "odf") {
    const r = await cleanOffice(file, fmt, type);
    opts.signal?.throwIfAborted();
    if (r.state === "protege") return { state: "protege", reason: fmt };
    return { state: "nettoye", data: r.data, family: "bureautique" };
  }
  if (opts.recorded && (fmt === "webm" || fmt === "mp4")) {
    // Vidéos et vocaux pris dans l'interface : nom du navigateur et dates (strip-capture.ts).
    const r = await stripCaptureMeta(file);
    if (!r.stripped) return { state: "echec", reason: "capture" };
    return { state: "nettoye", data: r.blob, family: type.startsWith("audio/") ? "vocal" : "video" };
  }
  if (fmt === "texte") return { state: "sans" };
  return { state: "non_pris_en_charge", soon: (SOON_FORMATS as readonly string[]).includes(fmt), format: fmt };
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
