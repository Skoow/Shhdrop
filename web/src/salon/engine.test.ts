// Le module WebAssembly du salon (engine/salon-wasm) redonne TOUS les vecteurs de
// engine/vectors/salon-v3.json, comme le moteur natif (engine/salon/tests/vecteurs.rs) : le site et
// les apps donnent les mêmes résultats. Plus : règles des frontières (nonce tiré par le module,
// arguments refusés, poignées). Le groupe MLS (aléa interne) est éprouvé dans Chromium, avec le
// test croisé natif ↔ WebAssembly : web/ui-e2e/salon-moteur.spec.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSalonEngine, type Enveloppe, type Message, type SalonEngine } from "./engine";

const here = dirname(fileURLToPath(import.meta.url));
/** Entiers au-delà de 2^53 − 1 (instants de saturation de `effacement`) lus exactement, en bigint. */
const V = JSON.parse(readFileSync(join(here, "../../../engine/vectors/salon-v3.json"), "utf8"), (_k, v, ctx?: { source?: string }) =>
  typeof v === "number" && !Number.isSafeInteger(v) && ctx?.source && /^\d+$/.test(ctx.source) ? BigInt(ctx.source) : v,
);

type Spec = { hex?: string; utf8?: string; repeat?: { unit: string; n: number; then?: string }; xorshift32?: { seed: number; len: number } };
type Cas = Record<string, any>;

const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Octets décrits par le fichier (README des vecteurs). */
function bytes(s: Spec): Uint8Array {
  if (s.hex !== undefined) return unhex(s.hex);
  if (s.utf8 !== undefined) return utf8(s.utf8);
  if (s.repeat) {
    const unit = unhex(s.repeat.unit);
    const then = unhex(s.repeat.then ?? "");
    const out = new Uint8Array(unit.length * s.repeat.n + then.length);
    for (let i = 0; i < s.repeat.n; i++) out.set(unit, i * unit.length);
    out.set(then, unit.length * s.repeat.n);
    return out;
  }
  const { seed, len } = s.xorshift32!;
  const out = new Uint8Array(len + 4);
  let x = seed >>> 0;
  for (let i = 0; i < len; i += 4) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    new DataView(out.buffer).setUint32(i, x, true);
  }
  return out.slice(0, len);
}

const text = (s: Spec) => new TextDecoder("utf-8", { fatal: true }).decode(bytes(s));

function errorOf(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Sortie texte comme le fichier : hex jusqu'à 256 octets, sinon longueur et empreinte. */
function texteOut(s: string) {
  const b = utf8(s);
  return b.length <= 256 ? { out_hex: hex(b) } : { out_len: b.length, out_sha256: sha(b) };
}

/** Enveloppe du fichier (`id`, `t`, `e`, champs en hex, noms du fil) → objet du module. */
function envDe(v: Cas): Enveloppe {
  const m = v.message;
  const id = (k: string) => unhex(m[k]);
  const messages: Record<string, () => Message> = {
    texte: () => ({ k: "texte", x: m.x }),
    piece: () => ({ k: "piece", r: id("r"), piece: id("piece"), palier: m.palier, nom: m.nom, mime: m.mime, taille: Number(m.taille), sorte: m.sorte, dureeMs: m.duree_ms }),
    reaction: () => ({ k: "reaction", cible: id("cible"), emoji: m.emoji }),
    reponse: () => ({ k: "reponse", cible: id("cible"), x: m.x }),
    modif: () => ({ k: "modif", cible: id("cible"), x: m.x }),
    retrait: () => ({ k: "retrait", cible: id("cible") }),
    ecrit: () => ({ k: "ecrit" }),
    recu: () => ({ k: "recu", ids: m.ids.map(unhex) }),
    vu: () => ({ k: "vu", ids: m.ids.map(unhex) }),
    regle: () => ({ k: "regle", regle: m.regle }),
    profil: () => ({ k: "profil", pseudo: m.pseudo, couleur: m.couleur, avatar: m.avatar && { r: unhex(m.avatar.r), piece: unhex(m.avatar.piece), palier: m.avatar.palier } }),
    depart: () => ({ k: "depart" }),
    inconnu: () => ({ k: "inconnu", sorte: m.sorte }),
  };
  return { id: unhex(v.id), heureMs: Number(v.t), regle: v.e, message: messages[m.k]!() };
}

/** Objet du module → enveloppe du fichier (inverse de envDe). */
function envVers(e: Enveloppe): Cas {
  const m = e.message as Record<string, any>;
  const out: Cas = {};
  for (const [k, v] of Object.entries(m)) {
    if (v instanceof Uint8Array) out[k] = hex(v);
    else if (k === "ids") out[k] = (v as Uint8Array[]).map(hex);
    else if (k === "dureeMs") out.duree_ms = v;
    else if (k === "avatar") out[k] = v && { r: hex(v.r), piece: hex(v.piece), palier: v.palier };
    else out[k] = v;
  }
  return { e: e.regle, id: hex(e.id), message: out, t: e.heureMs };
}

const tri = (o: unknown): unknown =>
  Array.isArray(o) ? o.map(tri) : o && typeof o === "object" && !(o instanceof Uint8Array) ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, tri(v)])) : o;

