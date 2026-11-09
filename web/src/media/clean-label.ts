// Le seul endroit qui choisit le texte d'état du nettoyage d'un élément (spec §35.2, D41-23 ;
// présentation D41-34, retours UI7) : un seul endroit d'état par fichier, la bulle du cadenas,
// dont la 2ᵉ ligne dit le nettoyage. Sur la ligne : une étincelle discrète si le fichier est
// nettoyé, rien s'il part tel quel, une pastille ambre seulement si le nettoyage a échoué.
import type { CleanFamily, CleanState } from "./strip";

/** `original` : nettoyage automatique désactivé dans les Réglages (rien n'est modifié). */
export type ItemCleanState = CleanState | "original";
export type ItemClean = { clean: ItemCleanState; cleanFamily?: CleanFamily };

const DONE = {
  image: "clean.done.image",
  video: "clean.done.video",
  audio: "clean.done.audio",
  pdf: "clean.done.pdf",
  bureautique: "clean.done.office",
  vocal: "clean.done.vocal",
} as const satisfies Record<CleanFamily, string>;

/** Le nettoyage a été tenté et n'a pas abouti (échec, fichier signé ou protégé) : le fichier part
 *  tel quel, sans clic (D41-23). Compté dans « N fichiers n'ont pas pu être nettoyés ». */
export function isCleanFailure(i: ItemClean): boolean {
  return i.clean === "echec" || i.clean === "protege";
}

/** 2ᵉ ligne de la bulle du cadenas ; null pour un texte (rien à nettoyer). */
export function cleanLineKey(i: ItemClean) {
  switch (i.clean) {
    case "nettoye":
      return DONE[i.cleanFamily ?? "image"];
    case "sans":
      return null;
    case "echec":
      return "clean.fail.echec" as const;
    case "protege":
      return "clean.fail.protege" as const;
    default:
      // original (choix), intact (archive, D41-27), non_pris_en_charge (format non concerné)
      return "clean.asis" as const;
  }
}

/** Marque de la ligne : étincelle (nettoyé), pastille ambre (échec), rien sinon. */
export function cleanMark(i: ItemClean): "spark" | "fail" | null {
  if (i.clean === "nettoye") return "spark";
  return isCleanFailure(i) ? "fail" : null;
}
