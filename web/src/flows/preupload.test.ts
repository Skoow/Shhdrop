import { describe, expect, it } from "vitest";
import { rowStatus, toDraftList } from "./preupload";

describe("état d'envoi d'une ligne (spec §41.14)", () => {
  it("chiffrement, envoi N %, prêt, erreur ; rien pour un texte", () => {
    expect(rowStatus(undefined)).toBeNull();
    expect(rowStatus({ phase: "attente", sent: 0, total: 10 })).toEqual({ key: "compose.up.attente", percent: 0 });
    expect(rowStatus({ phase: "chiffrement", sent: 0, total: 10 })).toEqual({ key: "compose.up.chiffrement", percent: 0 });
    expect(rowStatus({ phase: "envoi", sent: 421, total: 1000 })).toEqual({ key: "compose.up.envoi", percent: 42 });
    expect(rowStatus({ phase: "envoi", sent: 999, total: 1000 })).toEqual({ key: "compose.up.envoi", percent: 99 }); // jamais 100 avant l'acquittement
    expect(rowStatus({ phase: "pret", sent: 1000, total: 1000 })).toEqual({ key: "compose.up.pret", percent: 100 });
    expect(rowStatus({ phase: "erreur", sent: 0, total: 10 })).toEqual({ key: "compose.up.erreur", percent: 0 });
  });

  it("toDraftList : fichiers et notes (D41-36), même Blob pour un même Uint8Array (pas de renvoi)", () => {
    const u = new Uint8Array([1, 2]);
    const blob = new Blob(["x"]);
    const items = [
      { id: "t", kind: "text" as const, data: new Blob(["note"]) },
      { id: "a", kind: "file" as const, data: blob },
      { id: "b", kind: "file" as const, data: u },
    ];
    const l1 = toDraftList(items), l2 = toDraftList(items);
    expect(l1.map((x) => x.id)).toEqual(["t", "a", "b"]);
    expect(l1[1]!.data).toBe(blob);
    expect(l1[2]!.data).toBe(l2[2]!.data);
    expect(l1[2]!.data.size).toBe(2);
  });
});
