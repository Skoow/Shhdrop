// Le seul endroit qui choisit le texte d'état du nettoyage d'un élément (spec §35.2, D41-23 ;
// présentation D41-34, retours UI7) : un seul endroit d'état par fichier, la bulle du cadenas,
// dont la 2ᵉ ligne dit le nettoyage. Sur la ligne : une étincelle discrète si le fichier est
// nettoyé, rien s'il part tel quel, une pastille ambre seulement si le nettoyage a échoué.
import type { ManifestClean } from "../index";
export type { ManifestClean };
import type { Key } from "../i18n/i18n.svelte";
import type { Format } from "./format";
import type { CleanFamily, CleanState } from "./strip";

/** `original` : fichier ajouté tel quel, pas encore nettoyé (rien n'est nettoyé sans le balai). */
export type ItemCleanState = CleanState | "original";
/** `cleanFormat` avec `echec` : photo, vidéo ou son d'un format que le nettoyage ne sait pas lire. */
export type ItemClean = { clean: ItemCleanState; cleanFamily?: CleanFamily; cleanFormat?: Format };

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
      return i.cleanFormat === undefined ? ("clean.fail.echec" as const) : ("clean.fail.format" as const);
    case "protege":
      return "clean.fail.protege" as const;
    default:
      // original (choix), intact (archive, D41-27), non_pris_en_charge (format non concerné)
      return "clean.asis" as const;
  }
}

/** Marque de la ligne (retours UI8) : bouclier coché (nettoyé), bouclier ambre « ! » (échec), rien sinon. */
export function cleanMark(i: ItemClean): "done" | "fail" | null {
  if (i.clean === "nettoye") return "done";
  return isCleanFailure(i) ? "fail" : null;
}

/** Ce que le manifeste chiffré dit au destinataire (D41-35) ; null pour un texte. */
export function manifestClean(i: ItemClean & { kind: "text" | "file" }): ManifestClean | null {
  if (i.kind === "text") return null;
  if (i.clean === "nettoye") return i.cleanFamily ?? "image";
  if (i.clean === "echec" || i.clean === "protege") return i.clean;
  return "tel_quel";
}

const RECV_DONE = {
  image: "clean.recv.done.image",
  video: "clean.recv.done.video",
  audio: "clean.recv.done.audio",
  pdf: "clean.recv.done.pdf",
  bureautique: "clean.recv.done.office",
  vocal: "clean.recv.done.vocal",
} as const satisfies Record<CleanFamily, string>;

/** Côté destinataire : texte (2ᵉ ligne du cadenas, bulle du bouclier) et marque ; absent → rien. */
export function receivedClean(c: ManifestClean | undefined): { key: Key; mark: "done" | "fail" | null } | null {
  if (c === undefined) return null;
  if (c === "tel_quel") return { key: "clean.recv.asis", mark: null };
  if (c === "echec" || c === "protege") return { key: c === "echec" ? "clean.recv.fail.echec" : "clean.recv.fail.protege", mark: "fail" };
  return { key: RECV_DONE[c], mark: "done" };
}

/**
 * Ce que le nettoyage retirerait d'un fichier, selon sa catégorie (bulle du balai et
 * confirmation, retours du propriétaire du 12 novembre) : dit AVANT de nettoyer.
 */
export function cleanWhatKey(category: string): "clean.what.photos" | "clean.what.videos" | "clean.what.audio" | "clean.what.documents" | "clean.what.misc" {
  return category === "photos" || category === "videos" || category === "audio" || category === "documents" ? `clean.what.${category}` : "clean.what.misc";
}
