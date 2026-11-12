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
  let srv: TestServer;
  const clients: ClientSalon[] = [];
  beforeAll(async () => {
    srv = await startServer({ salons: true });
  });
  afterAll(async () => {
    for (const c of clients) await c.fermer().catch(() => undefined);
    await srv?.dispose();
  });

  it("conversation, éphémères, instantané, retrait, coupure, reprise, pièce, mauvais mot de passe, destruction", async () => {
    // --- Entrées : le créateur (siège 0) ajoute chaque invité dès son KeyPackage ---------------
    const { createur: a, lien, mdp, sGestion } = await ClientSalon.creer(srv, { maxMembers: 4 });
    clients.push(a);
    expect(a.siege).toBe(0);
    const b = await ClientSalon.rejoindre(srv, lien, mdp);
    clients.push(b);
    expect(b.siege).toBe(1);
    await Promise.all([a.attendreMembres([0, 1]), b.attendreMembres([0, 1])]);
    const c = await ClientSalon.rejoindre(srv, lien, mdp);
    clients.push(c);
    expect(c.siege).toBe(2);
    await Promise.all([a, b, c].map((x) => x.attendreMembres([0, 1, 2])));

    // --- Chacun lit les textes des deux autres, enveloppe identique ----------------------------
    const textes = [texte("Bonjour de A é😀"), texte("Bonjour de B"), texte("Bonjour de C")];
    const tous = [a, b, c];
    for (const [i, x] of tous.entries()) await x.envoyer(textes[i]!);
    for (const [i, x] of tous.entries()) {
      for (const [j, y] of tous.entries()) if (i !== j) await lit(y, textes[i]!, i);
    }

    // --- « écrit » (volatil) : reçu en direct, jamais au rattrapage (vérifié à la coupure) ------
    const e1 = ecrit();
    const seqEcrit = await a.envoyer(e1);
    expect(a.eng.lireEnTete((a.recus.find(enr(0x01, seqEcrit)) as { enr: { octets: Uint8Array } }).enr.octets.slice(18)).volatile).toBe(true);
    await lit(b, e1, 0);
    await lit(c, e1, 0);

    // --- « instantané » lu (0x05) par les deux autres → 0x0E chez les trois --------------------
    const inst = texte("Lu une fois", 1);
    const seqInst = await a.envoyer(inst);
    for (const x of [b, c]) {
      expect(await lit(x, inst, 0)).toBe(seqInst);
      x.lu(seqInst);
    }
    await Promise.all(tous.map((x) => x.attendre(efface(seqInst))));

    // --- Coupure de C pendant 20 messages ; un retrait et un « écrit » pendant ce temps --------
    await c.couper();
    const avantCoupure = c.dernierSeq;
    const retire = texte("Message retiré");
    const seqRetire = await a.envoyer(retire);
    await lit(b, retire, 0);
    a.retirer(seqRetire);
    await a.ping(); // 0x02 traité avant le 0x08
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
    expect(c.recus.some(enr(0x01, seqRetire))).toBe(false);
    expect(c.recus.some(enr(0x01, seqEcrit2))).toBe(false);
    expect(c.recus.some(enr(0x01, seqEcrit))).toBe(true); // reçu en direct, avant la coupure
    // Accueil de la reconnexion : 0x0E renvoyé pour l'instantané (rang dans (émission, depuis]),
    // jamais pour le retrait.
    expect(c.effaces.filter((s) => s === seqInst).length).toBe(2);
    expect(c.effaces).not.toContain(seqRetire);

    // --- Reprise de C (nouvelle identité) : le créateur l'ajoute de nouveau --------------------
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

    // --- Pièce de 5 Mio : envoyée, liée à sa trame, relue par un autre à l'identique ----------
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

    // --- 4ᵉ client, mauvais mot de passe : 403, 9 essais restants ------------------------------
    const refus = await ClientSalon.rejoindre(srv, lien, "Zz9!wQ4#k?b").catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(HttpError);
    expect((refus as HttpError).status).toBe(403);
    expect((refus as HttpError).body).toEqual({ error: "bad_password", attempts_left: 9 });

    // --- Destruction par le créateur : 0x05 raison 2 chez tous ---------------------------------
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

    // Aucun écart de protocole, aucune trame refusée par le moteur.
    for (const x of tous) {
      expect(x.erreurs).toEqual([]);
      expect(x.recus.filter((r) => r.k === "err")).toEqual([]);
    }
  });
});
