import { describe, expect, it } from "vitest";
import { addActions, desktopActions } from "./add-actions";

const all = { photo: true, video: true, voice: true };
const none = { photo: false, video: false, voice: false };

describe("feuille « Ajouter » (téléphone)", () => {
  it("Photo ou vidéo, Vocal, Note, Fichiers ; aucun doublon ; la caméra intégrée d'abord", () => {
    const a = addActions(all);
    expect(a.map((x) => x.id)).toEqual(["media", "voice", "note", "files"]);
    expect(a[0]).toEqual({ id: "media", live: true });
  });
  it("sans caméra dans la page : Photo ou vidéo ouvre la galerie ; vocal masqué", () => {
    expect(addActions(none)).toEqual([
      { id: "media", live: false },
      { id: "note", live: false },
      { id: "files", live: false },
    ]);
  });
  it("caméra sans MediaRecorder : caméra intégrée (photo seule), pas de vocal", () => {
    expect(addActions({ photo: true, video: false, voice: false }).map((x) => [x.id, x.live])).toEqual([
      ["media", true],
      ["note", false],
      ["files", false],
    ]);
  });
});

describe("rangée sobre (ordinateur) : la zone de dépôt tient lieu de « Fichiers »", () => {
  it("Photo ou vidéo, vocal, note", () => {
    expect(desktopActions(all).map((a) => a.id)).toEqual(["media", "voice", "note"]);
    expect(desktopActions(none).map((a) => a.id)).toEqual(["media", "note"]);
  });
});
