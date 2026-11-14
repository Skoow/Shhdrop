// « Le serveur ne voit rien », étendu au salon (plan C-2 Task 17, spec §14, §39.3.8, v3 §5.1) —
// CE TEST BLOQUE TOUTE MISE EN LIGNE.
// Trois clients (vrai moteur du salon, vrai binaire Go) échangent un profil (pseudonyme et
// avatar), un texte, un fichier, un vocal et une réaction, tous porteurs de repères. On fouille
// ensuite, en octets bruts et en base64url/base64 : le dossier de données (shares.db, son WAL,
// salons/, salon-pieces/, blobs/), stdout et stderr du serveur, chaque requête et chaque
// réponse, et la mémoire du processus serveur. La conversation sur disque est sous une seconde
// couche (AES-256-GCM, clé en mémoire seulement) : aucune fenêtre de 32 octets d'une trame
// envoyée ne doit s'y retrouver, ni aucune heure de réception. Chaque fouille a son témoin : un
// repère qu'on sait présent, retrouvé, pour prouver que la recherche lit bien ce qu'elle dit.
//
// Contenu des pièces : en C-3, un paquet SHH2 d'un élément sous la graine R (§39.2.5). Le format
// des pièces du salon n'étant pas encore écrit côté client, le test chiffre le contenu repère par
// AES-256-GCM (WebCrypto) sous une graine R de 32 octets, glissé dans un conteneur aléatoire de
// la taille exacte du palier : le serveur ne reçoit que ce conteneur, et R voyage dans le
// message `piece` chiffré, comme en C-3.
import { createHash, hkdfSync, webcrypto } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { passwordKey } from "../src/engine";
import type { EnveloppeEnvoi, Message } from "../src/salon/engine";
import { ClientSalon, KDF, alea, b64u, egal, reglerSalon, tailleConteneur, u64, unb64u, type Recu, type Srv } from "./salon-client";
import { capturingFetch, findIn, listFiles, needle, scanDir, scanProcessMemory, type Captured, type Needle } from "./scan";
import { startServer, type TestServer } from "./server";

// Fichier de conversation côté serveur (server/internal/salon/conversation.go) : emplacements
// de 4 168 octets (nonce 12 ‖ trame chiffrée 4 140 ‖ étiquette 16), par paliers de 64.
const EMPLACEMENT = 4168;
const PALIER = 64 * EMPLACEMENT;

const IP = "203.0.113.78";
const UA = "ReperUASalon/1.0";
const REF = "https://repere-referer.example/ReperRefSalon";
const PSEUDO = "PseudoSalonQx5c9d";
const TEXTE = "TexteSalonWk8a83f";
const NOM = "NomFichierZj4b7e.pdf";
const CONTENU_PIECE = "ContenuPieceHv61d0";
const CONTENU_VOCAL = "ContenuVocalYb0e95";
const CONTENU_AVATAR = "ContenuAvatarFt7a21";
const EMOJI = "👨‍👩‍👧‍👦"; // 25 octets : repère assez long pour une fouille sans faux positif
const MDP = "Vq3#Lm8?Tz6"; // forme générée (D41-15)
/** heure_ms d'un message (repère) : décalée de l'horloge, pour ne jamais tomber sur une heure de réception. */
const HEURE = Date.now() - 98_765_431;

const hk = (ikm: Uint8Array, info: string, n = 32) => new Uint8Array(hkdfSync("sha256", ikm, new Uint8Array(0), info, n));
const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const cat = (...xs: Uint8Array[]) => new Uint8Array(Buffer.concat(xs.map((x) => Buffer.from(x))));
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Sous-chaînes de 8 caractères des textes saisis : aucune ne doit apparaître.
const fenetres = (label: string, s: string) => Array.from({ length: s.length - 7 }, (_, i) => needle(`${label}[${i}]`, s.slice(i, i + 8)));
/** Entier de 8 octets : gros-boutiste, petit-boutiste, et en chiffres décimaux. */
function heure(label: string, ms: number): Needle {
  const be = Buffer.alloc(8);
  be.writeBigUInt64BE(BigInt(ms));
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(BigInt(ms));
  return { label, forms: [be, le, Buffer.from(String(ms))] };
}

/** Conteneur d'une pièce au palier `bucket` : aléa, avec le contenu chiffré (AES-256-GCM sous `r`) à l'octet 48. */
async function conteneurChiffre(bucket: number, contenu: string, r: Uint8Array): Promise<{ conteneur: Uint8Array; chiffre: Uint8Array }> {
  const cle = await webcrypto.subtle.importKey("raw", r as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt"]);
  const iv = alea(12);
  const chiffre = cat(iv, new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, cle, new TextEncoder().encode(contenu.repeat(4)))));
  const conteneur = new Uint8Array(tailleConteneur(bucket));
  for (let o = 0; o < conteneur.length; o += 65536) conteneur.set(alea(Math.min(65536, conteneur.length - o)), o);
  conteneur.set(chiffre, 48);
  return { conteneur, chiffre };
}