let S: SalonEngine;
beforeAll(async () => {
  S = await loadSalonEngine();
});

describe("vecteurs salon-v3.json rejoués par le module WebAssembly", () => {
  it("constantes", () => {
    const c = S.constantes();
    expect(c).toEqual({ TAILLE_TRAME: V.constants.TAILLE_TRAME, TAILLE_O: V.constants.TAILLE_O, MAX_CHARGE: V.constants.MAX_CHARGE, JSON_MAX: V.constants.JSON_MAX });
  });

  it("clés : K_accès_s, V_accès_s, K_preuve_s, V_preuve_s, étiquette (K_trame reste dans le module : couverte par les trames)", () => {
    expect(V.cles.length).toBeGreaterThan(0);
    for (const c of V.cles as Cas[]) {
      const a = S.cleAcces(unhex(c.k_lien));
      const s = S.clesSalon(unhex(c.k_lien), unhex(c.k_mdp));
      expect({ k: hex(a.k), v: hex(a.v), p: hex(s.kPreuve()), vp: hex(s.vPreuve()), t: hex(s.tag()) }, c.label).toEqual({ k: c.k_acces, v: c.v_acces, p: c.k_preuve, vp: c.v_preuve, t: c.tag });
      s.free();
    }
  });

  it("trames : chaque trame du fichier s'ouvre et donne son en-tête ; le module scelle avec son propre nonce, même charge rendue", () => {
    const seals = V.trames.seal as Cas[];
    for (const c of seals) {
      const cles = S.clesSalon(unhex(c.k_lien), unhex(c.k_mdp));
      const charge = bytes(c.charge);
      if (c.seal.error) {
        expect(errorOf(() => S.sceller(cles, c.en_tete, charge)), c.label).toBe(c.seal.error);
      } else {
        const t = unhex(c.seal.trame_hex);
        expect(S.lireEnTete(t), c.label).toEqual(c.read_header);
        const o = S.ouvrir(cles, t);
        expect({ volatile: o.volatile, regle: o.regle, charge_hex: hex(o.charge) }, c.label).toEqual(c.open);
        const mienne = S.sceller(cles, c.en_tete, charge);
        expect(mienne.length).toBe(V.constants.TAILLE_TRAME);
        // Nonce tiré par le module (getrandom → crypto.getRandomValues) : une autre trame.
        expect(hex(mienne.subarray(5, 29))).not.toBe(c.nonce);
        expect(hex(S.ouvrir(cles, mienne).charge)).toBe(hex(charge));
      }
      cles.free();
    }
    for (const c of V.trames.reject as Cas[]) {
      const from = seals.find((s) => s.label === c.from)!;
      let t = unhex(from.seal.trame_hex);
      const lien = c.k_lien;
      let mdp = c.k_mdp;
      const mu = c.mutation;
      if (mu.op === "xor") t[mu.at] ^= mu.mask;
      else if (mu.op === "truncate") t = t.slice(0, mu.len);
      else if (mu.op === "append") t = new Uint8Array([...t, ...unhex(mu.hex)]);
      else if (mu.op === "autre_mdp") mdp = mu.k_mdp;
      else throw new Error(`mutation ${mu.op}`);
      const cles = S.clesSalon(unhex(lien), unhex(mdp));
      const lu = errorOf(() => S.lireEnTete(t));
      expect(lu === null ? S.lireEnTete(t) : { error: lu }, c.label).toEqual(c.read_header);
      expect({ error: errorOf(() => S.ouvrir(cles, t)) }, c.label).toEqual(c.open);
      cles.free();
    }
  });

  it("messages : encodage octet pour octet et relecture ; décodage strict", () => {
    for (const c of V.messages.encode as Cas[]) {
      const e = envDe(c.envelope);
      if (c.error) {
        expect(errorOf(() => S.encoder(e)), c.label).toBe(c.error);
        continue;
      }
      const b = S.encoder(e);
      expect({ encoded_hex: hex(b), len: b.length }, c.label).toEqual({ encoded_hex: c.encoded_hex, len: c.len });
      expect(tri(envVers(S.decoder(b))), c.label).toEqual(tri(c.envelope));
    }
    for (const c of V.messages.decode as Cas[]) {
      const b = bytes(c.bytes);
      if (c.error) expect(errorOf(() => S.decoder(b)), c.label).toBe(c.error);
      else expect(tri(envVers(S.decoder(b))), c.label).toEqual(tri(c.envelope));
    }
  });

  it("texte (nettoyerTexte), pseudonyme (verifierPseudo, cleUnicite), effacement, codes de vérification", () => {
    for (const c of V.texte as Cas[]) {
      const s = text(c.in);
      const err = errorOf(() => S.nettoyerTexte(s));
      expect(err === null ? texteOut(S.nettoyerTexte(s)) : { error: err }, c.label).toEqual(c.error ? { error: c.error } : { ...(c.out_hex !== undefined ? { out_hex: c.out_hex } : { out_len: c.out_len, out_sha256: c.out_sha256 }) });
    }
    for (const c of V.pseudo as Cas[]) {
      const s = text(c.in);
      const err = errorOf(() => S.verifierPseudo(s));
      if (c.error) expect(err, c.label).toBe(c.error);
      else expect({ ...texteOut(S.verifierPseudo(s)), key_hex: hex(utf8(S.cleUnicite(S.verifierPseudo(s)))) }, c.label).toEqual({ out_hex: c.out_hex, key_hex: c.key_hex });
    }
    expect(V.effacement.length).toBeGreaterThan(100);
    for (const c of V.effacement as Cas[]) {
      const r = S.etatEffacement({
        regle: c.regle,
        envoyeMs: c.envoye_ms,
        maintenantMs: c.maintenant_ms,
        moiExpediteur: c.moi_expediteur,
        vuParMoiMs: c.vu_par_moi_ms,
        encoreDansConversation: c.encore_dans_conversation,
        luParTous: c.lu_par_tous,
      });
      expect(r, c.label).toEqual(c.etat === "rebours" ? { etat: "rebours", finMs: Number(c.fin_ms) } : { etat: c.etat });
    }
    for (const c of V.empreinte as Cas[]) expect(S.codeVerification(unhex(c.public_key)), c.label).toBe(c.code);
  });
});

