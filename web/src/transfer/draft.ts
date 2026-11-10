// Brouillon d'envoi (spec §41.14, D41-19) : le partage est créé au premier fichier, chaque
// fichier est chiffré sous sa propre clé et envoyé aussitôt, en arrière-plan ; retirer un
// fichier interrompt son envoi et efface ses segments sur le serveur ; au clic, `finalize`
// attend la fin des envois, puis tire R, le sel, Argon2id et l'enveloppe, chiffre le manifeste
// des seuls éléments gardés (dans l'ordre affiché) et finalise. Le lien n'existe qu'après.
// Le serveur ne reçoit que K_accès et S_gestion (création), des segments chiffrés, des numéros
// de segments, et à la fin le sel, Argon2id, V_preuve, E, l'en-tête et le manifeste chiffré.
import { SEG_CHUNKS, CHUNK_CT, HEADER, TEXT_BYTES_MAX, TEXT_MAX, type Item, type KeepTtl, type Rights } from "../crypto/container";
import { DATA_CHUNKS, DATA_SEGMENTS, elementSealer, footprintFor, isSmall, reservationFor, sealFinal, segmentsNeeded, type FinalEntry } from "../crypto/elements";
import { b64u } from "../crypto/encoding";
import { accessKeys, contentKeys, newSeed, seal, shareId } from "../crypto/envelope";
import { KDF_CREATE, deriveAccess, newKLien, newSGestion, passwordKeyForCreate, randomBytes } from "../crypto/kdf";
import type { KLien, SGestion } from "../crypto/types";
import { isGeneratedPassword } from "../crypto/password";
import { MAX_OPENS, TTL_HOURS } from "../limits";
import * as api from "./api";
import {
  CAPTCHA_MIN_MS,
  NotFoundError,
  PREPARED_MIN_LEFT_MS,
  abortable,
  proofFields,
  senderError,
  sleep,
  throwIfAborted,
  withBudget,
  type CaptchaCtx,
  type CaptchaProof,
  type CreateOpts,
} from "./client";
import { checkOrigin, manageLink, shareLink } from "./link";
import { readCaptcha, takeCaptcha, type PreparedCaptcha } from "./prepare";
import { SERVER_STALL_MS, abortError } from "./upload";

/**
 * Segments pleins réservés au plus à la création (D42-6) : palier 400, plafond de création du
 * serveur (CreateMaxBucket) ; la réservation grandit ensuite par grow, au fil de l'envoi.
 */
export const CREATE_SEGMENTS = 6;

/** Signe de vie du brouillon (le serveur efface un envoi sans nouvelle depuis 15 min). */
export const KEEP_MS = 240_000;

/** État d'une ligne du composeur. */
export type ElementPhase = "attente" | "chiffrement" | "envoi" | "pret" | "erreur";
export type ElementStatus = { phase: ElementPhase; sent: number; total: number; error?: unknown };

export type DraftOpts = api.Net & {
  /** Défi anti-robot résolu en arrière-plan à la création du brouillon (Worker). */
  solveCaptcha?: (challenge: unknown, ctx: CaptchaCtx) => Promise<CaptchaProof>;
  /** Défi déjà récupéré et sa preuve en cours (Task 14). */
  prepared?: () => { cap: PreparedCaptcha; proof: Promise<CaptchaProof> } | undefined;
  /**
   * Point d'accroche du nettoyage des métadonnées (Task 9, non codé ici) : appelé avant
   * l'attribution de la place et le chiffrement ; rend le contenu à chiffrer (sa taille fixe
   * la place). Par défaut, le contenu tel quel.
   */
  prepare?: (data: Blob) => Promise<Blob>;
  /** Un état a changé (ligne, progression, création). */
  onChange?: () => void;
  /** Créer le brouillon dès le premier fichier (faux : seulement au clic, ex. createShare). */
  auto?: boolean;
  keepMs?: number;
};

