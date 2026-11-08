// Brouillon d'envoi (spec §41.14, D41-19) : le partage est créé au premier fichier, chaque
// fichier est chiffré sous sa propre clé et envoyé aussitôt, en arrière-plan ; retirer un
// fichier interrompt son envoi et efface ses segments sur le serveur ; au clic, `finalize`
// attend la fin des envois, puis tire R, le sel, Argon2id et l'enveloppe, chiffre le manifeste
// des seuls éléments gardés (dans l'ordre affiché) et finalise. Le lien n'existe qu'après.
// Le serveur ne reçoit que K_accès et S_gestion (création), des segments chiffrés, des numéros
// de segments, et à la fin le sel, Argon2id, V_preuve, E, l'en-tête et le manifeste chiffré.
import { SEG_CHUNKS, CHUNK_CT, HEADER, type Item, type KeepTtl, type Rights } from "../crypto/container";
import { DATA_SEGMENTS, elementSealer, reservationFor, sealFinal, segmentsFor, type FinalEntry } from "../crypto/elements";
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

/** Signe de vie du brouillon (le serveur efface un envoi sans nouvelle depuis 15 min). */
export const KEEP_MS = 240_000;

const SEG_CT = SEG_CHUNKS * CHUNK_CT;

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
  first: number; // -1 : pas encore placé
  segs: number;
  phase: ElementPhase;
  acked: number;
  inflight: number;
  error?: unknown;
  k?: Uint8Array<ArrayBuffer>;
  ac: AbortController;
  /** Au moins un PUT parti : les segments [first, first + segs) peuvent exister sur le serveur. */
  touched: boolean;
  /** Fin du traitement en cours (envoi interrompu compris). */
  done?: Promise<void>;
};

type Created = { kLien: KLien; sGestion: SGestion; token: string; bucket: number };

