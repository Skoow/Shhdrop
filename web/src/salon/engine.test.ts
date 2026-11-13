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
import { loadSalonEngine, type Enveloppe, type Message, type Salon, type SalonEngine } from "./engine";

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
    rotation: () => ({ k: "rotation", n: m.n, cle: id("cle") }),
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

  it("clés : K_accès_s, V_accès_s, K_preuve_s, V_preuve_s, étiquette (K_trame reste dans le module : couverte par les trames) ; K_maître_s seule redonne les mêmes clés (F4)", () => {
    expect(V.cles.length).toBeGreaterThan(0);
    for (const c of V.cles as Cas[]) {
      const a = S.cleAcces(unhex(c.k_lien));
      const s = S.clesSalon(unhex(c.k_lien), unhex(c.k_mdp));
      expect({ k: hex(a.k), v: hex(a.v), p: hex(s.kPreuve()), vp: hex(s.vPreuve()), t: hex(s.tag()) }, c.label).toEqual({ k: c.k_acces, v: c.v_acces, p: c.k_preuve, vp: c.v_preuve, t: c.tag });
      // Rotation de l'invitation : le créateur ne distribue que K_maître_s ; un membre en tire
      // les clés du salon, K_trame comprise (une trame scellée sous les unes s'ouvre sous les autres).
      expect(hex(S.cleMaitre(unhex(c.k_lien), unhex(c.k_mdp))), c.label).toBe(c.k_maitre);
      const m = S.clesDepuisMaitre(unhex(c.k_maitre));
      expect({ p: hex(m.kPreuve()), vp: hex(m.vPreuve()), t: hex(m.tag()) }, c.label).toEqual({ p: c.k_preuve, vp: c.v_preuve, t: c.tag });
      const charge = utf8(c.label);
      expect(hex(S.ouvrir(m, S.sceller(s, { volatile: false, regle: 0 }, charge)).charge), c.label).toBe(hex(charge));
      m.free();
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
    // Cohérence en-tête ↔ contenu (ce que recevoirTrame vérifie) : seul l'en-tête du contenu passe.
    expect(V.trames.coherence.length).toBe(56);
    for (const c of V.trames.coherence as Cas[]) {
      const e = c.contenu === "controle" ? null : envDe(c.contenu);
      const err = errorOf(() => S.enTeteCoherent(c.en_tete, e));
      expect(err === null ? { ok: true } : { error: err }, c.label).toEqual(c.ok ? { ok: true } : { error: c.error });
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
    expect(V.effacement.length).toBeGreaterThan(70);
    for (const c of V.effacement as Cas[]) {
      const r = S.etatEffacement({
        regle: c.regle,
        maintenantMs: c.maintenant_ms,
        vuParMoiMs: c.vu_par_moi_ms,
        effaceParServeur: c.efface_par_serveur,
      });
      expect(r, c.label).toEqual(c.etat === "rebours" ? { etat: "rebours", finMs: Number(c.fin_ms) } : { etat: c.etat });
    }
    for (const c of V.empreinte as Cas[]) expect(S.codeVerification(unhex(c.public_key)), c.label).toBe(c.code);
  });
});

