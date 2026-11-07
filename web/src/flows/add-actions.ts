// Ce qu'on peut ajouter (composeur et accueil). Téléphone : une seule action « Ajouter » ouvre
// une feuille en liste groupée ; ordinateur : la zone de dépôt (fichiers) et une rangée sobre.
// `live` : capture dans l'interface (media/capture.ts) ; sinon repli sur l'appareil photo du
// système (<input capture>). Le vocal n'a pas de repli : sans enregistreur, il n'est pas proposé.
import type { CaptureMode } from "../media/capture";

export type AddId = "photo" | "video" | "voice" | "note" | "gallery" | "files";
export type AddAction = { id: AddId; live: boolean };
export type AddGroup = { id: "capture" | "create" | "device"; actions: AddAction[] };

function captureRow(support: Record<CaptureMode, boolean>): AddAction[] {
  const row: AddAction[] = [
    { id: "photo", live: support.photo },
    { id: "video", live: support.video },
  ];
  if (support.voice) row.push({ id: "voice", live: true });
  return row;
}

export function addGroups(o: { support: Record<CaptureMode, boolean>; touch: boolean }): AddGroup[] {
  const device: AddAction[] = o.touch ? [{ id: "gallery", live: false }, { id: "files", live: false }] : [{ id: "files", live: false }];
  return [
    { id: "capture", actions: captureRow(o.support) },
    { id: "create", actions: [{ id: "note", live: false }] },
    { id: "device", actions: device },
  ];
}

export function desktopActions(support: Record<CaptureMode, boolean>): AddAction[] {
  return [...captureRow(support), { id: "note", live: false }];
}