type El = {
  id: string;
  src: Blob;
  data?: Blob;
  first: number; // premier morceau ; -1 : pas encore placé
  chunks: number; // emprise en morceaux : les seuls nécessaires (audit H-2, D41-38)
  /**
   * Fin (morceau exclu) de la dernière plage dont l'envoi est parti ; 0 : aucune. Au-delà,
   * rien n'existe sur le serveur : un élément retiré ou en erreur y rend sa place (D42-6).
   */
  reach: number;
  parts: number; // requêtes d'envoi (une par segment touché)
  partsDone: number;
  phase: ElementPhase;
  acked: number;
  inflight: number;
  error?: unknown;
  k?: Uint8Array<ArrayBuffer>;
  ac: AbortController;
  /** Au moins un PUT parti : ses morceaux peuvent exister sur le serveur. */
  touched: boolean;
  /** Fin du traitement en cours (envoi interrompu compris). */
  done?: Promise<void>;
};

type Hold = { from: number; to: number; bytes: number }; // segments [from, to)

type Created = { kLien: KLien; sGestion: SGestion; token: string; bucket: number };

type Hooks = Pick<CreateOpts, "pause" | "onRetry">;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function createDraft(origin: string, o: DraftOpts = {}) {
  checkOrigin(origin);
  const c = api.ctx(origin, o);
  const els = new Map<string, El>();
  /** Places (segments) de grands éléments retirés, gardées jusqu'à la fin de leur effacement sur le serveur. */
  const holds = new Set<Hold>();
  /** Effacements qui ont échoué : réessayés avant la finalisation, qui échoue sinon. */
  const stuck = new Set<Hold>();
  /**
   * Morceaux [début, fin) de petits éléments retirés après un envoi (audit H-2) : jamais
   * effacés sur le disque tout de suite (clé oubliée, indéchiffrables), jamais réutilisés,
   * remplacés par de l'aléa par le serveur à finalize (`void`).
   */
  const voids: [number, number][] = [];
  let created: Created | null = null;
  let creating: Promise<Created> | null = null;
  let backgroundFailed = false;
  let closed = false;
  let pumping = false;
  let keepTimer: ReturnType<typeof setInterval> | undefined;
  let hooks: Hooks = {};
  let waiters: (() => void)[] = [];
  let deadline = 0;
  let losses = 0;

  let report: (() => void) | undefined;
  const changed = () => {
    o.onChange?.();
    report?.();
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  };
  const nextChange = () => new Promise<void>((r) => waiters.push(r));

  function totalOf(e: El): number {
    return e.chunks * CHUNK_CT + (e.first === 0 && e.chunks > 0 ? HEADER : 0);
  }

  // --- création -------------------------------------------------------------------------

  async function obtain(solve: DraftOpts["solveCaptcha"], prepared: ReturnType<NonNullable<DraftOpts["prepared"]>>, signal?: AbortSignal): Promise<Created> {
    if (!solve) throw new Error("captcha");
    prepared?.proof.catch(() => undefined);
    const kLien = newKLien();
    const sGestion = newSGestion();
    const acc = await deriveAccess(kLien);
    try {
      let cap = prepared && prepared.cap.expiresAt - performance.now() > PREPARED_MIN_LEFT_MS ? takeCaptcha(prepared.cap, origin) : undefined;
      let proof: Promise<CaptchaProof>;
      if (cap !== undefined) proof = prepared!.proof;
      else {
        const fresh = await abortable(readCaptcha(c), signal);
        throwIfAborted(signal);
        cap = takeCaptcha(fresh, origin)!;
        proof = solve(fresh.challenge, { fallbackOrigin: fresh.fallbackOrigin, mode: "pow" });
      }
      const fields = proofFields(await abortable(proof, signal), cap);
      const wait = cap.receivedAt + CAPTCHA_MIN_MS - performance.now();
      if (wait > 0) await sleep(wait, signal);
      throwIfAborted(signal);
      // Réservation : fichiers déjà placés et en attente, au plus CREATE_SEGMENTS segments
      // (D42-6 : le serveur refuse plus) ; la suite vient par grow, au fil de l'envoi.
      const pending = usedSegments() + segmentsNeeded([...els.values()].filter((e) => e.first < 0).map((e) => e.src.size));
      const bucket = reservationFor(Math.min(CREATE_SEGMENTS, DATA_SEGMENTS, pending));
      // Jamais interrompue : un brouillon créé resterait inconnu.
      const r = await api.create(c, acc.kAcces, sGestion, { bucket, hp: "", shown_at: cap.shownAt, ...fields });
      return { kLien, sGestion, token: r.uploadToken, bucket };
    } catch (e) {
      kLien.fill(0);
      sGestion.fill(0);
      throw e;
    } finally {
      acc.kAcces.fill(0);
    }
  }

  function adopt(cr: Created) {
    if (closed) {
      void api.destroy(c, { sGestion: cr.sGestion }, undefined, true).catch(() => undefined);
      return;
    }
    created = cr;
    deadline = Date.now() + SERVER_STALL_MS;
    keepTimer ??= setInterval(() => void ping(), o.keepMs ?? KEEP_MS);
    changed();
    void pump();
  }

  /** Création en arrière-plan au premier fichier ; un échec attend le clic (finalize). */
  function background() {
    if (!o.auto || created || creating || backgroundFailed || closed || els.size === 0) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    creating = obtain(o.solveCaptcha, o.prepared?.());
    creating.then(adopt, () => {
      backgroundFailed = true;
    }).finally(() => {
      creating = null;
      changed();
    });
  }

  async function ping() {
    const cr = created;
    if (!cr || closed) return;
    try {
      await api.keep(c, cr.token);
    } catch (e) {
      if (e instanceof api.HttpError && e.status === 404) lost(cr);
    }
  }

  /** Brouillon effacé par le serveur (échéance, redémarrage) : tout repartira sous un nouveau. */
  function lost(cr: Created) {
    if (created !== cr) return;
    created = null;
    // Au cas où il existerait encore (404 d'un essai rejoué) : destruction au mieux.
    void api.destroy(c, { sGestion: cr.sGestion }, undefined, true).catch(() => undefined);
    cr.kLien.fill(0);
    cr.sGestion.fill(0);
    for (const e of els.values()) {
      e.ac.abort();
      e.ac = new AbortController();
      e.first = -1;
      e.k?.fill(0);
      e.k = undefined;
      e.acked = e.inflight = e.partsDone = e.reach = 0;
      e.touched = false;
      e.phase = "attente";
      e.error = undefined;
    }
    voids.length = 0;
    holds.clear();
    stuck.clear();
    // Pas de nouvelle création en arrière-plan (un serveur qui répond 404 en boucle ferait
    // créer brouillon sur brouillon) : elle attend le clic ; une finalisation en cours échoue.
    backgroundFailed = true;
    losses++;
    changed();
  }

  // --- place --------------------------------------------------------------------------
  // Audit H-2 : un élément d'un segment ou plus occupe seul des segments entiers à partir d'une
  // frontière (la fin de son dernier segment n'est pas envoyée : le serveur la remplit) ; un
  // petit élément prend ses morceaux dans un segment partagé (premier ajustement, sans
  // déborder de son segment) ; places de grands éléments en cours d'effacement et morceaux
  // retirés exclus.

  function takenChunks(): Uint8Array {
    const t = new Uint8Array(DATA_CHUNKS);
    for (const e of els.values()) {
      if (e.first < 0 || e.chunks === 0) continue;
      // En erreur : seule la place déjà partie reste prise (un essai neuf la reprend ailleurs) ;
      // un élément placé derrière laisserait sinon un trou jamais reçu (D42-6) ou un grow refusé.
      const end = e.phase === "erreur" ? Math.min(e.first + e.chunks, e.reach) : e.first + e.chunks;
      if (end <= e.first) continue;
      if (e.data && isSmall(e.data.size)) t.fill(1, e.first, end);
      else t.fill(2, e.first, Math.ceil(end / SEG_CHUNKS) * SEG_CHUNKS);
    }
    for (const h of holds) t.fill(2, h.from * SEG_CHUNKS, h.to * SEG_CHUNKS);
    for (const [a, z] of voids) t.fill(1, a, z);
    return t;
  }

  function usedSegments(): number {
    const t = takenChunks();
    let hi = t.length;
    while (hi > 0 && t[hi - 1] === 0) hi--;
    return Math.ceil(hi / SEG_CHUNKS);
  }

  function place(size: number): number {
    const n = footprintFor(size);
    if (n === 0) return 0;
    const t = takenChunks();
    if (isSmall(size)) {
      for (let a = 0, run = 0; a < DATA_CHUNKS; a++) {
        if (a % SEG_CHUNKS === 0) run = 0;
        run = t[a] ? 0 : run + 1;
        if (run === n) return a - n + 1;
      }
    } else {
      const segs = Math.ceil(n / SEG_CHUNKS);
      for (let g = 0, run = 0; g < DATA_SEGMENTS; g++) {
        run = t.subarray(g * SEG_CHUNKS, (g + 1) * SEG_CHUNKS).some((x) => x !== 0) ? 0 : run + 1;
        if (run === segs) return (g - segs + 1) * SEG_CHUNKS;
      }
    }
    throw new Error("trop_gros");
  }

  // --- envoi ----------------------------------------------------------------------------

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const cr = created;
        if (!cr || closed) return;
        const e = [...els.values()].find((x) => x.phase === "attente");
        if (!e) return;
        const run = send(cr, e);
        e.done = run.catch(() => undefined);
        await e.done;
      }
    } finally {
      pumping = false;
    }
  }

  async function send(cr: Created, e: El): Promise<void> {
    const signal = e.ac.signal;
    deadline = Math.max(deadline, Date.now() + SERVER_STALL_MS);
    try {
      e.phase = "chiffrement";
      changed();
      e.data ??= o.prepare ? await o.prepare(e.src) : e.src;
      throwIfAborted(signal);
      e.chunks = footprintFor(e.data.size);
      e.first = place(e.data.size);
      const sealer = await elementSealer(e.data, e.first);
      e.k = sealer.k;
      e.parts = sealer.pieces.length;
      for (const [j, p] of sealer.pieces.entries()) {
        await abortable(Promise.resolve().then(() => hooks.pause?.()), signal);
        throwIfAborted(signal);
        // Réservation agrandie au fil de l'envoi (le serveur n'accepte que 2 segments
        // au-delà du dernier reçu, audit H1).
        const n = p.seg;
        if ((n + 1) * SEG_CHUNKS + 1 > cr.bucket) {
          const need = reservationFor(n + 1);
          await withBudget(Date.now() + SERVER_STALL_MS, { signal }, (s) => api.grow(c, cr.token, need, s));
          cr.bucket = need;
        }
        const data = await sealer.piece(j);
        // Le chiffrement ne s'interrompt pas : brouillon perdu ou élément retiré entre-temps →
        // on s'arrête ici, sans remettre l'élément en « envoi » (revue du 10 novembre).
        throwIfAborted(signal);
        e.phase = "envoi";
        changed();
        e.touched = true;
        e.reach = n * SEG_CHUNKS + p.from + p.chunks;
        // Segment entier : envoi simple ; sinon, plage de morceaux (?from).
        const from = p.from === 0 && p.chunks === SEG_CHUNKS ? undefined : p.from;
        await withBudget(deadline, { signal, onRetry: (r) => hooks.onRetry?.(r) }, (s) =>
          api.putSegment(c, cr.token, n, data, (b) => {
            e.inflight = Math.min(b, data.length);
            changed();
          }, s, from),
        );
        e.acked += data.length;
        e.partsDone++;
        e.inflight = 0;
        deadline = Date.now() + SERVER_STALL_MS;
        changed();
      }
      e.phase = "pret";
      changed();
    } catch (err) {
      e.inflight = 0;
      if (signal.aborted || isAbort(err)) return;
      if (err instanceof api.HttpError && err.status === 404) return lost(cr);
      e.phase = "erreur";
      e.error = senderError(err);
      changed();
    }
  }

  /**
   * Efface sur le serveur les segments d'un élément retiré (audit M4) : un effacement à la
   * fois (le serveur répond 503 « busy » à deux opérations simultanées), nouveaux essais
   * 1, 2, 4… 30 s jusqu'à l'échéance SERVER_STALL_MS ; 404 : brouillon déjà effacé. Rend
   * faux si l'effacement n'a pas pu se faire.
   */
  let eraseChain: Promise<unknown> = Promise.resolve();
  function eraseOnServer(cr: Created, h: Hold): Promise<boolean> {
    const run = eraseChain.then(async () => {
      try {
        await withBudget(Date.now() + SERVER_STALL_MS, {}, (s) => api.erase(c, cr.token, h.from, h.to, s));
        return true;
      } catch (e) {
        return e instanceof api.HttpError && e.status === 404;
      }
    });
    eraseChain = run;
    return run;
  }

  /**
   * Retire e : envoi interrompu et attendu, puis segments effacés ; la place reste prise (et
   * comptée dans `removing`) jusqu'au succès de l'effacement.
   */
  async function drop(e: El) {
    e.ac.abort();
    els.delete(e.id);
    // Petit élément (audit H-2) : place rendue tout de suite ; si un envoi est parti, ses
    // morceaux restent exclus et sont remplacés par le serveur à finalize (void).
    const small = e.first >= 0 && e.chunks > 0 && e.data !== undefined && isSmall(e.data.size);
    const big = e.first >= 0 && e.chunks > 0 && !small;
    // Grand élément : seuls ses segments déjà partis sont gardés puis effacés (abort fait :
    // plus aucun envoi ne part) ; le reste de sa place est libre aussitôt (D42-6).
    const hold: Hold | null = big && e.touched ? { from: e.first / SEG_CHUNKS, to: Math.ceil(e.reach / SEG_CHUNKS), bytes: e.data?.size ?? e.src.size } : null;
    if (hold) holds.add(hold);
    const voided: [number, number] | null = small ? [e.first, e.first + e.chunks] : null;
    if (voided) voids.push(voided); // exclu jusqu'à la fin de l'envoi interrompu
    changed();
    let ok = true;
    try {
      await e.done;
      e.k?.fill(0);
      // Rien n'est parti : la place est libre.
      if (voided && !e.touched && voids.includes(voided)) voids.splice(voids.indexOf(voided), 1);
      const cr = created;
      if (cr && hold) ok = await eraseOnServer(cr, hold);
    } finally {
      if (hold && ok) holds.delete(hold);
      if (hold && !ok) stuck.add(hold);
      changed();
      void pump();
    }
  }

  function fresh(id: string, src: Blob): El {
    const chunks = footprintFor(src.size);
    return { id, src, first: -1, chunks, reach: 0, parts: Math.ceil(chunks / SEG_CHUNKS), partsDone: 0, phase: "attente", acked: 0, inflight: 0, ac: new AbortController(), touched: false };
  }

  // --- interface ------------------------------------------------------------------------

  const erasing = new Set<Promise<void>>();

  return {
    get created() {
      return created !== null;
    },
    /** Octets d'éléments retirés dont l'effacement sur le serveur n'est pas encore confirmé. */
    get removing() {
      let n = 0;
      for (const h of holds) n += h.bytes;
      return n;
    },
    /**
     * Aligne le brouillon sur la liste des fichiers (id, contenu) : nouveaux mis en file,
     * absents retirés (envoi interrompu, segments effacés), contenu changé renvoyé.
     */
    sync(list: { id: string; data: Blob }[]) {
      if (closed) return;
      const want = new Map(list.map((x) => [x.id, x.data]));
      for (const e of [...els.values()]) {
        const d = want.get(e.id);
        if (d !== e.src) {
          const p = drop(e);
          erasing.add(p);
          void p.finally(() => erasing.delete(p));
        }
      }
      for (const [id, data] of want)
        if (!els.has(id))
          els.set(id, fresh(id, data));
      changed();
      background();
      void pump();
    },
    status(id: string): ElementStatus | undefined {
      const e = els.get(id);
      return e && { phase: e.phase, sent: e.acked + e.inflight, total: totalOf(e), error: e.error };
    },
    /** Octets chiffrés envoyés et à envoyer, tous fichiers confondus. */
    progress(): { sent: number; total: number } {
      let sent = 0, total = 0;
      for (const e of els.values()) {
        sent += e.acked + e.inflight;
        total += totalOf(e);
      }
      return { sent, total };
    },
    /** Réessayer un fichier en erreur : clé neuve, place neuve. */
    retry(id: string) {
      const e = els.get(id);
      if (!e || e.phase !== "erreur") return;
      const p = drop(e).then(() => {
        els.set(id, fresh(id, e.src));
        backgroundFailed = false;
        changed();
        background();
        void pump();
      });
      erasing.add(p);
      void p.finally(() => erasing.delete(p));
    },
    /** Abandon (onglet fermé, retour, liste vidée) : brouillon détruit en keepalive (promesse : fin de la requête). */
    abandon(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      clearInterval(keepTimer);
      for (const e of els.values()) {
        e.ac.abort();
        e.k?.fill(0);
      }
      const cr = created;
      created = null;
      if (!cr) return creating ? creating.then(() => undefined, () => undefined) : Promise.resolve();
      const p = api.destroy(c, { sGestion: cr.sGestion }, undefined, true).catch(() => undefined);
      cr.kLien.fill(0);
      cr.sGestion.fill(0);
      return p;
    },
    finalize: (items: { id: string; item: Item }[], f: CreateOpts) => finalize(items, f),
  };

  async function finalize(list: { id: string; item: Item }[], f: CreateOpts): Promise<{ link: string; manage: string; expiresInS: number }> {
    if (!(TTL_HOURS as readonly number[]).includes(f.ttlHours)) throw new Error("duree_invalide");
    if (!Number.isInteger(f.maxOpens) || f.maxOpens < 1 || f.maxOpens > MAX_OPENS) throw new Error("ouvertures_invalides");
    f.prepared?.proof.catch(() => undefined);
    // Mot de passe de la forme générée (D41-15) : refusé avant toute requête.
    if (!isGeneratedPassword(f.password)) throw new Error("mot_de_passe_non_genere");
    throwIfAborted(f.signal);
    if (closed) throw new NotFoundError();
    try {
      hooks = { pause: f.pause, onRetry: f.onRetry };
      let lastProg: [number, number] | undefined;
      let lastBytes: [number, number] | undefined;
      // Note jamais remise au brouillon (appel direct, createShare) : envoyée maintenant. Son
      // texte est vérifié (UTF-8, au plus TEXT_MAX points de code) avant tout envoi.
      for (const { id, item } of list) {
        if (item.kind !== "text" || els.has(id)) continue;
        const data = await textBlob(item.data);
        els.set(id, fresh(id, data));
        changed();
        background();
        void pump();
      }
      await Promise.all([...erasing]);
      const lossesAtStart = losses;
      for (const h of [...stuck]) {
        if (created && !(await eraseOnServer(created, h))) throw new Error("reseau");
        stuck.delete(h);
        holds.delete(h);
      }
      for (;;) {
        if (losses !== lossesAtStart) throw new NotFoundError(); // brouillon perdu pendant l'attente
        if (!created) {
          const p = creating ?? obtain(f.solveCaptcha, f.prepared, f.signal);
          const cr = await abortable(p, f.signal).catch((e: unknown) => {
            throw senderError(e);
          });
          if (!created) adopt(cr);
        }
        throwIfAborted(f.signal);
        const files = list.map((x) => els.get(x.id));
        if (files.some((e) => e === undefined)) throw new Error("element_inconnu");
        const failed = files.find((e) => e!.phase === "erreur");
        if (failed) throw failed.error;
        report = () => {
          if (!created || files.some((e) => !els.has(e!.id))) return;
          const total = files.reduce((n, e) => n + totalOf(e!), 0);
          const sent = files.reduce((n, e) => n + e!.acked + e!.inflight, 0);
          const segsDone = files.reduce((n, e) => n + e!.partsDone, 0);
          const segsTotal = files.reduce((n, e) => n + e!.parts, 0);
          // Émis seulement quand la valeur change ; octets : maximum atteint (monotone).
          // Premier signal toujours (0, n) : « partage créé » pour l'écran d'envoi.
          if (lastProg === undefined && segsDone > 0) {
            lastProg = [0, segsTotal];
            f.onProgress?.(0, segsTotal);
          }
          if (lastProg === undefined || lastProg[0] !== segsDone || lastProg[1] !== segsTotal) {
            lastProg = [segsDone, segsTotal];
            f.onProgress?.(segsDone, segsTotal);
          }
          const shown = Math.min(sent, total);
          if (lastBytes === undefined || lastBytes[1] !== total || shown > lastBytes[0]) {
            lastBytes = [Math.max(shown, lastBytes?.[1] === total ? lastBytes[0] : 0), total];
            f.onBytes?.(lastBytes[0], total);
          }
        };
        report();
        if (created && files.every((e) => e!.phase === "pret")) break;
        await abortable(nextChange(), f.signal);
      }
      deadline = Date.now() + SERVER_STALL_MS;
      return await finish(created!, list, f);
    } catch (e) {
      throw senderError(e);
    } finally {
      hooks = {};
      report = undefined;
    }
  }

  /**
   * Morceaux de petits éléments retirés à remplacer (audit H-2), dans le palier final hors
   * morceau du manifeste, triés et fusionnés ; au plus MAX_VOID plages (au-delà, ils restent
   * chiffrés sous une clé oubliée, indéchiffrables).
   */
  function voidRanges(bucket: number): [number, number][] {
    const out: [number, number][] = [];
    for (const [a, z0] of [...voids].sort((x, y) => x[0] - y[0])) {
      const z = Math.min(z0, bucket - 1);
      if (a >= z) continue;
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], z);
      else out.push([a, z]);
    }
    return out.slice(0, MAX_VOID);
  }

  async function finish(cr: Created, list: { id: string; item: Item }[], f: CreateOpts) {
    const r = newSeed();
    const salt = randomBytes(16);
    const wipe: Uint8Array[] = [r];
    try {
      const keys = await contentKeys(r);
      const entries: FinalEntry[] = [];
      for (const { id, item } of list) {
        const e = els.get(id)!;
        // Note (D41-36) : un élément comme un fichier, envoyé dès sa validation.
        if (item.kind === "text") entries.push({ kind: "text", name: item.name, mime: item.mime, size: e.data!.size, first: e.first, k: e.k! });
        else entries.push({ kind: "file", name: item.name, mime: item.mime, size: e.data!.size, first: e.first, k: e.k!, ...(item.clean ? { clean: item.clean } : {}) });
      }
      const fin = await sealFinal(entries, keys, { rights: f.rights as Rights | undefined, keepTtlH: f.keepTtlH as KeepTtl | undefined });
      throwIfAborted(f.signal);
      const kMdp = await passwordKeyForCreate(f.password, salt);
      wipe.push(kMdp);
      const ak = await accessKeys(cr.kLien, kMdp);
      kMdp.fill(0);
      wipe.push(ak.kPreuve);
      const envelope = b64u(await seal(ak.kEnv, r, await shareId(cr.kLien), fin.header));
      r.fill(0);
      throwIfAborted(f.signal);
      const body: api.DraftFinalizeBody = {
        salt: b64u(salt),
        kdf_ops: KDF_CREATE.ops,
        kdf_mem: KDF_CREATE.mem,
        proof_v: b64u(ak.vPreuve),
        envelope,
        ttl_hours: f.ttlHours,
        max_opens: f.maxOpens,
        bucket: fin.bucket,
        header: b64u(fin.header),
        tail: b64u(fin.tail),
      };
      const v = voidRanges(fin.bucket);
      if (v.length > 0) body.void = v;
      const expiresInS = await withBudget(deadline, f, async (s, attempt) => {
        try {
          return await api.finalize(c, cr.token, body, s);
        } catch (e) {
          // Essai précédent abouti sans réponse : status (S_gestion) tranche.
          if (attempt > 1 && e instanceof api.HttpError && e.status === 404) {
            const st = await api.status(c, cr.sGestion).catch(() => undefined);
            if (st?.state === "ready") return st.expiresInS;
          }
          if (e instanceof api.HttpError && e.status === 404) lost(cr);
          throw e;
        }
      });
      closed = true;
      clearInterval(keepTimer);
      const base = f.base ?? "/";
      const out = { link: shareLink(origin, cr.kLien, base), manage: manageLink(origin, cr.sGestion, base), expiresInS };
      for (const e of els.values()) e.k?.fill(0);
      cr.kLien.fill(0);
      cr.sGestion.fill(0);
      created = null;
      return out;
    } finally {
      for (const b of wipe) b.fill(0);
    }
  }
}

/** Texte d'une note en Blob, vérifié : UTF-8 valide (« texte_invalide »), au plus TEXT_MAX points de code (« texte_trop_long »). */
export async function textBlob(data: Uint8Array<ArrayBuffer> | Blob): Promise<Blob> {
  if ((data instanceof Blob ? data.size : data.byteLength) > TEXT_BYTES_MAX) throw new Error("texte_trop_long");
  const raw = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new Error("texte_invalide");
  }
  if ([...text].length > TEXT_MAX) throw new Error("texte_trop_long");
  return new Blob([raw]);
}

export type Draft = ReturnType<typeof createDraft>;

/** Plages de void envoyées au plus (limite du serveur) ; au-delà, restent indéchiffrables. */
export const MAX_VOID = 512;

/** Annulation avant tout effet : rejet AbortError. */
export { abortError };
