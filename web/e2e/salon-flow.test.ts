// Salon (plan C-2, Task 16) : conversation de bout en bout entre trois clients, avec le vrai
// moteur du salon (module wasm, sous Node) contre le vrai binaire Go. Un échec désigne un écart
// entre le serveur et le moteur (tailles, ordre, annonces, Welcome, KeyPackages) : il se corrige
// du côté qui contredit la spécification et le « Protocole » du plan C-2, jamais dans ce test.
// Les parcours dans de vrais navigateurs restent pour C-3.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Enveloppe, EnveloppeEnvoi, Evenement } from "../src/salon/engine";
import { ClientSalon, HttpError, alea, b64u, egal, tailleConteneur, u64, type Recu } from "./salon-client";
import { startServer, type TestServer } from "./server";

const MIB = 1024 * 1024;

type Envoi = EnveloppeEnvoi & { id: Uint8Array };

const texte = (x: string, regle: 0 | 1 = 0): Envoi => ({ id: alea(16), heureMs: Date.now(), regle, message: { k: "texte", x } });
const ecrit = (): Envoi => ({ id: alea(16), heureMs: Date.now(), regle: 0, message: { k: "ecrit" } });

/** Événement « message » de cet identifiant. */
const message = (id: Uint8Array) => (r: Recu) => r.k === "evt" && r.evenement.type === "message" && egal(r.evenement.enveloppe.id, id);
const enveloppe = (r: Recu): { deSiege: number; enveloppe: Enveloppe } => (r as { evenement: Extract<Evenement, { type: "message" }> }).evenement;
const enr = (type: number, seq?: number) => (r: Recu) => r.k === "enr" && r.enr.type === type && (seq === undefined || r.enr.seq === seq);
const efface = (cible: number) => (r: Recu) => r.k === "enr" && r.enr.type === 0x0e && u64(r.enr.octets, 9) === cible;

/** Ce client a lu ce message, envoyé par `siege`, enveloppe identique à l'envoi. */
async function lit(c: ClientSalon, e: Envoi, siege: number): Promise<number> {
  const r = await c.attendre(message(e.id));
  const m = enveloppe(r);
  expect(m.deSiege).toBe(siege);
  expect(m.enveloppe).toEqual(e);
  return (r as { seq: number }).seq;
}

