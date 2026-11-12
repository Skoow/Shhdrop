// Client de test du salon (plan C-2, Task 16) : création, entrée, WebSocket et moteur du salon
// (module wasm du crate shhdrop-salon, web/src/salon/engine.ts) contre le vrai binaire Go.
// Il suit le « Protocole » du plan C-2 à la lettre et vérifie chaque enregistrement reçu (taille
// exacte par type, rangs strictement croissants) : un écart est noté dans `erreurs`, que le test
// exige vide. Rien n'est contourné ici : un écart entre le serveur et le moteur doit faire
// échouer le test.
//
// Rôles du client (contrat de l'appelant, engine/salon/src/groupe.rs) : `0x0D` →
// `remplacerAnnonces` avant toute trame ; `0x02`/`0x0A` → `annoncer` ; `0x03`/`0x09` →
// `marquerParti` ; `0x01` → `recevoirTrame(trame, seq, siège)` ; événement `keyPackage` →
// `ajouter` par le plus petit siège en ligne du groupe ; `commitAccepte { welcome }` → envoi du
// Welcome. Les trames montantes partent une à une : chacune attend son écho (son rang) ou un
// refus (`0x0B` : attente puis nouvel envoi des mêmes octets ; `0x0C` : échec).
import { webcrypto } from "node:crypto";
import { passwordKey, type KdfParams } from "../src/engine";
import { loadSalonEngine, type ClesSalon, type EnveloppeEnvoi, type Evenement, type Salon, type SalonEngine } from "../src/salon/engine";
import { solveAltcha } from "./altcha";

/** Paramètres Argon2id du salon (Global Constraints du plan C-2). */
export const KDF: KdfParams = { ops: 3, mem: 67108864 };
/** Mot de passe de la forme générée (D41-15). */
export const MDP = "Kq7!mP2#x?a";
const TAILLE_TRAME = 4140;
const DEPUIS_REPRISE = 0xffffffffffffffffn;
/** Délai d'un envoi (écho ou refus) : au-delà, échec avec les écarts notés. */
const DELAI_ENVOI = 30_000;

/**
 * Serveur visé. `fetch` (facultatif) remplace le fetch global pour toutes les requêtes HTTP du
 * client (capture, en-têtes repères) ; `entetes` s'ajoutent à la poignée du WebSocket.
 */
export type Srv = { origin: string; fetch?: typeof fetch; entetes?: Record<string, string> };

/** Taille exacte de chaque enregistrement serveur → client (« Protocole »), hors 0x0D. */
const TAILLES: Record<number, number> = {
  0x01: 9 + 1 + 8 + TAILLE_TRAME,
  0x02: 9 + 17,
  0x03: 9 + 1,
  0x05: 9 + 1,
  0x07: 9 + 1 + 1 + 8, // 19 (Task 9b)
  0x08: 9 + 8,
  0x09: 9 + 1 + 16 + 4,
  0x0a: 9 + 17,
  0x0b: 9 + 4,
  0x0c: 9,
  0x0e: 9 + 8,
};
/** Types qui prennent un nouveau rang. */
const RANGES = new Set([0x01, 0x02, 0x03, 0x09, 0x0a]);

/** Enregistrement serveur → client, lu. */
export type Enr = { type: number; seq: number; octets: Uint8Array };