type Hooks = Pick<CreateOpts, "pause" | "onRetry">;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function createDraft(origin: string, o: DraftOpts = {}) {
  checkOrigin(origin);
  const c = api.ctx(origin, o);
  const els = new Map<string, El>();
  /** Places d'éléments retirés, gardées jusqu'à la fin de leur effacement sur le serveur. */
  const holds = new Set<{ first: number; segs: number; bytes: number }>();
  /** Effacements qui ont échoué : réessayés avant la finalisation, qui échoue sinon. */
  const stuck = new Set<{ first: number; segs: number; bytes: number }>();
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
    return e.segs * SEG_CT + (e.first === 0 && e.segs > 0 ? HEADER : 0);
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
      // Réservation : fichiers déjà placés et en attente (la place exacte suit, par grow).
      let pending = usedSegments();
      for (const e of els.values()) if (e.first < 0) pending += e.segs;
      const bucket = reservationFor(Math.min(DATA_SEGMENTS, pending));
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
      e.acked = e.inflight = 0;
      e.touched = false;
      e.phase = "attente";
      e.error = undefined;
    }
    // Pas de nouvelle création en arrière-plan (un serveur qui répond 404 en boucle ferait
    // créer brouillon sur brouillon) : elle attend le clic ; une finalisation en cours échoue.
    backgroundFailed = true;
    losses++;
    changed();
  }

  // --- place --------------------------------------------------------------------------

  function usedSegments(): number {
    let hi = 0;
    for (const e of els.values()) if (e.first >= 0) hi = Math.max(hi, e.first + e.segs);
    for (const h of holds) hi = Math.max(hi, h.first + h.segs);
    return hi;
  }

  function place(segs: number): number {
    if (segs === 0) return 0;
    const taken = new Uint8Array(DATA_SEGMENTS);
    for (const e of els.values()) if (e.first >= 0) taken.fill(1, e.first, e.first + e.segs);
    for (const h of holds) taken.fill(1, h.first, h.first + h.segs);
    for (let a = 0, run = 0; a < DATA_SEGMENTS; a++) {
      run = taken[a] ? 0 : run + 1;
      if (run === segs) return a - segs + 1;
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
      e.segs = segmentsFor(e.data.size);
      e.first = place(e.segs);
      const sealer = await elementSealer(e.data, e.first);
      e.k = sealer.k;
      for (let j = 0; j < sealer.segments; j++) {
        await abortable(Promise.resolve().then(() => hooks.pause?.()), signal);
        throwIfAborted(signal);
        // Réservation agrandie au fil de l'envoi (le serveur n'accepte que 2 segments
        // au-delà du dernier reçu, audit H1).
        const n = e.first + j;
        if ((n + 1) * SEG_CHUNKS + 1 > cr.bucket) {
          const need = reservationFor(n + 1);
          await withBudget(Date.now() + SERVER_STALL_MS, { signal }, (s) => api.grow(c, cr.token, need, s));
          cr.bucket = need;
        }
        const data = await sealer.segment(j);
        e.phase = "envoi";
        changed();
        e.touched = true;
        await withBudget(deadline, { signal, onRetry: (r) => hooks.onRetry?.(r) }, (s) =>
          api.putSegment(c, cr.token, e.first + j, data, (b) => {
            e.inflight = Math.min(b, data.length);
            changed();
          }, s),
        );
        e.acked += data.length;
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
  function eraseOnServer(cr: Created, h: { first: number; segs: number }): Promise<boolean> {
    const run = eraseChain.then(async () => {
      try {
        await withBudget(Date.now() + SERVER_STALL_MS, {}, (s) => api.erase(c, cr.token, h.first, h.first + h.segs, s));
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
    const hold = e.first >= 0 && e.segs > 0 ? { first: e.first, segs: e.segs, bytes: e.data?.size ?? e.src.size } : null;
    if (hold) holds.add(hold);
    changed();
    let ok = true;
    try {
      await e.done;
      e.k?.fill(0);
      const cr = created;
      if (cr && hold && e.touched) ok = await eraseOnServer(cr, hold);
    } finally {
      if (hold && ok) holds.delete(hold);
      if (hold && !ok) stuck.add(hold);
      changed();
      void pump();
    }
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
          els.set(id, { id, src: data, first: -1, segs: segmentsFor(data.size), phase: "attente", acked: 0, inflight: 0, ac: new AbortController(), touched: false });
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
        els.set(id, { id, src: e.src, first: -1, segs: segmentsFor(e.src.size), phase: "attente", acked: 0, inflight: 0, ac: new AbortController(), touched: false });
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
        const files = list.filter((x) => x.item.kind === "file").map((x) => els.get(x.id));
        if (files.some((e) => e === undefined)) throw new Error("element_inconnu");
        const failed = files.find((e) => e!.phase === "erreur");
        if (failed) throw failed.error;
        report = () => {
          if (!created || files.some((e) => !els.has(e!.id))) return;
          const total = files.reduce((n, e) => n + totalOf(e!), 0);
          const sent = files.reduce((n, e) => n + e!.acked + e!.inflight, 0);
          const segsDone = files.reduce((n, e) => n + Math.round(e!.acked / SEG_CT), 0);
          const segsTotal = files.reduce((n, e) => n + e!.segs, 0);
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

  async function finish(cr: Created, list: { id: string; item: Item }[], f: CreateOpts) {
    const r = newSeed();
    const salt = randomBytes(16);
    const wipe: Uint8Array[] = [r];
    try {
      const keys = await contentKeys(r);
      const entries: FinalEntry[] = [];
      for (const { id, item } of list) {
        if (item.kind === "text") {
          const raw = item.data instanceof Uint8Array ? item.data : new Uint8Array(await item.data.arrayBuffer());
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
          } catch {
            throw new Error("texte_invalide");
          }
          entries.push({ kind: "text", name: item.name, mime: item.mime, text });
        } else {
          const e = els.get(id)!;
          entries.push({ kind: "file", name: item.name, mime: item.mime, size: e.data!.size, firstSeg: e.first, k: e.k! });
        }
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

export type Draft = ReturnType<typeof createDraft>;

/** Annulation avant tout effet : rejet AbortError. */
export { abortError };
