import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { receiveLock, sendLock } from "./lock";

describe("cadenas d'état (D41-25, UI5) : jamais vert avant l'événement réel, présent sur chaque ligne", () => {
  it("envoi : gris pendant l'attente, le chiffrement et l'envoi ; vert seulement à « pret » (tous les segments confirmés) ; rouge en erreur", () => {
    expect(sendLock(null)).toEqual({ tone: "wait", key: "compose.up.attente", n: 0 });
    expect(sendLock({ key: "compose.up.attente", percent: 0 })).toEqual({ tone: "wait", key: "compose.up.attente", n: 0 });
    expect(sendLock({ key: "compose.up.chiffrement", percent: 0 })).toEqual({ tone: "wait", key: "compose.up.chiffrement", n: 0 });
    // 99 % : un segment n'est pas encore acquitté par le serveur → pas vert.
    expect(sendLock({ key: "compose.up.envoi", percent: 99 })).toEqual({ tone: "wait", key: "compose.up.envoi", n: 99 });
    expect(sendLock({ key: "compose.up.pret", percent: 100 })).toEqual({ tone: "ok", key: "compose.up.pret", n: 100 });
    expect(sendLock({ key: "compose.up.erreur", percent: 0 })).toEqual({ tone: "error", key: "compose.up.erreur", n: 0 });
  });

  it("réception : ouvert vert seulement après lecture entière vérifiée (fichier « done ») ou manifeste authentifié (texte) ; rouge en échec ; fermé gris avant", () => {
    for (const s of ["idle", "queued", "downloading", "paused"] as const) expect(receiveLock("file", s)).toEqual({ tone: "wait", key: "lock.recv.wait" });
    expect(receiveLock("file", "done")).toEqual({ tone: "open", key: "lock.recv.ok" });
    expect(receiveLock("file", "failed")).toEqual({ tone: "error", key: "lock.recv.error" });
    // Un texte vient du manifeste, déchiffré et authentifié (GCM) à l'ouverture.
    expect(receiveLock("text", "idle")).toEqual({ tone: "open", key: "lock.recv.ok" });
  });

  it("textes en français et en anglais", () => {
    expect(fr["compose.up.pret"]).toBe("Chiffré et envoyé");
    expect(fr["lock.recv.ok"]).toBe("Déchiffré et vérifié");
    for (const k of ["lock.recv.ok", "lock.recv.error", "lock.recv.wait"] as const) expect(en[k]).toBeTruthy();
  });
});
