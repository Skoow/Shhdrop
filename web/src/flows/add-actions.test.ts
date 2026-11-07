import { describe, expect, it } from "vitest";
import { addGroups, desktopActions } from "./add-actions";

const all = { photo: true, video: true, voice: true };
const none = { photo: false, video: false, voice: false };

describe("feuille « Ajouter » (téléphone)", () => {
  it("trois groupes : prendre ici, créer, depuis l'appareil ; aucun doublon", () => {
    const g = addGroups({ support: all, touch: true });
    expect(g.map((x) => x.id)).toEqual(["capture", "create", "device"]);
    const ids = g.flatMap((x) => x.actions.map((a) => a.id));
    expect(ids).toEqual(["photo", "video", "voice", "note", "gallery", "files"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(g[0]!.actions.every((a) => a.live)).toBe(true);
  });
  it("sans caméra dans la page : photo et vidéo passent par l'appareil photo du système ; vocal masqué", () => {
    const g = addGroups({ support: none, touch: true });
    const cap = g.find((x) => x.id === "capture")!.actions;
    expect(cap).toEqual([
      { id: "photo", live: false },
      { id: "video", live: false },
    ]);
  });
  it("vidéo sans MediaRecorder : repli ; photo reste dans la page", () => {
    const cap = addGroups({ support: { photo: true, video: false, voice: false }, touch: true })[0]!.actions;
    expect(cap).toEqual([
      { id: "photo", live: true },
      { id: "video", live: false },
    ]);
  });
  it("sans écran tactile : pas de « Photos et vidéos » (même sélecteur que Fichiers)", () => {
    const ids = addGroups({ support: all, touch: false }).flatMap((x) => x.actions.map((a) => a.id));
    expect(ids).not.toContain("gallery");
    expect(ids).toContain("files");
  });
});

describe("rangée sobre (ordinateur) : la zone de dépôt tient lieu de « Fichiers »", () => {
  it("photo, vidéo, vocal, note ; ni fichiers ni galerie", () => {
    expect(desktopActions(all).map((a) => a.id)).toEqual(["photo", "video", "voice", "note"]);
    expect(desktopActions(none).map((a) => a.id)).toEqual(["photo", "video", "note"]);
  });
});
