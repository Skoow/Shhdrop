// Ce qu'on peut ajouter (composeur et accueil). Téléphone : une seule action « Ajouter » ouvre
// une feuille : Photo ou vidéo, Vocal, Note, Fichiers. Ordinateur : la zone de dépôt (fichiers)
// et une rangée sobre. « Photo ou vidéo » ouvre la caméra intégrée (media/capture.ts), qui donne
// aussi accès à la galerie ; sans caméra dans la page (`live` faux), directement la galerie.
// Le vocal n'a pas de repli : sans enregistreur, il n'est pas proposé.
import type { CaptureMode } from "../media/capture";

export type AddId = "media" | "voice" | "note" | "files";
export type AddAction = { id: AddId; live: boolean };

const media = (support: Record<CaptureMode, boolean>): AddAction => ({ id: "media", live: support.photo });
const voice = (support: Record<CaptureMode, boolean>): AddAction[] => (support.voice ? [{ id: "voice", live: true }] : []);

/** Feuille « Ajouter » (téléphone). */
export function addActions(support: Record<CaptureMode, boolean>): AddAction[] {
  return [media(support), ...voice(support), { id: "note", live: false }, { id: "files", live: false }];
}

/** Rangée de l'ordinateur : la zone de dépôt tient lieu de « Fichiers ». */
export function desktopActions(support: Record<CaptureMode, boolean>): AddAction[] {
  return [media(support), ...voice(support), { id: "note", live: false }];
}
