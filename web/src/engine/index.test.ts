// Couche du moteur pour le site (index.ts) : panique, codes propres au moteur, graines d'éléments.
// Une vraie panique n'est pas provoquable (aucun export ne panique) : elle est simulée par une
// RuntimeError et par l'appel du gestionnaire que le moteur appelle sur une panique.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as F from "./index";
import { engineMemory, loadEngine } from "./load";

afterEach(() => vi.restoreAllMocks());

const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

describe("panique du moteur (spec moteur §7)", () => {
  it("RuntimeError : paquet_corrompu ; au prochain appel, instance neuve (une fois) et gestionnaire réarmé ; anciens objets refusés", async () => {
    const e = await loadEngine();
    const el = await F.elementSealer(new Blob([new Uint8Array(10)]), 0);
    vi.spyOn(e.wasm, "shareId").mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    expect(await errorOf(F.shareId(new Uint8Array(32) as F.KLien))).toBe("paquet_corrompu");
    const reset = vi.spyOn(e.wasm, "__wbg_reset_state");
    const arm = vi.spyOn(e.wasm, "setPanicHandler");
    expect((await F.shareId(new Uint8Array(32) as F.KLien)).length).toBe(16);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(arm).toHaveBeenCalledTimes(1);
    await F.shareId(new Uint8Array(32) as F.KLien);
    expect(reset).toHaveBeenCalledTimes(1);
    // Scelleur de l'instance remplacée : refusé (objet périmé), jamais un autre message.
    expect(await errorOf(el.piece(0))).toBe("paquet_corrompu");
    // Revue Task 11 : les numéros repartent à 1 dans l'instance neuve. Un scelleur d'avant la
    // panique, de même numéro qu'un neuf, n'entre jamais dans un manifeste (sa graine est perdue :
    // le manifeste désignerait celle de l'autre élément, et le partage serait illisible).
    const fresh = await F.elementSealer(new Blob([new Uint8Array(10)]), 0);
    expect(fresh.id).toBe(el.id);
    const entry = (sealer: F.ElementSealer) => [{ kind: "file" as const, name: "a", mime: "x/y", size: 10, first: 0, sealer }];
    expect(await errorOf(F.sealFinal(entry(el), await F.contentKeys(await F.newSeed()), {}))).toBe("paquet_corrompu");
    const fin = await F.sealFinal(entry(fresh), await F.contentKeys(await F.newSeed()), {});
    expect(fin.bucket).toBe(16);
  });

  it("sealFinal : taille ou place différente de celles du scelleur refusée (entree_invalide)", async () => {
    const el = await F.elementSealer(new Blob([new Uint8Array(10)]), 0);
    const keys = await F.contentKeys(await F.newSeed());
    for (const [size, first] of [[9, 0], [11, 0], [10, 1]] as const)
      expect(await errorOf(F.sealFinal([{ kind: "file", name: "a", mime: "x/y", size, first, sealer: el }], keys, {})), `${size}/${first}`).toBe("entree_invalide");
    expect((await F.sealFinal([{ kind: "file", name: "a", mime: "x/y", size: 10, first: 0, sealer: el }], keys, {})).bucket).toBe(16);
  });

  it("panique pendant une opération asynchrone : les opérations en cours rejetées par paquet_corrompu, plus aucun appel dans l'instance arrêtée", async () => {
    const e = await loadEngine();
    // Gestionnaire du moteur, capturé au réarmement qui suit une panique simulée.
    vi.spyOn(e.wasm, "shareId").mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    await errorOf(F.shareId(new Uint8Array(32) as F.KLien));
    let onPanic: (() => void) | undefined;
    const arm = vi.spyOn(e.wasm, "setPanicHandler").mockImplementation((f: Function) => void (onPanic = f as () => void));
    const el = await F.elementSealer(new Blob([new Uint8Array(10)]), 0);
    expect(arm).toHaveBeenCalledTimes(1);
    arm.mockRestore();
    // Pièce suspendue chez le fournisseur, puis panique (ailleurs, dans le moteur).
    let reached!: () => void;
    const inProvider = new Promise<void>((r) => (reached = r));
    const p = (await loadEngine()).provider;
    vi.spyOn(p, "aesSealBatch").mockImplementation(() => (reached(), new Promise(() => undefined)));
    const piece = errorOf(el.piece(0));
    await inProvider;
    onPanic!();
    expect(await piece).toBe("paquet_corrompu");
    // Le prochain appel refait une instance et marche.
    vi.restoreAllMocks();
    const reset = vi.spyOn(e.wasm, "__wbg_reset_state");
    expect((await F.deriveAccess(new Uint8Array(32).fill(1) as F.KLien)).kAcces.length).toBe(32);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("note vérifiée par le moteur au scellement (audit M6)", () => {
  it("UTF-8 strict et TEXT_MAX points de code, comme le lecteur ; un fichier n'est pas vérifié", async () => {
    const seal = async (raw: Uint8Array, kind: "text" | "file" = "text") => {
      const el = await F.elementSealer(new Blob([raw as Uint8Array<ArrayBuffer>]), 0);
      for (const j of el.pieces.keys()) await el.piece(j);
      return errorOf(F.sealFinal([{ kind, name: "n", mime: "text/plain", size: raw.length, first: 0, sealer: el }], await F.contentKeys(await F.newSeed()), {}));
    };
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(await seal(new Uint8Array())).toBe(null);
    expect(await seal(enc("a".repeat(F.TEXT_MAX)))).toBe(null);
    expect(await seal(enc("😀".repeat(F.TEXT_MAX)))).toBe(null); // 400 000 octets
    expect(await seal(enc("a".repeat(F.TEXT_MAX + 1)))).toBe("texte_trop_long");
    expect(await seal(new Uint8Array([0x61, 0xff]))).toBe("texte_invalide");
    expect(await seal(new Uint8Array([0xed, 0xa0, 0x80]))).toBe("texte_invalide");
    expect(await seal(new Uint8Array([0x61, 0xff]), "file")).toBe(null);
    // Pièce jamais chiffrée : le moteur n'a pas vu le texte.
    const el = await F.elementSealer(new Blob([enc("salut")]), 0);
    expect(await errorOf(F.sealFinal([{ kind: "text", name: "n", mime: "text/plain", size: 5, first: 0, sealer: el }], await F.contentKeys(await F.newSeed()), {}))).toBe("texte_invalide");
  });
});

describe("mémoire après une panique (audit F4)", () => {
  it("la mémoire de l'instance arrêtée est mise à zéro avant l'instance neuve", async () => {
    const e = await loadEngine();
    await F.shareId(new Uint8Array(32).fill(9) as F.KLien);
    const old = engineMemory(e);
    const bytes = new Uint8Array(old.buffer);
    bytes.fill(0xa5, bytes.length - 64); // témoin
    expect(bytes.some((b) => b !== 0)).toBe(true);
    vi.spyOn(e.wasm, "shareId").mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    expect(await errorOf(F.shareId(new Uint8Array(32) as F.KLien))).toBe("paquet_corrompu");
    vi.restoreAllMocks();
    expect((await F.shareId(new Uint8Array(32) as F.KLien)).length).toBe(16);
    expect(engineMemory(e)).not.toBe(old);
    expect(new Uint8Array(old.buffer).every((b) => b === 0)).toBe(true);
  });
});

describe("codes propres au moteur à l'ouverture", () => {
  it("chiffrement_echec (fournisseur) à l'ouverture : paquet_corrompu ; un rejet de fetchSegment reste tel quel", async () => {
    // Petit partage valide (une note).
    const el = await F.elementSealer(new Blob([new TextEncoder().encode("salut")]), 0);
    const piece = await el.piece(0);
    const r = await F.newSeed();
    const keys = await F.contentKeys(r);
    const fin = await F.sealFinal([{ kind: "text", name: "n", mime: "text/plain", size: 5, first: 0, sealer: el }], keys, {});
    const seg = new Uint8Array(F.segmentSize(fin.bucket, 0));
    seg.set(piece, 0);
    seg.set(fin.header, 0);
    seg.set(fin.tail, seg.length - fin.tail.length);
    const kLien = new Uint8Array(32).fill(3) as F.KLien;
    const kMdp = new Uint8Array(32).fill(4) as F.KMdp;
    const ak = await F.accessKeys(kLien, kMdp);
    const id = await F.shareId(kLien);
    const env = await F.seal(ak.kEnv, r, id, fin.header);
    const opened = await F.contentKeysChecked(await F.open(ak.kEnv, env, id, fin.header), keys.engagement);
    // Rejet de fetchSegment : le même objet.
    const net = new Error("reseau");
    expect(await F.openStream(async () => Promise.reject(net), fin.bucket, opened).catch((x: unknown) => x)).toBe(net);
    // Le fournisseur refuse d'importer les clés des éléments : code du moteur → paquet_corrompu.
    const p = (await loadEngine()).provider;
    vi.spyOn(p, "aesImport").mockRejectedValue(new Error("import refusé"));
    expect(await errorOf(F.openStream(async () => new Uint8Array(seg), fin.bucket, opened))).toBe("paquet_corrompu");
    vi.restoreAllMocks();
    const rd = await F.openStream(async () => new Uint8Array(seg), fin.bucket, opened);
    expect(new TextDecoder().decode(await rd.item(0))).toBe("salut");
    expect(rd.manifest.items.map((x) => "k" in x)).toEqual([false]); // graine jamais rendue
  });
});

describe("graine des éléments : jamais en JavaScript", () => {
  it("le scelleur ne rend pas sa graine ; oublié (forget), il n'entre plus dans un manifeste", async () => {
    const el = await F.elementSealer(new Blob([new Uint8Array(3)]), 0);
    expect(Object.keys(el).sort()).toEqual(["forget", "id", "piece", "pieces"]);
    el.forget();
    el.forget(); // sans effet la seconde fois
    expect(await errorOf(el.piece(0))).toBe("cle_oubliee");
    const keys = await F.contentKeys(await F.newSeed());
    expect(await errorOf(F.sealFinal([{ kind: "file", name: "f", mime: "m", size: 3, first: 0, sealer: el }], keys, {}))).toBe("entree_invalide");
  });
});