describe("salon : trois clients, vrai moteur", () => {
  // Étapes dans l'ordre du cahier des charges (Task 16), en `it` successifs qui partagent l'état
  // ci-dessous : Vitest les exécute dans l'ordre d'écriture, l'un après l'autre (aucun
  // `concurrent`) ; un échec fait échouer les étapes qui en dépendent, nommées.
  let srv: TestServer;
  const clients: ClientSalon[] = [];
  let a: ClientSalon, b: ClientSalon, c: ClientSalon;
  let tous: ClientSalon[];
  let lien: Uint8Array, mdp: string, sGestion: Uint8Array;
  let seqInst: number;

  beforeAll(async () => {
    srv = await startServer({ salons: true });
  });
  afterAll(async () => {
    for (const x of clients) await x.fermer().catch(() => undefined);
    await srv?.dispose();
  });

  it("entrées : le créateur (siège 0) ajoute chaque invité dès son KeyPackage", async () => {
    const cr = await ClientSalon.creer(srv, { maxMembers: 4 });
    ({ lien, mdp, sGestion } = cr);
    a = cr.createur;
    clients.push(a);
    expect(a.siege).toBe(0);
    b = await ClientSalon.rejoindre(srv, lien, mdp);
    clients.push(b);
    expect(b.siege).toBe(1);
    await Promise.all([a.attendreMembres([0, 1]), b.attendreMembres([0, 1])]);
    c = await ClientSalon.rejoindre(srv, lien, mdp);
    clients.push(c);
    expect(c.siege).toBe(2);
    tous = [a, b, c];
    await Promise.all(tous.map((x) => x.attendreMembres([0, 1, 2])));
  });

  it("chacun lit les textes des deux autres, enveloppe identique", async () => {
    const textes = [texte("Bonjour de A é😀"), texte("Bonjour de B"), texte("Bonjour de C")];
    for (const [i, x] of tous.entries()) await x.envoyer(textes[i]!);
    for (const [i, x] of tous.entries()) {
      for (const [j, y] of tous.entries()) if (i !== j) await lit(y, textes[i]!, i);
    }
  });

  it("« écrit » (volatil) : marqué volatil dans l'en-tête, reçu en direct", async () => {
    const e1 = ecrit();
    const seqEcrit = await a.envoyer(e1);
    expect(a.eng.lireEnTete((a.recus.find(enr(0x01, seqEcrit)) as { enr: { octets: Uint8Array } }).enr.octets.slice(18)).volatile).toBe(true);
    await lit(b, e1, 0);
    await lit(c, e1, 0);
  });

  it("« instantané » lu (0x05) par les deux autres → 0x0E chez les trois", async () => {
    const inst = texte("Lu une fois", 1);
    seqInst = await a.envoyer(inst);
    for (const x of [b, c]) {
      expect(await lit(x, inst, 0)).toBe(seqInst);
      x.lu(seqInst);
    }
    await Promise.all(tous.map((x) => x.attendre(efface(seqInst))));
  });

  it("coupure de C pendant 20 messages, un retrait et un « écrit » : rattrapage exact", async () => {
    await c.couper();
    const avantCoupure = c.dernierSeq;
    const retire = texte("Message retiré");
    const seqRetire = await a.envoyer(retire);
    await lit(b, retire, 0);
    a.retirer(seqRetire);
    await a.ping(); // 0x02 traité avant le 0x08
    // « écrit » envoyé pendant la coupure : relayé en direct (B le lit), jamais servi au
    // rattrapage de C.
    const e2 = ecrit();
    const seqEcrit2 = await a.envoyer(e2);
    await lit(b, e2, 0);
    const vingt: { e: Envoi; siege: number; seq: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const [x, s] = i % 2 === 0 ? [a, 0] : [b, 1];
      const e = texte(`message ${i + 1} sur 20`);
      vingt.push({ e, siege: s, seq: await x.envoyer(e) });
    }
    await c.reconnecter();
    for (const v of vingt) expect(await lit(c, v.e, v.siege)).toBe(v.seq);
    const apres = c.recus.filter((r) => r.k === "evt" && r.seq > avantCoupure && r.evenement.type === "message").map((r) => (r as { seq: number }).seq);
    expect(apres).toEqual(vingt.map((v) => v.seq)); // tous, dans l'ordre, rien d'autre
    // Ce qui prouve l'exclusion du rattrapage : ni le retrait, ni l'« écrit » e2 (ni son
    // enregistrement 0x01, ni son message) n'ont atteint C.
    expect(c.recus.some(enr(0x01, seqRetire))).toBe(false);
    expect(c.recus.some(enr(0x01, seqEcrit2))).toBe(false);
    expect(c.recus.some(message(e2.id))).toBe(false);
    // Accueil de la reconnexion : 0x0E renvoyé pour l'instantané (rang dans (émission, depuis]),
    // jamais pour le retrait.
    expect(c.effaces.filter((s) => s === seqInst).length).toBe(2);
    expect(c.effaces).not.toContain(seqRetire);

    // Retrait après la reconnexion, tel que le moteur le porte : l'auteur (A) retire sa trame
    // au serveur (0x02) et envoie le message chiffré `retrait` (cible = id du message). B et C
    // le lisent, signé du siège de l'auteur. Le moteur ne tient pas le fil : remplacer le
    // message par « Message retiré » revient à l'interface (C-3).
    const cible = vingt[0]!;
    a.retirer(cible.seq);
    await a.ping();
    const retrait: Envoi = { id: alea(16), heureMs: Date.now(), regle: 0, message: { k: "retrait", cible: cible.e.id } };
    const seqRetrait = await a.envoyer(retrait);
    for (const x of [b, c]) {
      expect(await lit(x, retrait, 0)).toBe(seqRetrait);
      const m = enveloppe(await x.attendre(message(retrait.id))).enveloppe.message;
      expect(m.k === "retrait" && egal(m.cible, cible.e.id)).toBe(true);
    }
  });

  it("reprise de C (nouvelle identité) : le créateur l'ajoute de nouveau", async () => {
    const ancienNonce = c.nonce;
    const repere = a.dernierSeq;
    await c.reprendre();
    expect(egal(c.nonce, ancienNonce)).toBe(false);
    await c.attendre((r) => r.k === "evt" && r.seq > repere && r.evenement.type === "entree");
    await b.attendre((r) => r.k === "evt" && r.seq > repere && r.evenement.type === "membres" && r.evenement.ajoutes.includes(2));
    await Promise.all(tous.map((x) => x.attendreMembres([0, 1, 2])));
    const suite = [texte("Après la reprise, de A"), texte("Après la reprise, de B")];
    await a.envoyer(suite[0]!);
    await b.envoyer(suite[1]!);
    await lit(c, suite[0]!, 0);
    await lit(c, suite[1]!, 1);
  });

  it("pièce de 5 Mio : envoyée, liée à sa trame, relue à l'identique, effacée au retrait", async () => {
    const bucket = 160; // 5 Mio de contenu : palier 160 (159 × 64 Kio au plus)
    const conteneur = new Uint8Array(tailleConteneur(bucket));
    for (let o = 0; o < conteneur.length; o += 65536) conteneur.set(alea(Math.min(65536, conteneur.length - o)), o);
    const piece = await b.envoyerPiece(bucket, conteneur);
    const pe: Envoi = {
      id: alea(16),
      heureMs: Date.now(),
      regle: 0,
      message: { k: "piece", r: alea(32), piece, palier: bucket, nom: "rapport.bin", mime: "application/octet-stream", taille: 5 * MIB, sorte: "fichier", dureeMs: null },
    };
    const seqPiece = await b.envoyer(pe, piece);
    await lit(a, pe, 1);
    await lit(c, pe, 1);
    const relu: Uint8Array[] = [];
    for (let n = 0; n < 3; n++) {
      const s = await a.lireSegment(piece, n);
      expect(s.status).toBe(200);
      relu.push(s.octets);
    }
    expect(Buffer.concat(relu).equals(Buffer.from(conteneur))).toBe(true);
    // Liée : le retrait de la trame efface la pièce.
    b.retirer(seqPiece);
    await b.ping();
    expect((await c.lireSegment(piece, 0)).status).toBe(404);
  });

  it("4ᵉ client, mauvais mot de passe : 403, 9 essais restants", async () => {
    const refus = await ClientSalon.rejoindre(srv, lien, "Zz9!wQ4#k?b").catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(HttpError);
    expect((refus as HttpError).status).toBe(403);
    expect((refus as HttpError).body).toEqual({ error: "bad_password", attempts_left: 9 });
  });

  it("destruction par le créateur : 0x05 raison 2 chez tous, fermeture 1000", async () => {
    const r = await fetch(`${srv.origin}/api/salons/detruire`, {
      method: "POST",
      headers: { "X-Shh-Manage": b64u(sGestion), "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(200);
    for (const x of tous) {
      await x.attendre(enr(0x05));
      expect(x.fin).toBe(2);
      expect(await x.attendreFermeture()).toBe(1000);
    }
  });

  it("aucun écart de protocole, aucune trame refusée par le moteur", () => {
    for (const x of tous) {
      expect(x.erreurs).toEqual([]);
      expect(x.recus.filter((r) => r.k === "err")).toEqual([]);
    }
  });
});