describe("frontières du module", () => {
  it("erreurs : message snake_case du moteur ; arguments hors bornes refusés (argument_invalide), jamais tronqués", () => {
    const cles = S.clesSalon(new Uint8Array(32), new Uint8Array(32));
    expect(errorOf(() => S.ouvrir(cles, new Uint8Array(4139)))).toBe("trame_corrompue");
    expect(errorOf(() => S.lireEnTete(new Uint8Array(4140)))).toBe("en_tete_invalide");
    expect(errorOf(() => S.sceller(cles, { volatile: false, regle: 0 }, new Uint8Array(4094)))).toBe("trop_grand");
    expect(errorOf(() => S.nettoyerTexte(" "))).toBe("texte_invalide");
    expect(errorOf(() => S.verifierPseudo("A"))).toBe("pseudo_invalide");
    for (const regle of [4, -1, 1.5, NaN, "1"]) expect(errorOf(() => S.sceller(cles, { volatile: false, regle } as never, new Uint8Array(1)))).toBe("argument_invalide");
    expect(errorOf(() => S.sceller(cles, { volatile: 1, regle: 0 } as never, new Uint8Array(1)))).toBe("argument_invalide");
    expect(errorOf(() => S.clesSalon(new Uint8Array(31), new Uint8Array(32)))).toBe("argument_invalide");
    expect(errorOf(() => S.cleAcces(new Uint8Array(33)))).toBe("argument_invalide");
    expect(errorOf(() => S.codeVerification(new Uint8Array(31)))).toBe("argument_invalide");
    for (const siege of [256, -1, 0.5, NaN]) expect(errorOf(() => S.Salon.creer(siege, new Uint8Array(16), cles, true))).toBe("argument_invalide");
    expect(errorOf(() => S.Salon.creer(0, new Uint8Array(15), cles, true))).toBe("argument_invalide");
    for (const t of [-1, 1.5, 2 ** 53, Number.POSITIVE_INFINITY]) expect(errorOf(() => S.etatEffacement({ regle: 0, envoyeMs: t, maintenantMs: 0, moiExpediteur: false, vuParMoiMs: null, encoreDansConversation: true, luParTous: false }))).toBe("argument_invalide");
    expect(errorOf(() => S.etatEffacement({ regle: 0, envoyeMs: -1n, maintenantMs: 0, moiExpediteur: false, vuParMoiMs: null, encoreDansConversation: true, luParTous: false }))).toBe("argument_invalide");
    expect(errorOf(() => S.etatEffacement({ regle: 0, envoyeMs: 2n ** 64n, maintenantMs: 0, moiExpediteur: false, vuParMoiMs: null, encoreDansConversation: true, luParTous: false }))).toBe("argument_invalide");
    // Enveloppe mal formée côté JavaScript : refus du moteur, comme un JSON invalide.
    const ok: Enveloppe = { id: new Uint8Array(16), heureMs: 1, regle: 0, message: { k: "texte", x: "a" } };
    expect(S.decoder(S.encoder(ok))).toEqual(ok);
    for (const bad of [
      { ...ok, id: new Uint8Array(15) },
      { ...ok, heureMs: 1.5 },
      { ...ok, heureMs: 2 ** 53 },
      { ...ok, regle: 4 },
      { ...ok, message: { k: "texte" } },
      { ...ok, message: { k: "texte", x: 3 } },
      { ...ok, message: { k: "inconnu", sorte: "appel" } },
      { ...ok, message: { k: "vu", ids: [] } },
      { ...ok, message: { k: "profil", pseudo: "Alice", couleur: 1.5, avatar: null } },
      { ...ok, message: { k: "profil", pseudo: "Alice", couleur: 256 + 1, avatar: null } },
    ])
      expect(errorOf(() => S.encoder(bad as never)), JSON.stringify(bad)).toBe("message_invalide");
    expect(S.estVolatile({ k: "ecrit" })).toBe(true);
    expect(S.estVolatile({ k: "texte", x: "a" })).toBe(false);
    expect(S.nettoyerNom("dossier/a.bin")).not.toBe("dossier/a.bin");
    cles.free();
  });

  it("poignées : une poignée libérée est refusée ; hors du groupe, rien n'est exporté", () => {
    const cles = S.clesSalon(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
    const s = S.Salon.creer(1, new Uint8Array(16), cles, false);
    expect(s.epoque()).toBeUndefined();
    expect(s.membres()).toEqual([]);
    expect(errorOf(() => s.exporterSframe())).toBe("non_membre");
    expect(errorOf(() => s.chiffrer({ id: new Uint8Array(16), heureMs: 1, regle: 0, message: { k: "texte", x: "a" } }))).toBe("non_membre");
    expect(s.keyPackage().length).toBeGreaterThan(100);
    s.free();
    expect(() => s.keyPackage()).toThrow();
    cles.free();
    expect(() => cles.tag()).toThrow();
  });
});
