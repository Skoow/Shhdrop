// Le seul endroit qui choisit le texte d'état du nettoyage d'un élément (spec §35.2 ; décision
// D41-23 du propriétaire : nettoyage automatique et non bloquant — un fichier qui n'a pas pu
// être nettoyé part sans clic, avec une marque « Non nettoyé » bien visible et sa raison).
import type { Format } from "./format";
import type { CleanFamily, CleanState } from "./strip";

/** `original` : nettoyage automatique désactivé dans les Réglages (rien n'est modifié). */
export type ItemCleanState = CleanState | "original";
export type ItemClean = { clean: ItemCleanState; cleanFamily?: CleanFamily; cleanFormat?: Format; category?: string };

const DONE = {
  image: "clean.done.image",
  video: "clean.done.video",
  audio: "clean.done.audio",
  bureautique: "clean.done.office",
  vocal: "clean.done.vocal",
} as const satisfies Record<CleanFamily, string>;

/** Le fichier part avec ses métadonnées éventuelles (échec, protégé, format non pris en charge).
 *  PDF et archives laissés intacts par décision (D41-27) : marque neutre, pas comptés ici. */
export function isUncleaned(i: ItemClean): boolean {
  return i.clean === "echec" || i.clean === "protege" || i.clean === "non_pris_en_charge";
}

/** Raison courte de la marque « Non nettoyé » ; null pour un élément nettoyé, original ou texte. */
export function uncleanedReasonKey(i: ItemClean) {
  if (i.clean === "echec") return "clean.why.echec" as const;
  if (i.clean === "protege") return "clean.why.protege" as const;
  if (i.clean !== "non_pris_en_charge") return null;
  switch (i.cleanFormat) {
    case "mp4":
    case "webm":
      return "clean.why.video" as const;
    case "mp3":
    case "ogg":
    case "flac":
    case "wav":
      return "clean.why.audio" as const;
    default:
      return "clean.why.unknown" as const;
  }
}

/** Phrase d'état d'un élément (infobulle, lecteur d'écran) ; null : rien à dire (texte, texte brut). */
export function cleanLabelKey(i: ItemClean) {
  switch (i.clean) {
    case "nettoye":
      return DONE[i.cleanFamily ?? "image"];
    case "original":
      return "clean.original.hint" as const;
    case "sans":
      return null;
    case "intact":
      return i.category === "archives" ? ("clean.intact.archive.hint" as const) : ("clean.intact.hint" as const);
    default:
      return "clean.uncleaned.hint" as const;
  }
}

/** Marque neutre d'un fichier laissé intact par décision (PDF, archive, D41-27) ; null sinon. */
export function intactKey(i: ItemClean) {
  if (i.clean !== "intact") return null;
  return i.category === "archives" ? ("clean.intact.archive" as const) : ("clean.intact" as const);
}