/** Ce que le client a reçu, dans l'ordre : enregistrement brut, ou événement du moteur pour une trame. */
export type Recu =
  | { k: "enr"; enr: Enr }
  | { k: "evt"; seq: number; siege: number; recuMs: number; evenement: Evenement }
  | { k: "err"; seq: number; siege: number; erreur: string };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status} ${JSON.stringify(body)}`);
  }
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const alea = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));
const u64 = (b: Uint8Array, o: number) => Number(new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0));
const egal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(srv: Srv, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<any> {
  const r = await (srv.fetch ?? fetch)(srv.origin + path, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  const o = t === "" ? null : JSON.parse(t);
  if (!r.ok) throw new HttpError(r.status, o);
  return o;
}

/** Sortie d'une demande d'envoi en cours : écho (rang), ou refus. */
type EnCours = { trame: Uint8Array; resoudre: (seq: number) => void; refuser: (e: Error) => void; limite: (s: number) => void };

export class ClientSalon {
  /** Tout ce qui a été reçu, dans l'ordre. */
  readonly recus: Recu[] = [];
  /** Écarts au protocole vus par ce client (le test les exige absents). */
  readonly erreurs: string[] = [];
  /** Cibles des 0x0E reçus. */
  readonly effaces: number[] = [];
  /** Messages binaires envoyés sur le WebSocket, dans l'ordre (accueil compris). */
  readonly envoyes: Uint8Array[] = [];
  /** Présence (0x07) : siège → en ligne. */
  readonly presence = new Map<number, boolean>();
  /** Raison du 0x05 reçu, s'il y en a un. */
  fin: number | undefined;
  /** Code de fermeture du dernier WebSocket. */
  codeFermeture: number | undefined;
  /** Dernier rang reçu (enregistrement qui prend un rang). */
  dernierSeq = 0;

  #ws: WebSocket | undefined;
  #salon: Salon | undefined;
  #attente: { pred: (r: Recu) => boolean; ok: (r: Recu) => void }[] = [];
  #envois: Promise<unknown> = Promise.resolve();
  #enCours: EnCours | undefined;
  /** KeyPackages vus (siège → octets) : rejoués après un Commit perdu. */
  #kps = new Map<number, Uint8Array>();
  #accueilli: (() => void) | undefined;
  /** KeyPackage de cette identité déjà publié. */
  #kpPublie = false;
  /** Nouvel envoi prévu après un `0x0B` (effacé par `couper`). */
  #relance: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    readonly srv: Srv,
    readonly eng: SalonEngine,
    readonly cles: ClesSalon,
    readonly jeton: string,
    readonly siege: number,
    public nonce: Uint8Array,
    readonly createur: boolean,
  ) {}

  /** Crée un salon (1 h, `max_members`), puis y entre comme créateur (siège 0). */
  static async creer(srv: Srv, opts: { maxMembers?: number; membersCanDestroy?: boolean; mdp?: string } = {}): Promise<{ createur: ClientSalon; lien: Uint8Array; mdp: string; sGestion: Uint8Array }> {
    const mdp = opts.mdp ?? MDP;
    const eng = await loadSalonEngine();
    const lien = alea(32);
    const sGestion = alea(32);
    const salt = alea(16);
    const kMdp = await passwordKey(mdp, salt as Uint8Array<ArrayBuffer>, KDF);
    const cles = eng.clesSalon(lien, kMdp);
    kMdp.fill(0);
    const acces = eng.cleAcces(lien);
    const cap = await json(srv, "GET", "/api/captcha", {});
    const recu = Date.now();
    const { shown_at, fallback: _f, ...defi } = cap;
    const preuve = await solveAltcha(defi);
    // Le serveur refuse une création moins de 3 s après l'émission du défi.
    await dormir(Math.max(0, recu + 3100 - Date.now()));
    if (preuve.kind !== "pow") throw new Error("preuve inattendue");
    await json(
      srv,
      "POST",
      "/api/salons",
      { "X-Shh-Access": b64u(acces.k), "X-Shh-Manage": b64u(sGestion) },
      {
        ttl_hours: 1,
        max_members: opts.maxMembers ?? 4,
        members_can_destroy: opts.membersCanDestroy ?? false,
        salt: b64u(salt),
        kdf_ops: KDF.ops,
        kdf_mem: KDF.mem,
        proof_v: b64u(cles.vPreuve()),
        altcha: preuve.payload,
        hp: "",
        shown_at,
      },
    );
    acces.k.fill(0);
    const createur = await ClientSalon.#entrer(srv, eng, lien, cles, sGestion);
    return { createur, lien, mdp, sGestion };
  }

  /** Entre dans le salon avec le lien et le mot de passe (meta, Argon2id, rejoindre, WebSocket). */
  static async rejoindre(srv: Srv, lien: Uint8Array, mdp: string): Promise<ClientSalon> {
    const eng = await loadSalonEngine();
    const acces = eng.cleAcces(lien);
    const meta = await json(srv, "GET", "/api/salons/meta", { "X-Shh-Access": b64u(acces.k) });
    acces.k.fill(0);
    const kMdp = await passwordKey(mdp, unb64u(meta.salt) as Uint8Array<ArrayBuffer>, { ops: meta.kdf_ops, mem: meta.kdf_mem });
    const cles = eng.clesSalon(lien, kMdp);
    kMdp.fill(0);
    try {
      return await ClientSalon.#entrer(srv, eng, lien, cles, undefined);
    } catch (e) {
      cles.free();
      throw e;
    }
  }

  static async #entrer(srv: Srv, eng: SalonEngine, lien: Uint8Array, cles: ClesSalon, sGestion: Uint8Array | undefined): Promise<ClientSalon> {
    const acces = eng.cleAcces(lien);
    const kPreuve = cles.kPreuve();
    const h: Record<string, string> = { "X-Shh-Access": b64u(acces.k) };
    if (sGestion) h["X-Shh-Manage"] = b64u(sGestion);
    const e = await json(srv, "POST", "/api/salons/rejoindre", h, { proof: b64u(kPreuve) });
    acces.k.fill(0);
    kPreuve.fill(0);
    const createur = sGestion !== undefined;
    if (createur !== (e.seat === 0)) throw new Error(`siège inattendu ${e.seat}`);
    const c = new ClientSalon(srv, eng, cles, e.member_token, e.seat, unb64u(e.nonce_arrivee), createur);
    c.#salon = eng.Salon.creer(e.seat, c.nonce, cles, createur);
    await c.#connecter(BigInt(e.seq));
    return c;
  }

  /** Salon du moteur (absent pendant une reprise, avant le 0x0D). */
  get salon(): Salon {
    if (!this.#salon) throw new Error("pas de salon");
    return this.#salon;
  }

  /** Ouvre le WebSocket et attend la fin de la séquence d'accueil (0x0D reçu et appliqué). */
  async #connecter(depuis: bigint): Promise<void> {
    const ws = new WebSocket(this.srv.origin.replace(/^http/, "ws") + "/api/salons/ws", { headers: { ...this.srv.entetes, Origin: this.srv.origin } } as never);
    ws.binaryType = "arraybuffer";
    this.#ws = ws;
    const accueilli = new Promise<void>((ok, ko) => {
      this.#accueilli = ok;
      ws.addEventListener("close", (ev) => ko(new Error(`fermé avant l'accueil (${ev.code})`)), { once: true });
    });
    ws.addEventListener("message", (ev) => {
      if (this.#ws !== ws) return; // ancien WebSocket
      try {
        this.#recevoir(new Uint8Array(ev.data as ArrayBuffer));
      } catch (x) {
        this.erreurs.push(`exception : ${(x as Error).message}`);
      }
    });
    ws.addEventListener("close", (ev) => {
      if (this.#ws === ws) this.codeFermeture = ev.code;
    });
    await new Promise<void>((ok, ko) => {
      ws.addEventListener("open", () => ok(), { once: true });
      ws.addEventListener("error", () => ko(new Error("WebSocket refusé")), { once: true });
    });
    const accueil = new Uint8Array(51);
    accueil.set(new TextEncoder().encode(this.jeton), 0);
    new DataView(accueil.buffer).setBigUint64(43, depuis);
    this.#envoyerWS(ws, accueil);
    await accueilli;
  }

  #envoyerWS(ws: WebSocket, b: Uint8Array<ArrayBuffer>): void {
    this.envoyes.push(b.slice());
    ws.send(b);
  }

  #noter(r: Recu): void {
    this.recus.push(r);
    for (const w of [...this.#attente]) {
      if (w.pred(r)) {
        this.#attente.splice(this.#attente.indexOf(w), 1);
        w.ok(r);
      }
    }
  }

  #recevoir(b: Uint8Array): void {
    if (b.length < 9) {
      this.erreurs.push(`enregistrement de ${b.length} octets`);
      return;
    }
    const type = b[0]!;
    const seq = u64(b, 1);
    if (type === 0x0d) {
      const n = b[10] ?? -1;
      if (b.length !== 11 + 25 * n) this.erreurs.push(`0x0D de ${b.length} octets pour n = ${n}`);
    } else if (TAILLES[type] === undefined) {
      this.erreurs.push(`type inconnu 0x${type.toString(16)}`);
      return;
    } else if (b.length !== TAILLES[type]) {
      this.erreurs.push(`0x${type.toString(16)} de ${b.length} octets (attendu ${TAILLES[type]})`);
      return;
    }
    if (RANGES.has(type)) {
      if (seq <= this.dernierSeq) this.erreurs.push(`rang ${seq} après ${this.dernierSeq} (type 0x${type.toString(16)})`);
      this.dernierSeq = seq;
    }
    const enr: Enr = { type, seq, octets: b.slice() };
    switch (type) {
      case 0x01: {
        const siege = b[9]!;
        const recuMs = u64(b, 10);
        const trame = b.slice(18);
        this.#trame(seq, siege, recuMs, trame);
        break;
      }
      case 0x02:
      case 0x0a:
        this.#salon?.annoncer(b[9]!, b.slice(10, 26));
        break;
      case 0x03:
      case 0x09:
        if (b[9] !== 0xff) this.#salon?.marquerParti(b[9]!);
        break;
      case 0x05:
        this.fin = b[9];
        break;
      case 0x07:
        this.presence.set(b[9]!, b[10] === 1);
        break;
      case 0x0b:
        this.#enCours?.limite(new DataView(b.buffer, b.byteOffset + 9, 4).getUint32(0));
        break;
      case 0x0c:
        this.#enCours?.refuser(new Error("plein"));
        break;
      case 0x0d:
        this.#liste(b);
        break;
      case 0x0e:
        this.effaces.push(u64(b, 9));
        break;
    }
    this.#noter({ k: "enr", enr });
  }

  /** 0x0D : liste complète des annonces, avant toute trame. Reprise : nouveau `Salon` d'abord. */
  #liste(b: Uint8Array): void {
    if (b[9] !== 0) this.erreurs.push(`0x0D : créateur ${b[9]}`);
    const liste = [];
    for (let i = 0; i < b[10]!; i++) {
      const o = 11 + 25 * i;
      liste.push({ siege: b[o]!, nonce: b.slice(o + 1, o + 17) });
    }
    let publier = false;
    if (!this.#salon) {
      // Reprise : identité neuve au nonce que le serveur vient d'annoncer pour ce siège.
      const moi = liste.find((a) => a.siege === this.siege);
      if (!moi) throw new Error("0x0D de reprise sans mon siège");
      this.nonce = moi.nonce;
      this.#salon = this.eng.Salon.creer(this.siege, this.nonce, this.cles, false);
      publier = true;
    } else if (!this.createur && this.salon.epoque() === undefined && !this.#kpPublie) {
      publier = true;
    }
    this.salon.remplacerAnnonces(0, liste);
    if (publier) {
      this.#kpPublie = true;
      void this.envoyerTrame(this.salon.keyPackage(this.cles)).catch((e) => this.erreurs.push(`KeyPackage : ${e.message}`));
    }
    this.#accueilli?.();
    this.#accueilli = undefined;
  }

  #trame(seq: number, siege: number, recuMs: number, trame: Uint8Array): void {
    if (siege === this.siege && this.#enCours && egal(trame, this.#enCours.trame)) this.#enCours.resoudre(seq);
    if (!this.#salon) return;
    let ev: Evenement;
    try {
      ev = this.salon.recevoirTrame(this.cles, trame, seq, siege);
    } catch (e) {
      this.#noter({ k: "err", seq, siege, erreur: (e as Error).message });
      return;
    }
    this.#evenement(seq, siege, recuMs, ev);
  }

  #evenement(seq: number, siege: number, recuMs: number, ev: Evenement): void {
    switch (ev.type) {
      case "keyPackage":
        this.#kps.set(siege, ev.octets);
        this.#ajouterSiMoi(siege);
        break;
      case "commitAccepte":
        if (ev.welcome) void this.envoyerTrame(ev.welcome).catch((e) => this.erreurs.push(`Welcome : ${e.message}`));
        for (const s of this.#kps.keys()) this.#ajouterSiMoi(s);
        break;
      case "commitPerdu":
        // Intention rejouée : les arrivées encore hors du groupe.
        for (const s of this.#kps.keys()) this.#ajouterSiMoi(s);
        break;
      case "membres":
        for (const s of ev.ajoutes) this.#kps.delete(s);
        break;
      case "entree":
        this.#noter({ k: "evt", seq, siege, recuMs, evenement: ev });
        for (const r of ev.rejoues) {
          if ("erreur" in r) this.#noter({ k: "err", seq: r.seq, siege: -1, erreur: r.erreur });
          else this.#evenement(r.seq, -1, 0, r.evenement);
        }
        return;
    }
    this.#noter({ k: "evt", seq, siege, recuMs, evenement: ev });
  }

  /** `ajouter` si ce client est le plus petit siège en ligne du groupe (hors de l'arrivant). */
  #ajouterSiMoi(arrivant: number): void {
    const kp = this.#kps.get(arrivant);
    const membres = this.#salon?.membres() ?? [];
    if (!kp || !membres.includes(this.siege)) return;
    const enLigne = membres.filter((s) => s !== arrivant && this.presence.get(s) === true);
    if (Math.min(...enLigne) !== this.siege) return;
    let commit: Uint8Array;
    try {
      commit = this.salon.ajouter(this.cles, kp);
    } catch (e) {
      const m = (e as Error).message;
      // Déjà ajouté (par nous ou par un Commit gagnant) : intention remplie. Commit à nous en
      // attente : rejoué à son écho (commitAccepte, commitPerdu).
      if (m === "deja_membre") this.#kps.delete(arrivant);
      else if (m !== "commit_en_cours") this.erreurs.push(`ajouter ${arrivant} : ${m}`);
      return;
    }
    void this.envoyerTrame(commit).catch((e) => this.erreurs.push(`Commit : ${e.message}`));
  }

  /**
   * Envoie une trame (et la pièce liée) ; rend son rang (écho). `0x0B` : attente puis nouvel
   * envoi des mêmes octets ; `0x0C` : échec. Une trame à la fois. Ni écho ni refus en
   * `DELAI_ENVOI` : échec, avec les écarts notés par ce client.
   */
  envoyerTrame(trame: Uint8Array, piece?: Uint8Array): Promise<number> {
    const p = this.#envois.then(() => {
      let enCours: EnCours | undefined;
      const envoi = new Promise<number>((resoudre, refuser) => {
        const corps = new Uint8Array(1 + trame.length + (piece?.length ?? 0));
        corps[0] = 0x01;
        corps.set(trame, 1);
        if (piece) corps.set(piece, 1 + trame.length);
        const fin = () => {
          if (this.#enCours === enCours) this.#enCours = undefined;
        };
        enCours = {
          trame,
          resoudre: (s) => (fin(), resoudre(s)),
          refuser: (e) => (fin(), refuser(e)),
          limite: (s) => {
            clearTimeout(this.#relance);
            this.#relance = setTimeout(() => {
              this.#relance = undefined;
              if (this.#ws) this.#envoyerWS(this.#ws, corps);
            }, (s + 1) * 1000);
          },
        };
        this.#enCours = enCours;
        this.#envoyerWS(this.#ws!, corps);
      });
      let t: ReturnType<typeof setTimeout> | undefined;
      const delai = new Promise<never>((_, ko) => {
        t = setTimeout(() => {
          if (this.#enCours === enCours) {
            this.#enCours = undefined;
            clearTimeout(this.#relance); // aucun nouvel envoi d'une trame abandonnée
            this.#relance = undefined;
          }
          ko(new Error(`siège ${this.siege} : envoi sans écho après ${DELAI_ENVOI} ms ; écarts : ${JSON.stringify(this.erreurs)}`));
        }, DELAI_ENVOI);
      });
      return Promise.race([envoi, delai]).finally(() => clearTimeout(t));
    });
    this.#envois = p.catch(() => undefined);
    return p;
  }

  /** Envoie une enveloppe du moteur ; rend son rang. */
  envoyer(e: EnveloppeEnvoi, piece?: Uint8Array): Promise<number> {
    return this.envoyerTrame(this.salon.envoyer(this.cles, e).trame, piece);
  }

  /** Premier reçu (déjà là ou à venir) qui satisfait `pred`. */
  attendre(pred: (r: Recu) => boolean, ms = 30_000): Promise<Recu> {
    const deja = this.recus.find(pred);
    if (deja) return Promise.resolve(deja);
    return new Promise((ok, ko) => {
      const w = {
        pred,
        ok: (r: Recu) => {
          clearTimeout(t);
          ok(r);
        },
      };
      const t = setTimeout(() => {
        this.#attente.splice(this.#attente.indexOf(w), 1);
        ko(new Error(`siège ${this.siege} : attente dépassée ; écarts : ${JSON.stringify(this.erreurs)}`));
      }, ms);
      this.#attente.push(w);
    });
  }

  /** Attend que le groupe MLS de ce client compte exactement ces sièges. */
  async attendreMembres(sieges: number[], ms = 30_000): Promise<void> {
    const ok = () => this.#salon !== undefined && JSON.stringify(this.#salon.membres()) === JSON.stringify(sieges);
    const fin = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > fin) throw new Error(`siège ${this.siege} : membres ${JSON.stringify(this.#salon?.membres())}, attendu ${JSON.stringify(sieges)} ; écarts : ${JSON.stringify(this.erreurs)}`);
      await dormir(20);
    }
  }

  #demande(type: number, seq?: number): void {
    const b = new Uint8Array(seq === undefined ? 1 : 9);
    b[0] = type;
    if (seq !== undefined) new DataView(b.buffer).setBigUint64(1, BigInt(seq));
    this.#envoyerWS(this.#ws!, b);
  }

  /** 0x05 : lecture « instantané » de la trame `seq`. */
  lu(seq: number): void {
    this.#demande(0x05, seq);
  }

  /** 0x02 : retrait d'une trame de ce siège. */
  retirer(seq: number): void {
    this.#demande(0x02, seq);
  }

  /** 0x04 → 0x08 : les demandes précédentes de ce WebSocket sont traitées. */
  async ping(): Promise<void> {
    const n = alea(8);
    const b = new Uint8Array(9);
    b[0] = 0x04;
    b.set(n, 1);
    const attente = this.attendre((r) => r.k === "enr" && r.enr.type === 0x08 && egal(r.enr.octets.slice(9), n));
    this.#envoyerWS(this.#ws!, b);
    await attente;
  }

  /**
   * Coupe le WebSocket (fermeture normale du client), sans rien oublier de l'état du moteur.
   * Le nouvel envoi prévu après un `0x0B` est annulé ; la présence est vidée (l'accueil
   * suivant la redonne, `0x07` par siège occupé).
   */
  async couper(): Promise<void> {
    clearTimeout(this.#relance);
    this.#relance = undefined;
    this.presence.clear();
    const ws = this.#ws;
    this.#ws = undefined;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    const ferme = new Promise((r) => ws.addEventListener("close", r, { once: true }));
    ws.close();
    await ferme;
  }

  /** Reconnexion avec le dernier rang reçu : rattrapage puis direct. */
  async reconnecter(): Promise<void> {
    await this.couper();
    await this.#connecter(BigInt(this.dernierSeq));
  }

  /** Reprise : nouvelle identité (nouveau nonce annoncé par 0x0A, nouveau `Salon`), aucun rattrapage. */
  async reprendre(): Promise<void> {
    await this.couper();
    this.#salon?.free();
    this.#salon = undefined;
    this.#kps.clear();
    await this.#connecter(DEPUIS_REPRISE);
  }

  /** Attend la fermeture du WebSocket par le serveur ; rend son code. */
  async attendreFermeture(ms = 10_000): Promise<number> {
    const fin = Date.now() + ms;
    while (this.#ws && this.#ws.readyState !== WebSocket.CLOSED) {
      if (Date.now() > fin) throw new Error("WebSocket toujours ouvert");
      await dormir(20);
    }
    return this.codeFermeture!;
  }

  /** En-têtes d'un membre (pièces). */
  get enTeteMembre(): Record<string, string> {
    return { "X-Shh-Membre": this.jeton };
  }

  /**
   * Envoie une pièce (palier `bucket`, octets opaques de la taille exacte du conteneur) : création,
   * segments, finalisation sans bourrage. Rend son identifiant (16 octets).
   */
  async envoyerPiece(bucket: number, conteneur: Uint8Array, vocal = false): Promise<Uint8Array> {
    const p = await json(this.srv, "POST", "/api/salons/pieces", this.enTeteMembre, { bucket, vocal });
    const auth = { Authorization: `Bearer ${p.upload_token}` };
    let o = 0;
    for (let n = 0; o < conteneur.length; n++) {
      const t = Math.min(64, bucket - 64 * n) * 65552 + (n === 0 ? 48 : 0);
      const r = await (this.srv.fetch ?? fetch)(`${this.srv.origin}/api/salons/pieces/segments/${n}`, { method: "PUT", headers: auth, body: conteneur.slice(o, o + t) });
      if (r.status !== 204) throw new HttpError(r.status, await r.text());
      o += t;
    }
    await json(this.srv, "POST", "/api/salons/pieces/finalize", auth, { fill_from: 0, fill_to: 0 });
    return unb64u(p.piece);
  }

  /** Lit le segment `n` d'une pièce (statut et octets). */
  async lireSegment(piece: Uint8Array, n: number): Promise<{ status: number; octets: Uint8Array }> {
    const r = await (this.srv.fetch ?? fetch)(`${this.srv.origin}/api/salons/pieces/segments/${n}`, { headers: { ...this.enTeteMembre, "X-Shh-Piece": b64u(piece) } });
    return { status: r.status, octets: new Uint8Array(await r.arrayBuffer()) };
  }

  /** Ferme le WebSocket et libère l'état du moteur (clés, état MLS). */
  async fermer(): Promise<void> {
    await this.couper();
    this.#salon?.free();
    this.#salon = undefined;
    this.cles.free();
  }
}

/** Taille du conteneur d'une pièce au palier `bucket` : 48 + B × 65 552 octets. */
export const tailleConteneur = (bucket: number) => 48 + bucket * 65552;

/** Taille de la trame (constante du moteur). */
export { TAILLE_TRAME };
/** Utilitaires pour le test. */
export { alea, b64u, egal, u64, unb64u };
