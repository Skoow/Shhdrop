// Le seul endroit qui choisit le texte d'état du nettoyage d'un élément (spec §35.2 ; décision
// du propriétaire du 8 novembre : nettoyage automatique, jamais d'envoi silencieux non nettoyé).
import type { CleanFamily, CleanState } from "./strip";

/** `original` : nettoyage automatique désactivé dans les Réglages (rien n'est modifié). */
export type ItemCleanState = CleanState | "original";
export type ItemClean = { clean: ItemCleanState; cleanSoon?: boolean; cleanFamily?: CleanFamily; accepted?: boolean };

const DONE = {
  image: "clean.done.image",
  video: "clean.done.video",
  audio: "clean.done.audio",
  pdf: "clean.done.pdf",
  bureautique: "clean.done.office",
  vocal: "clean.done.vocal",
} as const satisfies Record<CleanFamily, string>;

/** Non nettoyé et pas encore choisi : « Envoyer tel quel » ou « Retirer » ; l'envoi attend. */
export function needsChoice(i: ItemClean): boolean {
  return (i.clean === "echec" || i.clean === "protege" || i.clean === "non_pris_en_charge") && !i.accepted;
}

/** Phrase d'état d'un élément ; null : rien à dire (texte, texte brut). */
export function cleanLabelKey(i: ItemClean) {
  switch (i.clean) {
    case "nettoye":
      return DONE[i.cleanFamily ?? "image"];
    case "echec":
      return "clean.echec" as const;
    case "protege":
      return "clean.protege" as const;
    case "non_pris_en_charge":
      return i.cleanSoon ? ("clean.soon" as const) : ("clean.unsupported" as const);
    case "original":
      return "clean.original.hint" as const;
    case "sans":
      return null;
  }
}