/** Fenêtres de `n` octets (pas de 1) de `aiguilles` présentes dans `meules` ; rend le nombre trouvé. */
function fenetresCommunes(aiguilles: Uint8Array[], meules: Buffer[], n = 32): number {
  const vues = new Set<string>();
  for (const m of meules) for (let i = 0; i + n <= m.length; i++) vues.add(m.toString("latin1", i, i + n));
  let trouvees = 0;
  for (const a of aiguilles) {
    const b = Buffer.from(a);
    for (let i = 0; i + n <= b.length; i++) if (vues.has(b.toString("latin1", i, i + n))) trouvees++;
  }
  return trouvees;
}

describe("le serveur ne voit rien : salon (C-2)", () => {
  let srv: TestServer;
  const log: Captured[] = [];
  const captured = capturingFetch(log);
  const entetes = { "X-Shh-Client-IP": IP, "User-Agent": UA, Referer: REF };
  const marked: typeof fetch = (input, init) => {
    const h = new Headers(init?.headers);
    for (const [k, v] of Object.entries(entetes)) h.set(k, v);
    return captured(input, { ...init, headers: h });
  };
  const clients: ClientSalon[] = [];
  let a: ClientSalon, b: ClientSalon, c: ClientSalon;
  let lien: Uint8Array, sGestion: Uint8Array;
  let kAcces: Uint8Array, kMdp: Uint8Array, kPreuve: Uint8Array, kTrame: Uint8Array, salt: Uint8Array;
  const graines: Uint8Array[] = [];
  const chiffres: { label: string; octets: Uint8Array }[] = [];
  const ids: Uint8Array[] = [];
  let secrets: Needle[]; // jamais nulle part : disque, sorties, requêtes, réponses, mémoire
  let clesEnvoyees: Needle[]; // envoyées par conception (K_accès_s, K_preuve_s, jetons, S_gestion) : jamais sur disque ni dans les sorties
  let traces: Needle[]; // témoins : présents sur disque tant que le salon vit
  let reperesRequete: Needle[];
  type Instantane = { master: string[]; salonCols: string[]; pieceCols: string[]; salons: number; pieces: number };
  const instantanes: Record<string, Instantane> = {};
  let conversations: Buffer[] = [];
  const tailles = { avant: 0, apres: 0, nonVolatiles: 0, nonVolatilesApres: 0 };
  // Clés SFrame (exportées de l'état MLS) de chaque époque traversée, par client. Le moteur
  // n'expose ni la clé privée de signature ni la clé HPKE de la feuille (aucune API, même en
  // test) : elles ne sont donc pas cherchées ici ; seule la clé exportée de chaque époque l'est,
  // comme témoin de l'état MLS. Limite du test, notée dans le rapport de la Task 17.
  const sframes = new Map<string, { label: string; cle: Uint8Array }>();
  function releverSframe(moment: string) {
    for (const x of clients) {
      let ep: number | undefined;
      try {
        ep = x.salon.epoque();
      } catch {
        continue; // pas de Salon (reprise en cours)
      }
      if (ep === undefined) continue; // hors du groupe
      const cle = x.salon.exporterSframe();
      const k = Buffer.from(cle).toString("hex");
      if (!sframes.has(k)) sframes.set(k, { label: `clé SFrame, époque ${ep} (siège ${x.siege}, ${moment})`, cle });
    }
  }

  async function instantane(label: string) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(srv.dataDir, "shares.db"), { readOnly: true });
    try {
      const colonnes = (t: string) => (db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((x) => x.name);
      const compte = (t: string) => Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
      instantanes[label] = {
        master: (db.prepare("SELECT type || ':' || name AS n FROM sqlite_master ORDER BY 1").all() as { n: string }[]).map((x) => x.n),
        salonCols: colonnes("salons"),
        pieceCols: colonnes("salon_pieces"),
        salons: compte("salons"),
        pieces: compte("salon_pieces"),
      };
    } finally {
      db.close();
    }
  }

  const env = (message: Message): EnveloppeEnvoi & { id: Uint8Array } => {
    const id = alea(16);
    ids.push(id);
    return { id, heureMs: Date.now(), regle: 0, message };
  };
  /** Ce client a lu ce message, envoyé par `siege`, enveloppe identique à l'envoi. */
  async function lit(x: ClientSalon, e: EnveloppeEnvoi & { id: Uint8Array }, siege: number) {
    const r = await x.attendre((r: Recu) => r.k === "evt" && r.evenement.type === "message" && egal(r.evenement.enveloppe.id, e.id));
    const m = (r as { evenement: { deSiege: number; enveloppe: unknown } }).evenement;
    expect(m.deSiege).toBe(siege);
    expect(m.enveloppe).toEqual(e);
  }
  /** Pièce envoyée par `x` (vocal : attend que la réserve du siège suffise, 429 sinon). */
  async function piece(x: ClientSalon, label: string, contenu: string, vocal: boolean): Promise<{ r: Uint8Array; id: Uint8Array }> {
    const r = alea(32);
    graines.push(r);
    const { conteneur, chiffre } = await conteneurChiffre(1, contenu, r);
    chiffres.push({ label, octets: chiffre });
    for (let essai = 0; ; essai++) {
      try {
        return { r, id: await x.envoyerPiece(1, conteneur, vocal) };
      } catch (e) {
        if (!vocal || (e as { status?: number }).status !== 429 || essai > 30) throw e;
        await dormir(1000); // réserve vocale : 4 000 o par seconde de WebSocket ouvert
      }
    }
  }

  beforeAll(async () => {
    srv = await startServer({ salons: true });
    const s: Srv = { origin: srv.origin, fetch: marked, entetes };
    const cr = await ClientSalon.creer(s, { maxMembers: 4, mdp: MDP });
    ({ lien, sGestion } = cr);
    a = cr.createur;
    clients.push(a);
    releverSframe("création");
    b = await ClientSalon.rejoindre(s, lien, MDP);
    clients.push(b);
    await Promise.all([a.attendreMembres([0, 1]), b.attendreMembres([0, 1])]);
    releverSframe("entrée de B");
    c = await ClientSalon.rejoindre(s, lien, MDP);
    clients.push(c);
    await Promise.all(clients.map((x) => x.attendreMembres([0, 1, 2])));
    releverSframe("entrée de C");

    // Clés repères, refaites ici depuis K_lien et K_mdp (engine/salon/src/cles.rs) ; témoins :
    // K_preuve_s et l'étiquette sont celles du moteur (la dérivation de K_trame est donc juste).
    kAcces = hk(lien, "shhdrop/v2/salon/acces");
    const meta = (await (await marked(`${srv.origin}/api/salons/meta`, { headers: { "X-Shh-Access": b64u(kAcces) } })).json()) as { salt: string };
    salt = unb64u(meta.salt);
    kMdp = await passwordKey(MDP, salt as Uint8Array<ArrayBuffer>, KDF);
    const kMaitre = hk(cat(lien, kMdp), "shhdrop/v2/salon/maitre");
    kPreuve = hk(kMaitre, "shhdrop/v2/salon/preuve");
    const kSalon = hk(kMaitre, "shhdrop/v2/salon/cle");
    kTrame = hk(kSalon, "shhdrop/v2/salon/trame");
    expect(egal(kPreuve, a.cles.kPreuve()), "K_preuve_s refaite = celle du moteur").toBe(true);
    expect(egal(hk(kSalon, "shhdrop/v2/salon/id", 16), a.cles.tag()), "étiquette refaite = celle du moteur").toBe(true);

    // Profil de B : pseudonyme et avatar (pièce liée à la trame du profil).
    const av = await piece(b, "avatar", CONTENU_AVATAR, false);
    const profil = env({ k: "profil", pseudo: PSEUDO, couleur: 3, avatar: { r: av.r, piece: av.id, palier: 1 } });
    await b.envoyer(profil, av.id);
    await lit(a, profil, 1);
    await lit(c, profil, 1);
    // Texte de A, heure_ms repère.
    const texte = { ...env({ k: "texte", x: TEXTE }), heureMs: HEURE };
    await a.envoyer(texte);
    await lit(b, texte, 0);
    await lit(c, texte, 0);
    // Fichier de C : nom repère, contenu repère.
    const pf = await piece(c, "fichier", CONTENU_PIECE, false);
    const fichier = env({ k: "piece", r: pf.r, piece: pf.id, palier: 1, nom: NOM, mime: "application/pdf", taille: 2000, sorte: "fichier", dureeMs: null });
    await c.envoyer(fichier, pf.id);
    await lit(a, fichier, 2);
    await lit(b, fichier, 2);
    // Vocal de B.
    const pv = await piece(b, "vocal", CONTENU_VOCAL, true);
    const vocal = env({ k: "piece", r: pv.r, piece: pv.id, palier: 1, nom: "vocal.webm", mime: "audio/webm", taille: 3000, sorte: "vocal", dureeMs: 4000 });
    await b.envoyer(vocal, pv.id);
    await lit(a, vocal, 1);
    await lit(c, vocal, 1);
    // Réaction de C au texte de A.
    const reaction = env({ k: "reaction", cible: texte.id, emoji: EMOJI });
    await c.envoyer(reaction);
    await lit(a, reaction, 2);
    await lit(b, reaction, 2);
    for (const x of clients) await x.ping(); // toutes les demandes traitées
    releverSframe("fin, avant la destruction");
    // Trames non volatiles relayées (vues par le créateur, présent depuis le début, écho compris).
    const nonVolatiles = () => a.recus.filter((r) => r.k === "enr" && r.enr.type === 0x01 && !a.eng.lireEnTete(r.enr.octets.subarray(18)).volatile).length;
    const tailleConversation = () => listFiles(join(srv.dataDir, "salons")).reduce((t, f) => t + readFileSync(f).length, 0);
    tailles.avant = tailleConversation();
    tailles.nonVolatiles = nonVolatiles();
    // Trame volatile (« écrit ») : relayée, jamais écrite.
    const e = env({ k: "ecrit" });
    await a.envoyer(e);
    await lit(b, e, 0);
    await lit(c, e, 0);
    for (const x of clients) await x.ping();
    tailles.apres = tailleConversation();
    tailles.nonVolatilesApres = nonVolatiles();

    await instantane("salon vivant");
    conversations = listFiles(join(srv.dataDir, "salons")).map((f) => readFileSync(f));

    secrets = [
      needle("K_lien", lien as Uint8Array<ArrayBuffer>),
      needle("K_mdp", kMdp as Uint8Array<ArrayBuffer>),
      needle("K_trame", kTrame as Uint8Array<ArrayBuffer>),
      needle("K_maître_s", kMaitre as Uint8Array<ArrayBuffer>),
      needle("K_salon", kSalon as Uint8Array<ArrayBuffer>),
      ...[...sframes.values()].map((x) => needle(x.label, x.cle as Uint8Array<ArrayBuffer>)),
      ...graines.map((r, i) => needle(`graine R de pièce ${i}`, r as Uint8Array<ArrayBuffer>)),
      ...ids.map((x, i) => needle(`id de message ${i}`, x as Uint8Array<ArrayBuffer>)),
      needle("pseudonyme", PSEUDO),
      ...fenetres("pseudonyme", PSEUDO),
      needle("texte", TEXTE),
      ...fenetres("texte", TEXTE),
      needle("nom de fichier", NOM),
      ...fenetres("nom de fichier", NOM),
      needle("contenu de pièce", CONTENU_PIECE),
      needle("contenu de vocal", CONTENU_VOCAL),
      needle("contenu d'avatar", CONTENU_AVATAR),
      needle("réaction", EMOJI),
      needle("mot de passe", MDP),
      ...fenetres("mot de passe", MDP),
      heure("heure_ms", HEURE),
    ];
    clesEnvoyees = [
      needle("K_accès_s", kAcces as Uint8Array<ArrayBuffer>),
      needle("K_preuve_s", kPreuve as Uint8Array<ArrayBuffer>),
      needle("S_gestion", sGestion as Uint8Array<ArrayBuffer>),
      ...clients.map((x) => needle(`jeton du siège ${x.siege}`, x.jeton)),
    ];
    traces = [
      needle("access_v", sha256(kAcces) as Uint8Array<ArrayBuffer>),
      needle("proof_v", sha256(kPreuve) as Uint8Array<ArrayBuffer>),
      needle("manage_v", sha256(sGestion) as Uint8Array<ArrayBuffer>),
      needle("sel", salt as Uint8Array<ArrayBuffer>),
    ];
    reperesRequete = [
      needle("adresse (texte)", IP),
      { label: "adresse (4 octets)", forms: [Buffer.from([203, 0, 113, 78])] },
      needle("User-Agent", UA),
      needle("Referer", "ReperRefSalon"),
    ];
  });
  afterAll(async () => {
    for (const x of clients) await x.fermer().catch(() => undefined);
    await srv?.dispose();
  });

  const trames = () => clients.flatMap((x) => x.envoyes.filter((m) => m[0] === 0x01).map((m) => m.subarray(1, 4141)));

  it("chaque 0x01 montant fait 4 141 ou 4 157 octets ; l'accueil, 51", () => {
    const montants = clients.flatMap((x) => x.envoyes.filter((m) => m[0] === 0x01));
    expect(montants.length).toBeGreaterThan(10);
    for (const m of montants) expect([4141, 4157]).toContain(m.length);
    expect(montants.filter((m) => m.length === 4157)).toHaveLength(3); // profil (avatar), fichier, vocal : trame ‖ id de pièce
    for (const x of clients) expect(x.envoyes[0]!.length).toBe(51);
    // Clés SFrame relevées : au moins une par époque traversée (création, entrée de B, de C).
    expect(sframes.size).toBeGreaterThanOrEqual(3);
  });

  it("disque : aucun repère (shares.db, WAL, salons/, salon-pieces/, blobs/) ; témoins retrouvés", () => {
    expect(scanDir(srv.dataDir, [...secrets, ...clesEnvoyees, ...reperesRequete])).toEqual([]);
    // Témoins : les vérificateurs et le sel sont dans la base ; le contenu chiffré des pièces
    // (seul ce que le client a envoyé) est dans salon-pieces/ ; les conversations existent.
    const trouves = scanDir(srv.dataDir, traces).map((h) => h.slice(h.lastIndexOf(" : ") + 3));
    for (const l of ["access_v", "proof_v", "manage_v", "sel"]) expect(trouves, l).toContain(l);
    const pieces = scanDir(join(srv.dataDir, "salon-pieces"), chiffres.map((x) => ({ label: x.label, forms: [Buffer.from(x.octets)] })));
    expect(pieces.map((h) => h.slice(h.lastIndexOf(" : ") + 3)).sort()).toEqual(["avatar", "fichier", "vocal"]);
    const noms = readdirSync(srv.dataDir).map(String);
    for (const d of ["salons", "salon-pieces", "blobs"]) expect(noms, d).toContain(d);
    expect(noms.some((n) => n.startsWith("shares.db"))).toBe(true);
  });

  it("seconde couche : aucune fenêtre de 32 octets d'aucune trame envoyée dans salons/", () => {
    expect(conversations.length).toBe(1);
    const taille = conversations[0]!.length;
    expect(taille).toBeGreaterThan(0);
    // Le fichier grandit par paliers de 64 emplacements de 4 168 octets, remplis d'aléa à leur
    // création (audit adverse du 13 novembre, stockage, F4) : sa taille ne donne plus le nombre
    // de trames, seulement le nombre de paliers entamés.
    expect(taille % PALIER).toBe(0);
    expect(fenetresCommunes(trames(), conversations)).toBe(0);
    // Volatiles jamais écrites : une trame « écrit » n'a pas fait grossir le fichier, qui fait
    // exactement un palier par tranche de 64 trames non volatiles relayées, entamée ou pleine.
    expect(tailles.nonVolatiles).toBeGreaterThan(0);
    expect(tailles.nonVolatilesApres).toBe(tailles.nonVolatiles);
    expect(tailles.apres).toBe(tailles.avant);
    expect(tailles.avant).toBe(PALIER * Math.ceil(tailles.nonVolatiles / 64));
    expect(taille).toBe(tailles.avant);
    // Emplacements pris, effacés ou libres : indistinguables à la lecture du disque. Aucun
    // n'est nul ni régulier : chacun a l'allure d'octets aléatoires (au moins 240 valeurs
    // d'octet distinctes sur 4 168, aucune valeur plus de 64 fois ; un emplacement de zéros,
    // de texte ou de structure répétée échouerait), et aucun n'est la copie d'un autre.
    const vus = new Set<string>();
    for (let off = 0; off < taille; off += EMPLACEMENT) {
      const e = conversations[0]!.subarray(off, off + EMPLACEMENT);
      const compte = new Uint32Array(256);
      for (const o of e) compte[o]! += 1;
      expect(compte.filter((n) => n > 0).length, `emplacement ${off / EMPLACEMENT}`).toBeGreaterThanOrEqual(240);
      expect(Math.max(...compte), `emplacement ${off / EMPLACEMENT}`).toBeLessThanOrEqual(64);
      const cle = e.subarray(0, 32).toString("hex");
      expect(vus.has(cle), `emplacement ${off / EMPLACEMENT} répété`).toBe(false);
      vus.add(cle);
    }
    // Témoin : la recherche trouve une trame recopiée telle quelle.
    const t = trames()[0]!;
    expect(fenetresCommunes([t], [Buffer.concat([conversations[0]!, Buffer.from(t)])])).toBe(4140 - 31);
  });

  it("aucune heure de réception (8 octets de chaque 0x01 reçu) sur disque", () => {
    const recues = new Set<number>();
    for (const x of clients) for (const r of x.recus) if (r.k === "enr" && r.enr.type === 0x01) recues.add(u64(r.enr.octets, 10));
    expect(recues.size).toBeGreaterThan(5);
    for (const ms of recues) expect(Math.abs(ms - Date.now())).toBeLessThan(10 * 60_000); // ce sont bien des heures
    expect(scanDir(srv.dataDir, [...recues].map((ms) => heure(`reçue à ${ms}`, ms)))).toEqual([]);
    // Témoin : la recherche d'une heure écrite gros-boutiste dans un fichier la retrouve.
    const ms = [...recues][0]!;
    const be = Buffer.alloc(8);
    be.writeBigUInt64BE(BigInt(ms));
    expect(findIn(Buffer.concat([Buffer.alloc(5), be]), [heure("témoin", ms)])).toEqual(["témoin"]);
  });

  it("base : salons n'a que les colonnes de §39.3.5, sqlite_master que les noms de la Task 4", () => {
    const s = instantanes["salon vivant"]!;
    expect(s.master).toEqual([
      "index:salon_pieces_salon",
      "index:salons_access_v",
      "index:salons_compte",
      "index:salons_manage_v",
      "index:shares_access_v",
      "index:shares_manage_v",
      "table:salon_pieces",
      "table:salons",
      "table:shares",
    ]);
    expect(s.salonCols).toEqual([
      "id", "access_v", "manage_v", "proof_v", "salt", "kdf_ops", "kdf_mem", "expires_at",
      "max_members", "members_can_destroy", "failed_attempts", "pieces_bytes", "rotation_r",
      // compte (schéma 3, conception du compte §8.2) : seul lien compte ↔ salon, NULL sans compte.
      "compte",
    ]);
    expect(s.pieceCols).toEqual(["id", "salon_id", "bucket", "state", "segments_mask"]);
    expect(s.salons).toBe(1);
    expect(s.pieces).toBe(3);
  });

  it("mémoire du processus serveur : aucun repère de contenu ni de clé", () => {
    const res = scanProcessMemory(srv.pid, secrets);
    if (!res.ok) {
      const why = `lecture de /proc/${srv.pid}/mem impossible (${res.why})`;
      if (process.env.CI) throw new Error(`[le serveur ne voit rien : salon] fouille mémoire obligatoire en CI : ${why}`);
      console.warn(`[le serveur ne voit rien : salon] fouille mémoire IGNORÉE (hors CI) : ${why}`);
      return;
    }
    expect(res.rwRegions, "aucune zone rw-p lue").toBeGreaterThan(0);
    expect(res.rwFailedBytes).toBeLessThanOrEqual(res.rwBytes / 2);
    expect(res.hits).toEqual([]);
    // Témoin : l'empreinte d'un jeton de membre (gardée en mémoire, jamais sur disque) est retrouvée.
    const ctl = scanProcessMemory(srv.pid, [needle("empreinte de jeton", sha256(unb64u(c.jeton)) as Uint8Array<ArrayBuffer>)]);
    expect(ctl.ok && ctl.hits).toEqual(["empreinte de jeton"]);
    // Témoin : l'adresse repère (vue en direct, jamais gardée sur disque) est retrouvée en mémoire.
    const ip = scanProcessMemory(srv.pid, [needle("adresse (texte)", IP)]);
    expect(ip.ok && ip.hits).toEqual(["adresse (texte)"]);
  });

  it("requêtes et réponses : aucun repère ; clés seulement là où le protocole les met ; pseudonyme dans aucun en-tête", () => {
    const hits: string[] = [];
    const jetons = clients.map((x) => needle(`jeton ${x.siege}`, x.jeton));
    for (const r of log) {
      const ou = `${r.method} ${r.url}`;
      for (const l of findIn(Buffer.from(r.url), [...secrets, ...clesEnvoyees])) hits.push(`${ou} URL : ${l}`);
      for (const l of findIn(r.body, [...secrets, ...jetons, needle("K_accès_s", kAcces as Uint8Array<ArrayBuffer>), needle("S_gestion", sGestion as Uint8Array<ArrayBuffer>)])) hits.push(`${ou} corps : ${l}`);
      if (!r.url.endsWith("/api/salons/rejoindre")) for (const l of findIn(r.body, [needle("K_preuve_s", kPreuve as Uint8Array<ArrayBuffer>)])) hits.push(`${ou} corps : ${l}`);
      const reponse = Buffer.concat([r.response, Buffer.from(r.responseHeaders)]);
      for (const l of findIn(reponse, [...secrets, ...reperesRequete, needle("K_accès_s", kAcces as Uint8Array<ArrayBuffer>), needle("K_preuve_s", kPreuve as Uint8Array<ArrayBuffer>), needle("S_gestion", sGestion as Uint8Array<ArrayBuffer>)])) hits.push(`${ou} réponse : ${l}`);
      // Un jeton de membre n'apparaît que dans la réponse de rejoindre qui le donne.
      if (!r.url.endsWith("/api/salons/rejoindre")) for (const l of findIn(reponse, jetons)) hits.push(`${ou} réponse : ${l}`);
      for (const [k, v] of r.headers) {
        const permis = k === "x-shh-access" ? "K_accès_s" : k === "x-shh-manage" ? "S_gestion" : k === "x-shh-membre" ? "jeton" : "";
        for (const l of findIn(Buffer.from(`${k}: ${v}`), [...secrets, ...clesEnvoyees])) if (!permis || !l.startsWith(permis)) hits.push(`${ou} en-tête ${k} : ${l}`);
      }
    }
    // WebSocket : en-têtes de la poignée, messages envoyés (seul l'accueil porte le jeton) et reçus.
    for (const x of clients) {
      for (const [i, m] of x.envoyes.entries()) for (const l of findIn(Buffer.from(m), [...secrets, ...(i === 0 ? [] : jetons), ...clesEnvoyees.filter((n) => !n.label.startsWith("jeton"))])) hits.push(`WS ${x.siege} envoi ${i} : ${l}`);
      for (const r of x.recus) if (r.k === "enr") for (const l of findIn(Buffer.from(r.enr.octets), [...secrets, ...clesEnvoyees, ...reperesRequete])) hits.push(`WS ${x.siege} reçu 0x${r.enr.type.toString(16)} : ${l}`);
    }
    expect(hits).toEqual([]);
    // Pseudonyme : dans aucun en-tête de requête (HTTP ni poignée du WebSocket).
    const pseudo = [needle("pseudonyme", PSEUDO), ...fenetres("pseudonyme", PSEUDO)];
    for (const r of log) expect(findIn(Buffer.from(r.headers.map(([k, v]) => `${k}: ${v}`).join("\n")), pseudo), r.url).toEqual([]);
    // Témoins : les repères de requête sont bien partis ; K_preuve_s dans le corps de rejoindre ;
    // le jeton dans X-Shh-Membre et dans l'accueil ; S_gestion dans X-Shh-Manage.
    expect(log.length).toBeGreaterThan(10);
    for (const r of log) expect(r.headers.find(([k]) => k === "user-agent")?.[1], r.url).toBe(UA);
    expect(log.some((r) => r.url.endsWith("/api/salons/rejoindre") && findIn(r.body, [needle("K_preuve_s", kPreuve as Uint8Array<ArrayBuffer>)]).length)).toBe(true);
    expect(log.some((r) => r.headers.some(([k, v]) => k === "x-shh-membre" && v === b.jeton))).toBe(true);
    expect(findIn(Buffer.from(c.envoyes[0]!), [needle("jeton", c.jeton)])).toEqual(["jeton"]);
    expect(log.some((r) => r.headers.some(([k, v]) => k === "x-shh-manage" && v === b64u(sGestion)))).toBe(true);
  });

  it("après destruction puis arrêt : ni ligne, ni pièce, ni fichier de conversation, aucun repère", async () => {
    const r = await marked(`${srv.origin}/api/salons/detruire`, { method: "POST", headers: { "X-Shh-Manage": b64u(sGestion), "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(200);
    for (const x of clients) {
      await x.attendre((r) => r.k === "enr" && r.enr.type === 0x05);
      expect(await x.attendreFermeture()).toBe(1000);
    }
    await instantane("après destruction");
    expect(instantanes["après destruction"]!.salons).toBe(0);
    expect(instantanes["après destruction"]!.pieces).toBe(0);
    await srv.stop();
    expect(listFiles(join(srv.dataDir, "salons"))).toEqual([]);
    expect(listFiles(join(srv.dataDir, "salon-pieces"))).toEqual([]);
    const morceaux = chiffres.map((x) => ({ label: x.label, forms: [Buffer.from(x.octets)] }));
    expect(scanDir(srv.dataDir, [...secrets, ...clesEnvoyees, ...traces, ...reperesRequete, ...morceaux])).toEqual([]);
    expect(fenetresCommunes(trames(), listFiles(srv.dataDir).map((f) => readFileSync(f)))).toBe(0);
    expect(readdirSync(srv.dataDir).map(String)).toContain("shares.db"); // la base a bien été fouillée
  });

  it("stdout et stderr du serveur : aucun repère", async () => {
    await srv.stop();
    const tous = [...secrets, ...clesEnvoyees, ...traces, ...reperesRequete];
    expect(findIn(srv.stdout(), tous)).toEqual([]);
    expect(findIn(srv.stderr(), tous)).toEqual([]);
    expect(srv.stdout().toString("utf8")).toMatch(/^SHH_LISTENING 127\.0\.0\.1:\d+\n$/);
  });
});

// Renouvellement (spec 2026-11-13, révision du 13 novembre) : « prolonger = renouveler », toute la
// conversation est effacée, les membres restent. Après lui, aucun repère d'avant ne reste sur le
// disque : ni fenêtre de 32 octets de l'ancien fichier de conversation (chiffré sous l'ancienne
// clé), ni contenu chiffré d'une pièce, ni ligne de pièce, ni budget ; témoins : ces mêmes
// repères sont retrouvés sur le disque avant le renouvellement, et la conversation continue.
describe("le serveur ne voit rien : renouvellement du salon", () => {
  let srv: TestServer;
  const clients: ClientSalon[] = [];
  afterAll(async () => {
    for (const x of clients) await x.fermer().catch(() => undefined);
    await srv?.dispose();
  });

  async function base() {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(srv.dataDir, "shares.db"), { readOnly: true });
    try {
      const s = db.prepare("SELECT expires_at AS e, pieces_bytes AS p, max_members AS m FROM salons").all() as { e: number; p: number; m: number }[];
      const pieces = Number((db.prepare("SELECT count(*) AS n FROM salon_pieces").get() as { n: number }).n);
      return { salons: s, pieces };
    } finally {
      db.close();
    }
  }
  const message = (x: string): EnveloppeEnvoi & { id: Uint8Array } => ({ id: alea(16), heureMs: Date.now(), regle: 0, message: { k: "texte", x } });
  const lu = (x: ClientSalon, e: { id: Uint8Array }) => x.attendre((r: Recu) => r.k === "evt" && r.evenement.type === "message" && egal(r.evenement.enveloppe.id, e.id));
  const disque = () => listFiles(srv.dataDir).map((f) => readFileSync(f));

  it("après un renouvellement : rien d'avant sur le disque, membres gardés, 0x10 chez tous", async () => {
    srv = await startServer({ salons: true });
    const s: Srv = { origin: srv.origin };
    const cr = await ClientSalon.creer(s, { maxMembers: 3, mdp: MDP });
    const a = cr.createur;
    clients.push(a);
    const b = await ClientSalon.rejoindre(s, cr.lien, MDP);
    clients.push(b);
    await Promise.all([a.attendreMembres([0, 1]), b.attendreMembres([0, 1])]);
    const avant = message("TexteAvantRenouvQm4z71");
    await a.envoyer(avant);
    await lu(b, avant);
    const r = alea(32);
    const { conteneur, chiffre } = await conteneurChiffre(1, "ContenuAvantRenouvPk93", r);
    const id = await b.envoyerPiece(1, conteneur);
    const fichier = { ...message("x"), message: { k: "piece", r, piece: id, palier: 1, nom: "avant.pdf", mime: "application/pdf", taille: 100, sorte: "fichier", dureeMs: null } } as EnveloppeEnvoi & { id: Uint8Array };
    await b.envoyer(fichier, id);
    await lu(a, fichier);
    for (const x of clients) await x.ping();

    // Témoins avant : conversation non vide, contenu de la pièce retrouvé, ligne et budget.
    const convAvant = listFiles(join(srv.dataDir, "salons")).map((f) => readFileSync(f));
    expect(convAvant).toHaveLength(1);
    expect(convAvant[0]!.length).toBeGreaterThan(0);
    const reperePiece = { label: "pièce d'avant", forms: [Buffer.from(chiffre)] };
    expect(scanDir(srv.dataDir, [reperePiece]).length).toBe(1);
    expect(fenetresCommunes(convAvant, disque())).toBeGreaterThan(0);
    const b0 = await base();
    expect(b0.pieces).toBe(1);
    expect(b0.salons[0]!.p).toBeGreaterThan(0);

    const depart = a.dernierSeq;
    const rep = await reglerSalon(s, cr.sGestion, { renouvelerH: 6 });
    expect(rep.depuis).toBe(depart);
    expect(rep.max_members).toBe(3);
    expect(rep.expires_in_s).toBeGreaterThan(5 * 3600);
    for (const x of clients) {
      await x.attendre((q) => q.k === "enr" && q.enr.type === 0x10);
      expect(x.reglages).toEqual({ depart, secondes: expect.any(Number), places: 3 });
      expect(x.erreurs).toEqual([]);
      // Purge du client : plus rien de rang ≤ départ (trames et ce que le moteur en a tiré).
      expect(x.recus.filter((q) => (q.k === "enr" ? q.enr.type === 0x01 : true) && (q.k === "enr" ? q.enr.seq : q.seq) <= depart)).toEqual([]);
    }

    // Disque : conversation vide (clé neuve), aucune fenêtre de l'ancienne, pièce et ligne parties, budget à 0.
    expect(listFiles(join(srv.dataDir, "salons")).map((f) => readFileSync(f).length)).toEqual([0]);
    expect(fenetresCommunes(convAvant, disque())).toBe(0);
    expect(scanDir(srv.dataDir, [reperePiece])).toEqual([]);
    expect(listFiles(join(srv.dataDir, "salon-pieces"))).toEqual([]);
    const b1 = await base();
    expect(b1.pieces).toBe(0);
    expect(b1.salons).toHaveLength(1);
    expect(b1.salons[0]!.p).toBe(0);
    expect(b1.salons[0]!.e).toBeGreaterThan(b0.salons[0]!.e);

    // Membres gardés : la conversation continue, au rang suivant.
    const apres = message("TexteApresRenouvTn28c5");
    const seq = await a.envoyer(apres);
    expect(seq).toBe(depart + 1);
    await lu(b, apres);
    expect(listFiles(join(srv.dataDir, "salons")).map((f) => readFileSync(f).length)).toEqual([PALIER]); // une trame : un palier
    expect(fenetresCommunes(convAvant, disque())).toBe(0);
    // Reconnexion depuis un rang d'avant : rien d'avant n'est servi.
    const n = b.recus.length;
    await b.couper();
    (b as unknown as { dernierSeq: number }).dernierSeq = 1;
    await b.reconnecter();
    await b.ping();
    const servis = b.recus.slice(n).filter((q) => q.k === "enr" && q.enr.seq <= depart && [0x01, 0x02, 0x03, 0x09, 0x0a].includes(q.enr.type));
    expect(servis).toEqual([]);
    expect(b.erreurs).toEqual([]);
  }, 120_000);
});