describe("groupe en trames (I1, I2, M4, M5)", () => {
  it("en-tête tiré du contenu, identifiant tiré par le moteur, rescellement refusé ; l'arrivant garde les trames d'avant son Welcome et les rejoue", () => {
    const cles = S.clesSalon(new Uint8Array(32).fill(3), new Uint8Array(32).fill(4));
    const n = (s: number) => new Uint8Array(16).fill(s + 1);
    const a = S.Salon.creer(0, n(0), cles, true);
    a.remplacerAnnonces(0, [{ siege: 0, nonce: n(0) }]);
    a.annoncer(1, n(1));
    const b = S.Salon.creer(1, n(1), cles, false);
    b.remplacerAnnonces(0, [
      { siege: 0, nonce: n(0) },
      { siege: 1, nonce: n(1) },
    ]);
    let seq = 0;
    const tous = (t: Uint8Array, de: number) => {
      seq++;
      return [a.recevoirTrame(cles, t, seq, de), b.recevoirTrame(cles, t, seq, de)];
    };
    const kp = b.keyPackage(cles);
    const [evA] = tous(kp, 1);
    if (evA!.type !== "keyPackage") throw new Error(evA!.type);
    const [accepte, enAttente] = tous(a.ajouter(cles, evA.octets), 0);
    expect(enAttente!.type).toBe("ignore");
    if (accepte!.type !== "commitAccepte" || !accepte.welcome) throw new Error(accepte!.type);
    // Avant le Welcome : un message (identifiant tiré par le moteur) et un renouvellement.
    const { trame, id } = a.envoyer(cles, { heureMs: 1, regle: 2, message: { k: "texte", x: "avant le Welcome" } });
    expect(id.length).toBe(16);
    expect(S.lireEnTete(trame)).toEqual({ volatile: false, regle: 2 });
    expect(tous(trame, 0)[1]!.type).toBe("ignore");
    expect(tous(a.renouveler(cles), 0)[1]!.type).toBe("ignore");
    const [, entree] = tous(accepte.welcome, 0);
    if (entree!.type !== "entree") throw new Error(entree!.type);
    expect(entree.rejoues.map((r) => ("evenement" in r ? r.evenement.type : r.erreur))).toEqual(["ignore", "ignore", "message", "membres"]);
    const lu = entree.rejoues[2]!;
    expect("evenement" in lu && lu.evenement.type === "message" && hex(lu.evenement.enveloppe.id)).toBe(hex(id));
    expect(b.epoque()).toBe(a.epoque());
    // Volatil : bit posé ; la même charge rescellée sous un autre en-tête est refusée.
    const ecrit = b.envoyer(cles, { id: new Uint8Array(16), heureMs: 2, regle: 0, message: { k: "ecrit" } }).trame;
    expect(S.lireEnTete(ecrit)).toEqual({ volatile: true, regle: 0 });
    const faux = S.sceller(cles, { volatile: false, regle: 0 }, S.ouvrir(cles, ecrit).charge);
    seq++;
    expect(errorOf(() => a.recevoirTrame(cles, faux, seq, 1))).toBe("message_invalide");
    seq++;
    const ev = a.recevoirTrame(cles, ecrit, seq, 1);
    expect(ev.type === "message" && ev.enveloppe.message.k).toBe("ecrit");
    // Siège attesté ≠ siège de l'expéditeur (credential MLS) : refusé (le message, déchiffré pour
    // le savoir, est perdu).
    const autre = b.envoyer(cles, { id: new Uint8Array(16), heureMs: 3, regle: 0, message: { k: "texte", x: "b" } }).trame;
    seq++;
    expect(errorOf(() => a.recevoirTrame(cles, autre, seq, 0))).toBe("message_invalide");
    for (const x of [a, b, cles]) x.free();
  });
});

