// Panique du module du salon (comme le moteur des partages, audit F4) et mauvais usages des
// poignées. Le moteur ne panique sur aucune entrée : la panique est simulée comme dans
// src/engine/index.test.ts, par un appel du module qui appelle le gestionnaire de panique puis
// lève WebAssembly.RuntimeError (ce que fait une vraie panique sur wasm32).
import { describe, expect, it, vi } from "vitest";
import * as pkg from "./pkg/shhdrop_salon_wasm.js";
import { loadSalonEngine } from "./engine";

let handler: (() => void) | undefined;

vi.mock("./pkg/shhdrop_salon_wasm.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("./pkg/shhdrop_salon_wasm.js")>();
  return {
    ...m,
    sceller: vi.fn(m.sceller),
    lireEnTete: vi.fn(m.lireEnTete),
    setPanicHandler: vi.fn((f: () => void) => {
      handler = f;
      m.setPanicHandler(f);
    }),
  };
});


function errorOf(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Mémoire de l'instance en cours (initSync rend l'instance déjà faite). */
const memoire = () => new Uint8Array(pkg.initSync({ module: undefined as never }).memory.buffer);

describe("panique du module du salon (audit F4)", () => {
  it("mémoire mise à zéro aussitôt, tout appel suivant (moteur, poignées) lève salon_casse ; un nouveau chargement rend un moteur neuf", async () => {
    const S = await loadSalonEngine();
    const cles = S.clesSalon(new Uint8Array(32).fill(9), new Uint8Array(32).fill(8));
    const s = S.Salon.creer(0, new Uint8Array(16), cles, true);
    const tag = cles.tag();
    const avant = memoire();
    expect(avant.some((b) => b !== 0)).toBe(true);
    vi.mocked(pkg.sceller).mockImplementationOnce(() => {
      handler!();
      throw new WebAssembly.RuntimeError("unreachable");
    });
    expect(errorOf(() => S.sceller(cles, { volatile: false, regle: 0 }, new Uint8Array(1)))).toBe("salon_casse");
    expect(avant.every((b) => b === 0)).toBe(true);
    // Plus aucun appel n'entre dans l'instance arrêtée.
    const lus = vi.mocked(pkg.lireEnTete).mock.calls.length;
    expect(errorOf(() => S.lireEnTete(new Uint8Array(4140)))).toBe("salon_casse");
    expect(vi.mocked(pkg.lireEnTete).mock.calls.length).toBe(lus);
    expect(errorOf(() => S.nettoyerTexte("a"))).toBe("salon_casse");
    expect(errorOf(() => s.keyPackage(cles))).toBe("salon_casse");
    expect(errorOf(() => s.exporterSframe())).toBe("salon_casse");
    expect(errorOf(() => cles.tag())).toBe("salon_casse");
    expect(errorOf(() => S.clesSalon(new Uint8Array(32), new Uint8Array(32)))).toBe("salon_casse");
    // Libérer une poignée de l'instance arrêtée ne touche plus au module.
    expect(() => s.free()).not.toThrow();
    // Nouveau chargement : instance neuve, mêmes résultats ; l'ancien moteur reste cassé.
    const S2 = await loadSalonEngine();
    expect(S2).not.toBe(S);
    const c2 = S2.clesSalon(new Uint8Array(32).fill(9), new Uint8Array(32).fill(8));
    expect(c2.tag()).toEqual(tag);
    const t = S2.sceller(c2, { volatile: true, regle: 1 }, new Uint8Array([7]));
    expect(S2.ouvrir(c2, t)).toEqual({ volatile: true, regle: 1, charge: new Uint8Array([7]) });
    expect(errorOf(() => S.nettoyerTexte("a"))).toBe("salon_casse");
    expect(errorOf(() => cles.tag())).toBe("salon_casse");
    expect(await loadSalonEngine()).toBe(S2);
    c2.free();
  });
});

describe("panique signalée hors d'un appel gardé (M2)", () => {
  it("le rechargement met d'abord à zéro la mémoire de l'instance arrêtée", async () => {
    const S = await loadSalonEngine();
    const cles = S.clesSalon(new Uint8Array(32).fill(5), new Uint8Array(32).fill(6));
    const s = S.Salon.creer(0, new Uint8Array(16), cles, true);
    const avant = memoire();
    expect(avant.some((b) => b !== 0)).toBe(true);
    // Le gestionnaire de panique a tourné, mais aucune RuntimeError n'est passée par un appel gardé.
    handler!();
    expect(errorOf(() => cles.tag())).toBe("salon_casse");
    const S2 = await loadSalonEngine();
    expect(S2).not.toBe(S);
    expect(avant.every((b) => b === 0)).toBe(true);
    expect(() => s.free()).not.toThrow();
  });
});

describe("mauvais usages : codes snake_case, arguments vérifiés avant le module", () => {
  it("poignée libérée : poignee_liberee ; appel concurrent : appel_concurrent ; mauvais type : argument_invalide", async () => {
    const S = await loadSalonEngine();
    const cles = S.clesSalon(new Uint8Array(32), new Uint8Array(32));
    const s = S.Salon.creer(1, new Uint8Array(16), cles, false);
    s.free();
    s.free(); // sans effet la seconde fois
    expect(errorOf(() => s.keyPackage(cles))).toBe("poignee_liberee");
    // Erreur de la colle de wasm-bindgen pour un objet déjà emprunté (appel réentrant).
    vi.mocked(pkg.sceller).mockImplementationOnce(() => {
      throw new Error("recursive use of an object detected which would lead to unsafe aliasing in rust");
    });
    expect(errorOf(() => S.sceller(cles, { volatile: false, regle: 0 }, new Uint8Array(1)))).toBe("appel_concurrent");
    for (const f of [
      () => S.ouvrir(cles, [1, 2, 3] as never),
      () => S.ouvrir({} as never, new Uint8Array(4140)),
      () => S.sceller(cles, null as never, new Uint8Array(1)),
      () => S.sceller(cles, { volatile: false, regle: 0 }, "abc" as never),
      () => S.nettoyerTexte(3 as never),
      () => S.cleAcces("x".repeat(32) as never),
      () => S.Salon.creer("1" as never, new Uint8Array(16), cles, false),
      () => S.Salon.creer(1, new Uint8Array(16), cles, 1 as never),
      () => S.Salon.creer(1, new Uint8Array(16), {} as never, false),
      () => S.encoder(null as never),
      () => S.etatEffacement({ regle: 0, envoyeMs: 1, maintenantMs: 1, moiExpediteur: "non" as never, vuParMoiMs: null, encoreDansConversation: true, luParTous: false }),
    ])
      expect(errorOf(f)).toBe("argument_invalide");
    cles.free();
    expect(errorOf(() => cles.tag())).toBe("poignee_liberee");
    expect(errorOf(() => S.ouvrir(cles, new Uint8Array(4140)))).toBe("poignee_liberee");
  });
});
