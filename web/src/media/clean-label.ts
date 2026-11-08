// Le seul endroit qui choisit le texte d'état du nettoyage d'un élément (spec §35.2 ; décision
// D41-23 du propriétaire : nettoyage automatique et non bloquant — un fichier qui n'a pas pu
// être nettoyé part sans clic, avec une marque « Non nettoyé » bien visible et sa raison).
import type { Format } from "./format";
import type { CleanFamily, CleanNote, CleanState } from "./strip";

/** `original` : nettoyage automatique désactivé dans les Réglages (rien n'est modifié). */
export type ItemCleanState = CleanState | "original";
export type ItemClean = { clean: ItemCleanState; cleanFamily?: CleanFamily; cleanFormat?: Format; cleanNotes?: readonly CleanNote[]; category?: string };

/** Remarques d'un élément nettoyé (modifications suivies, versions précédentes d'un PDF). */
export function cleanNoteKeys(i: ItemClean) {
  if (i.clean !== "nettoye") return [];
  return (i.cleanNotes ?? []).map((n) => (n === "suivi_modifs" ? ("clean.note.suivi_modifs" as const) : ("clean.note.pdf_revisions" as const)));
}

const DONE = {
  image: "clean.done.image",
  video: "clean.done.video",
  audio: "clean.done.audio",
  pdf: "clean.done.pdf",
  bureautique: "clean.done.office",
  vocal: "clean.done.vocal",
} as const satisfies Record<CleanFamily, string>;

/** Le fichier part avec ses métadonnées éventuelles (échec, protégé, format non pris en charge). */
export function isUncleaned(i: ItemClean): boolean {
  return i.clean === "echec" || i.clean === "protege" || i.clean === "non_pris_en_charge";
}

/** Raison courte de la marque « Non nettoyé » ; null pour un élément nettoyé, original ou texte. */
export function uncleanedReasonKey(i: ItemClean) {
  if (i.clean === "echec") return "clean.why.echec" as const;
  if (i.clean === "protege") return "clean.why.protege" as const;
  if (i.clean !== "non_pris_en_charge") return null;
  if (i.category === "archives") return "clean.why.archive" as const;
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
    default:
      return "clean.uncleaned.hint" as const;
  }
}