describe("exclusion, rotation de l'invitation, refondation (audit adverse du 13 novembre : F1 à F4)", () => {
  const n = (s: number) => new Uint8Array(16).fill(s + 1);
  const texteDe = (x: string) => ({ heureMs: 1, regle: 0 as const, message: { k: "texte" as const, x } });

  /** Créateur (siège 0) et deux membres, sous `cles` ; `tous` joue le serveur (rang, écho à tous). */
  function trio(cles: ReturnType<SalonEngine["clesSalon"]>) {
    const m = [S.Salon.creer(0, n(0), cles, true)];
    const liste = [{ siege: 0, nonce: n(0) }];
    m[0]!.remplacerAnnonces(0, liste);
    const r = { m, seq: 0, liste };
    const tous = (t: Uint8Array, de: number, c = cles) => {
      r.seq++;
      return r.m.map((x) => {
        try {
          return x.recevoirTrame(c, t, r.seq, de);
        } catch (e) {
          return { type: "erreur" as const, erreur: (e as Error).message };
        }
      });
    };
    const arrivee = (s: number, c = cles) => {
      liste.push({ siege: s, nonce: n(s) });
      for (const x of r.m) x.annoncer(s, n(s));
      const x = S.Salon.creer(s, n(s), c, false);
      x.remplacerAnnonces(0, liste);
      r.m.push(x);
      const kp = tous(x.keyPackage(c), s, c)[0]!;
      if (kp.type !== "keyPackage") throw new Error(JSON.stringify(kp));
      const ev = tous(r.m[0]!.ajouter(c, kp.octets), 0, c)[0]!;
      if (ev.type !== "commitAccepte" || !ev.welcome) throw new Error(JSON.stringify(ev));
      return tous(ev.welcome, 0, c).at(-1)!;
    };
    expect(arrivee(1).type).toBe("entree");
    expect(arrivee(2).type).toBe("entree");
    return { r, tous, arrivee };
  }

  it("envoi refusé tant qu'un Commit attend son écho ou qu'un exclu est dans l'arbre ; l'événement dit l'époque du message", () => {
    const cles = S.clesSalon(new Uint8Array(32).fill(5), new Uint8Array(32).fill(6));
    const { r } = trio(cles);
    const [c, a, x] = r.m as [Salon, Salon, Salon];
    // F2 : 0x09 pour le siège 2 ; personne n'écrit tant que sa feuille est là.
    c.marquerParti(2);
    a.marquerParti(2);
    expect(a.aRetirer()).toEqual([2]);
    expect(errorOf(() => a.envoyer(cles, texteDe("après l'exclusion")))).toBe("retrait_en_attente");
    expect(errorOf(() => c.envoyer(cles, { heureMs: 1, regle: 0, message: { k: "ecrit" } }))).toBe("retrait_en_attente");
    // Un Commit de l'exclu (serveur complice) est refusé avant fusion.
    const e0 = c.epoque()!;
    const deX = x.renouveler(cles);
    x.abandonnerCommit();
    r.seq++;
    for (const y of [c, a]) expect(errorOf(() => y.recevoirTrame(cles, deX, r.seq, 2))).toBe("commit_refuse");
    expect(c.epoque()).toBe(e0);
    // F1 : retrait en attente de son écho → aucun envoi ; après l'écho, l'envoi passe.
    const retrait = c.retirer(cles, 2);
    expect(errorOf(() => c.envoyer(cles, texteDe("trop tôt")))).toBe("commit_en_cours");
    r.seq++;
    expect(c.recevoirTrame(cles, retrait, r.seq, 0).type).toBe("commitAccepte");
    expect(a.recevoirTrame(cles, retrait, r.seq, 0)).toEqual({ type: "membres", ajoutes: [], retires: [2] });
    expect(a.aRetirer()).toEqual([]);
    const { trame } = c.envoyer(cles, texteDe("après le retrait"));
    r.seq++;
    const ev = a.recevoirTrame(cles, trame, r.seq, 0);
    expect(ev.type === "message" && ev.epoque).toBe(e0 + 1);
    expect(ev.type === "message" && ev.epoque === a.epoque()).toBe(true);
    // L'exclu (client modifié, resté à l'époque e0) ne le lit pas.
    expect(errorOf(() => x.recevoirTrame(cles, trame, r.seq, 0))).toBe("epoque_perdue");
    for (const y of [...r.m, cles]) y.free();
  });

  it("rotation : K_maître_s' seule, du créateur, à l'époque courante ; refondation ; une arrivante entre avec la nouvelle invitation, l'exclu ne lit plus rien", () => {
    const lien1 = new Uint8Array(32).fill(7);
    const lien2 = new Uint8Array(32).fill(8);
    const mdp = new Uint8Array(32).fill(9);
    const cles = S.clesSalon(lien1, mdp);
    const { r, tous, arrivee } = trio(cles);
    const codes = [r.m[0]!.empreinte(0), r.m[0]!.empreinte(1)];
    expect(codes[0]).toMatch(/^\d{5}( \d{5}){4}$/);
    const x = r.m.pop()!;
    r.liste.pop();
    for (const y of r.m) y.marquerParti(2);
    r.seq++;
    const retrait = r.m[0]!.retirer(cles, 2);
    expect(r.m[0]!.recevoirTrame(cles, retrait, r.seq, 0).type).toBe("commitAccepte");
    expect(r.m[1]!.recevoirTrame(cles, retrait, r.seq, 0).type).toBe("membres");
    // Seul le créateur envoie la rotation.
    const cle = S.cleMaitre(lien2, mdp);
    expect(errorOf(() => r.m[1]!.envoyer(cles, { heureMs: 2, regle: 0, message: { k: "rotation", n: 1, cle } }))).toBe("rotation_refusee");
    const { trame } = r.m[0]!.envoyer(cles, { heureMs: 2, regle: 0, message: { k: "rotation", n: 1, cle } });
    expect(S.lireEnTete(trame)).toEqual({ volatile: false, regle: 0 });
    const [, recue] = tous(trame, 0);
    if (recue!.type !== "message" || recue.enveloppe.message.k !== "rotation") throw new Error(JSON.stringify(recue));
    expect(recue.epoque).toBe(r.m[1]!.epoque());
    expect(recue.enveloppe.message.n).toBe(1);
    expect(hex(recue.enveloppe.message.cle)).toBe(hex(cle));
    expect(errorOf(() => x.recevoirTrame(cles, trame, r.seq, 0))).toBe("epoque_perdue");
    // Nouvelles clés depuis K_maître_s' seule : celles de la nouvelle invitation.
    const cles2 = S.clesDepuisMaitre(recue.enveloppe.message.cle);
    const invitation2 = S.clesSalon(lien2, mdp);
    expect(hex(cles2.tag())).toBe(hex(invitation2.tag()));
    recue.enveloppe.message.cle.fill(0);
    cle.fill(0);
    // Refondation : l'ancienne poignée est consommée, l'identité est gardée.
    const anciens = [...r.m];
    r.m[0] = anciens[0]!.refonder(cles2);
    r.m[1] = anciens[1]!.refonder(cles2);
    expect(errorOf(() => anciens[0]!.membres())).toBe("poignee_liberee");
    expect(errorOf(() => anciens[1]!.refonder(cles2))).toBe("poignee_liberee");
    expect(r.m[0]!.membres()).toEqual([0]);
    expect(r.m[1]!.epoque()).toBeUndefined();
    const kp = tous(r.m[1]!.keyPackage(cles2), 1, cles2)[0]!;
    if (kp.type !== "keyPackage") throw new Error(JSON.stringify(kp));
    const ev = tous(r.m[0]!.ajouter(cles2, kp.octets), 0, cles2)[0]!;
    if (ev.type !== "commitAccepte" || !ev.welcome) throw new Error(JSON.stringify(ev));
    expect(tous(ev.welcome, 0, cles2)[1]!.type).toBe("entree");
    expect([r.m[1]!.empreinte(0), r.m[1]!.empreinte(1)]).toEqual(codes);
    // Une arrivante munie de la nouvelle invitation entre (siège 3).
    expect(arrivee(3, invitation2).type).toBe("entree");
    expect(r.m.map((y) => y.membres())).toEqual([
      [0, 1, 3],
      [0, 1, 3],
      [0, 1, 3],
    ]);
    const suite = r.m[2]!.envoyer(invitation2, texteDe("après la rotation")).trame;
    expect(tous(suite, 3, cles2).map((e) => e.type)).toEqual(["message", "message", "ignore"]);
    // L'exclu, avec l'ancienne invitation, n'ouvre même plus l'enveloppe.
    expect(errorOf(() => x.recevoirTrame(cles, suite, r.seq, 3))).toBe("trame_corrompue");
    expect(errorOf(() => S.ouvrir(cles, suite))).toBe("trame_corrompue");
    for (const y of [...r.m, x, cles, cles2, invitation2]) y.free();
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
    expect(errorOf(() => S.cleMaitre(new Uint8Array(32), new Uint8Array(31)))).toBe("argument_invalide");
    expect(errorOf(() => S.clesDepuisMaitre(new Uint8Array(33)))).toBe("argument_invalide");
    expect(errorOf(() => S.clesDepuisMaitre("x" as never))).toBe("argument_invalide");
    expect(errorOf(() => S.codeVerification(new Uint8Array(31)))).toBe("argument_invalide");
    for (const siege of [256, -1, 0.5, NaN]) expect(errorOf(() => S.Salon.creer(siege, new Uint8Array(16), cles, true))).toBe("argument_invalide");
    expect(errorOf(() => S.Salon.creer(0, new Uint8Array(15), cles, true))).toBe("argument_invalide");
    for (const t of [-1, 1.5, 2 ** 53, Number.POSITIVE_INFINITY]) {
      expect(errorOf(() => S.etatEffacement({ regle: 1, maintenantMs: t, vuParMoiMs: null, effaceParServeur: false }))).toBe("argument_invalide");
      expect(errorOf(() => S.etatEffacement({ regle: 1, maintenantMs: 0, vuParMoiMs: t, effaceParServeur: false }))).toBe("argument_invalide");
    }
    expect(errorOf(() => S.etatEffacement({ regle: 1, maintenantMs: -1n, vuParMoiMs: null, effaceParServeur: false }))).toBe("argument_invalide");
    expect(errorOf(() => S.etatEffacement({ regle: 1, maintenantMs: 2n ** 64n, vuParMoiMs: null, effaceParServeur: false }))).toBe("argument_invalide");
    for (const r of [4, -1, 1.5]) expect(errorOf(() => S.etatEffacement({ regle: r as never, maintenantMs: 0, vuParMoiMs: null, effaceParServeur: false }))).toBe("argument_invalide");
    expect(errorOf(() => S.etatEffacement({ regle: 1, maintenantMs: 0, vuParMoiMs: null, effaceParServeur: 1 as never }))).toBe("argument_invalide");
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
      { ...ok, message: { k: "rotation", n: 1, cle: new Uint8Array(31) } },
      { ...ok, message: { k: "rotation", n: 2 ** 32, cle: new Uint8Array(32) } },
      { ...ok, message: { k: "rotation", n: 1.5, cle: new Uint8Array(32) } },
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
    expect(errorOf(() => s.envoyer(cles, { id: new Uint8Array(16), heureMs: 1, regle: 0, message: { k: "texte", x: "a" } }))).toBe("non_membre");
    expect(errorOf(() => s.renouveler(cles))).toBe("non_membre");
    const kp = s.keyPackage(cles);
    expect(kp.length).toBe(V.constants.TAILLE_TRAME);
    expect(S.lireEnTete(kp)).toEqual({ volatile: false, regle: 0 });
    expect(errorOf(() => s.keyPackage({} as never))).toBe("argument_invalide");
    s.free();
    expect(() => s.keyPackage(cles)).toThrow();
    cles.free();
    expect(() => cles.tag()).toThrow();
  });
});
