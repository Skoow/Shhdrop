// File de téléchargements du destinataire (UI §9.8.6, §9.9 ; décisions du propriétaire du
// 7 novembre) : un fichier, une catégorie ou tout, et l'archive .zip ; pause, reprise, arrêt
// et nouvel essai à chaque niveau ; état de chaque ligne.
//
// Règles :
// - **À la suite, un à la fois** : le lecteur du paquet est déjà sérialisé (une opération à la
//   fois sur son cache, lecteur du moteur, engine/index.ts) ; lire en parallèle n'irait pas plus vite et
//   lirait plus de segments (budget). La file suit l'ordre des demandes, puis du manifeste.
// - **Pause sans relecture** : la pause bloque l'écriture de la tranche suivante ; la lecture
//   s'arrête donc après le segment en cours (déjà reçu), rien n'est relu à la reprise, qui
//   repart de l'octet exact. Tant qu'un fichier est en pause, les suivants attendent.
// - **Nouvel essai après une coupure** : le fichier partiel est gardé (puits ouvert) et la
//   lecture reprend à l'octet déjà écrit (`from`) ; elle n'est proposée que si le budget de
//   lecture estimé le permet (read-meter.ts). Le client actuel relit l'élément depuis son début
//   et jette ce qui est déjà écrit ; une reprise au segment demande une option du client
//   (`saveItem(i, sink, { from })`), demandée à la Task M2.
// - **Arrêt** : fichier partiel supprimé (abort), la ligne revient à son état de départ.
// - **Partage disparu** (spec §41.8) : seul le fichier en cours de lecture continue ; ce qui
//   attend, est en pause ou garde un partiel est arrêté (le serveur ne reprend pas une pause
//   après l'échéance, 120 s).
// Aucun réseau ici : les lectures passent par `deps.read` (Opened.saveItem) ; les noms
// viennent de safeName.
import type { ReadMeter } from "./read-meter";
import type { Tracker } from "./gone.svelte";

export type RowState = "idle" | "queued" | "downloading" | "paused" | "done" | "failed";
export type FailReason = "network" | "budget" | "limit" | "disk_full" | "write" | "gone";

export type Row = {
  readonly state: RowState;
  /** Octets écrits (clair). */
  readonly done: number;
  readonly total: number;
  /** Débit mesuré de cette ligne (octets/s), 0 hors lecture. */
  readonly rate: number;
  readonly reason?: FailReason;
  /** Échec qu'un nouvel essai peut corriger (et que le budget estimé permet). */
  readonly retryable: boolean;
};

export type ItemSink = {
  write(chunk: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

/** Destination choisie pour une demande (dossier, fichier par fichier…), opaque ici. */
export type Target = unknown;

export type ZipJob = {
  /** Écrit l'archive ; appelle `pipe(i, write)` pour chaque élément, dans l'ordre voulu. */
  run(pipe: (i: number, write: (c: Uint8Array<ArrayBuffer>) => Promise<void>) => Promise<void>): Promise<void>;
  abort(): Promise<void>;
  /** Octets du clair de l'archive (somme des éléments). */
  total: number;
};

export type DownloadDeps = {
  /** Lit l'élément i à partir de l'octet `from` ; `onChunk` attendu avant la tranche suivante. */
  read(i: number, from: number, onChunk: (c: Uint8Array<ArrayBuffer>) => Promise<void>): Promise<void>;
  /** Puits de l'élément i pour la destination `target` ; null : sélecteur fermé (rien à dire). */
  openSink(i: number, target: Target): Promise<ItemSink | null>;
  meter: ReadMeter;
  /** Horloge (ms). */
  now(): number;
  /** Suivi pour l'écran « partage disparu » ; null : interface fermée, ne rien commencer. */
  track?(i: number): Tracker | null;
  /** Le serveur ne connaît plus le partage (NotFoundError, 410) pendant une lecture. */
  ongone?(): void;
  /** Élément déjà en mémoire (aperçu) : `read` le relit de là, sans le serveur ni le budget. */
  cached?(i: number): boolean;
};

type Job = {
  target: Target;
  sink: ItemSink | null;
  committed: number;
  paused: boolean;
  stop: boolean;
  wake: (() => void) | null;
};

const STOP = Symbol("arret");
const errName = (e: unknown) => (typeof e === "object" && e !== null ? String((e as { name?: unknown }).name ?? "") : "");
const isNetwork = (e: unknown) => e instanceof Error && (e.message === "reseau" || e instanceof TypeError);

/** Échec d'une lecture ou d'une écriture → raison affichée et possibilité d'un nouvel essai. */
export function classify(e: unknown): { reason: FailReason; retryable: boolean; keepPartial: boolean } {
  const n = errName(e);
  if (n === "ReadBudgetError") return { reason: "budget", retryable: false, keepPartial: false };
  if (n === "NotFoundError" || n === "GoneError") return { reason: "gone", retryable: false, keepPartial: false };
  if (n === "LimitError" || n === "ServerError") return { reason: "limit", retryable: true, keepPartial: true };
  if (n === "QuotaExceededError") return { reason: "disk_full", retryable: true, keepPartial: false };
  if (isNetwork(e)) return { reason: "network", retryable: true, keepPartial: true };
  return { reason: "write", retryable: true, keepPartial: false };
}

/** Lecture depuis `from` sur un lecteur qui ne sait lire que depuis le début : le début est jeté. */
export function readSkipping(
  saveItem: (i: number, sink: (c: Uint8Array<ArrayBuffer>) => Promise<void> | void) => Promise<void>,
): DownloadDeps["read"] {
  return (i, from, onChunk) => {
    let skip = from;
    return saveItem(i, async (c) => {
      if (skip >= c.length) {
        skip -= c.length;
        c.fill(0);
        return;
      }
      const part = skip > 0 ? c.slice(skip) : c;
      if (skip > 0) c.fill(0);
      skip = 0;
      await onChunk(part);
    });
  };
}

const IDLE = (total: number): Row => ({ state: "idle", done: 0, total, rate: 0, retryable: false });
/** Intervalle minimal entre deux mises à jour de progression (ms) : pas une par tranche. */
const TICK_MS = 120;
/** Lecture réelle nécessaire avant d'afficher une estimation fondée sur le débit (retours UI4). */
export const MEASURE_MIN_MS = 2000;

export function createDownloads(totals: readonly number[], deps: DownloadDeps) {
  let rows = $state.raw<Row[]>(totals.map(IDLE));
  let zip = $state.raw<Row | null>(null);
  /**
   * Débit mesuré (octets/s, moyenne lissée) ; null tant que moins de MEASURE_MIN_MS de lecture
   * réelle (retours UI4 : aucune estimation sur un débit supposé ni sur les premiers instants).
   */
  let measured = $state<number | null>(null);
  let smoothed: number | null = null;
  let measuredMs = 0;

  const jobs = new Map<number, Job>();
  const queue: number[] = [];
  let active: number | "zip" | null = null;
  let zipJob: { spec: ZipJob; job: Job } | null = null;
  let closed = false;

  const set = (i: number, p: Partial<Row>) => {
    rows = rows.map((r, k) => (k === i ? { ...r, ...p } : r));
  };
  const setZip = (p: Partial<Row>) => {
    if (zip) zip = { ...zip, ...p };
  };

  function meterRate(bytes: number, ms: number) {
    if (ms <= 0) return;
    const r = (bytes / ms) * 1000;
    smoothed = smoothed === null ? r : smoothed * 0.7 + r * 0.3;
    measuredMs += ms;
    if (measuredMs >= MEASURE_MIN_MS) measured = smoothed;
  }

  async function checkpoint(job: Job) {
    while (job.paused && !job.stop) await new Promise<void>((res) => (job.wake = res));
    job.wake = null;
    if (job.stop) throw STOP;
  }

  // Compteur de progression partagé par une ligne ou l'archive.
  function progress(onTick: (done: number, rate: number) => void) {
    let lastAt = deps.now();
    let lastBytes = 0;
    let bytes = 0;
    let rate = 0;
    return {
      add(n: number, force = false) {
        bytes += n;
        const t = deps.now();
        if (force || t - lastAt >= TICK_MS) {
          const dt = t - lastAt;
          if (dt > 0) {
            rate = ((bytes - lastBytes) / dt) * 1000;
            meterRate(bytes - lastBytes, dt);
          }
          lastAt = t;
          lastBytes = bytes;
          onTick(bytes, rate);
        }
      },
      /** Après une pause : le temps d'arrêt ne compte pas dans le débit. */
      resync() {
        lastAt = deps.now();
        lastBytes = bytes;
      },
      get bytes() {
        return bytes;
      },
    };
  }

  function pump() {
    if (active !== null || closed) return;
    while (queue.length > 0) {
      const i = queue.shift()!;
      if (rows[i]?.state !== "queued") continue;
      active = i;
      void runItem(i).finally(() => {
        active = null;
        pump();
      });
      return;
    }
    if (zipJob && zip?.state === "queued") {
      active = "zip";
      void runZip().finally(() => {
        active = null;
        pump();
      });
    }
  }

  async function runItem(i: number) {
    const job = jobs.get(i)!;
    const from = job.committed;
    const hit = deps.cached?.(i) ?? false;
    if (!hit && !deps.meter.canRead(i, from)) {
      await job.sink?.abort().catch(() => undefined);
      job.sink = null;
      job.committed = 0;
      set(i, { state: "failed", reason: "budget", retryable: false, rate: 0, done: 0 });
      return;
    }
    let sink = job.sink;
    if (!sink) {
      try {
        sink = await deps.openSink(i, job.target);
      } catch (e) {
        const c = classify(e);
        set(i, { state: "failed", reason: c.reason, retryable: c.retryable, rate: 0 });
        return;
      }
      if (!sink) {
        jobs.delete(i);
        set(i, IDLE(rows[i]!.total));
        return;
      }
      job.sink = sink;
    }
    if (job.stop || closed) {
      await sink.abort().catch(() => undefined);
      jobs.delete(i);
      set(i, IDLE(rows[i]!.total));
      return;
    }
    const tracker = deps.track ? deps.track(i) : undefined;
    if (tracker === null) {
      await sink.abort().catch(() => undefined);
      jobs.delete(i);
      set(i, { ...IDLE(rows[i]!.total), state: "failed", reason: "gone" });
      return;
    }
    set(i, { state: job.paused ? "paused" : "downloading", done: from, reason: undefined, retryable: false });
    if (!hit) deps.meter.charge(i, from);
    const p = progress((d, rate) => {
      set(i, { done: from + d, rate });
      tracker?.progress(from + d);
    });
    try {
      await deps.read(i, from, async (c) => {
        if (job.paused) {
          await checkpoint(job);
          p.resync();
        } else if (job.stop) throw STOP;
        const n = c.length;
        await sink.write(c);
        job.committed += n;
        p.add(n);
      });
      await checkpoint(job); // arrêt demandé pendant la dernière tranche
      await sink.close();
      p.add(0, true);
      jobs.delete(i);
      set(i, { state: "done", done: rows[i]!.total, rate: 0, retryable: false });
      tracker?.end(true);
    } catch (e) {
      deps.meter.interrupted();
      if (e === STOP) {
        await sink.abort().catch(() => undefined);
        jobs.delete(i);
        set(i, closed ? { ...IDLE(rows[i]!.total), state: "failed", reason: "gone" } : IDLE(rows[i]!.total));
        tracker?.end(false);
        return;
      }
      const c = classify(e);
      const retry = c.retryable && !closed;
      if (!(c.keepPartial && retry)) {
        await sink.abort().catch(() => undefined);
        job.sink = null;
        job.committed = 0;
      }
      job.paused = false;
      set(i, { state: "failed", reason: c.reason, retryable: retry, rate: 0, done: job.committed });
      tracker?.end(false);
      if (c.reason === "gone") deps.ongone?.();
    }
  }

  async function runZip() {
    const z = zipJob!;
    setZip({ state: z.job.paused ? "paused" : "downloading", done: 0, reason: undefined, retryable: false });
    const p = progress((d, rate) => setZip({ done: d, rate }));
    try {
      await z.spec.run(async (i, write) => {
        if (!(deps.cached?.(i) ?? false)) {
          if (!deps.meter.canRead(i, 0)) throw Object.assign(new Error("budget_epuise"), { name: "ReadBudgetError" });
          deps.meter.charge(i, 0);
        }
        await deps.read(i, 0, async (c) => {
          if (z.job.paused) {
            await checkpoint(z.job);
            p.resync();
          } else if (z.job.stop) throw STOP;
          const n = c.length;
          await write(c);
          p.add(n);
        });
      });
      p.add(0, true);
      setZip({ state: "done", done: z.spec.total, rate: 0 });
    } catch (e) {
      deps.meter.interrupted();
      await z.spec.abort().catch(() => undefined);
      if (e === STOP) setZip({ ...IDLE(z.spec.total) });
      else {
        const c = classify(e);
        // Une archive interrompue est supprimée : un nouvel essai la recommence.
        setZip({ state: "failed", reason: c.reason, retryable: c.retryable && !closed && c.reason !== "budget", rate: 0 });
        if (c.reason === "gone") deps.ongone?.();
      }
    } finally {
      zipJob = null;
    }
  }

  function enqueue(i: number, target: Target) {
    const r = rows[i];
    if (!r || closed) return;
    if (r.state === "idle" || r.state === "done") {
      jobs.set(i, { target, sink: null, committed: 0, paused: false, stop: false, wake: null });
      set(i, { state: "queued", done: 0, rate: 0, reason: undefined, retryable: false });
      queue.push(i);
    } else if (r.state === "failed" && r.retryable) {
      const job = jobs.get(i) ?? { target, sink: null, committed: 0, paused: false, stop: false, wake: null };
      jobs.set(i, job);
      set(i, { state: "queued", reason: undefined, retryable: false });
      queue.push(i);
    }
  }

  return {
    get rows(): readonly Row[] {
      return rows;
    },
    get zip(): Row | null {
      return zip;
    },
    /** Débit mesuré (octets/s), null avant toute lecture. */
    get measured(): number | null {
      return measured;
    },
    /**
     * Le lecteur du paquet est tenu par une lecture en pause : un aperçu attendrait sa reprise.
     * (Réactif par les lignes : l'état « paused » de la lecture active.)
     */
    get readerHeld(): boolean {
      if (active === "zip") return zip?.state === "paused";
      return active !== null && rows[active]?.state === "paused";
    },
    /** Lecture en cours, en pause, ou en attente : garde de sortie de page. */
    get busy(): boolean {
      return active !== null || queue.some((i) => rows[i]?.state === "queued") || rows.some((r) => r.state === "paused");
    },
    /** Demande le téléchargement de ces éléments (ordre du manifeste), vers `target`. */
    start(items: readonly number[], target: Target = null) {
      for (const i of [...items].sort((a, b) => a - b)) enqueue(i, target);
      pump();
    },
    /** Nouvel essai d'un échec (partiel gardé si possible). */
    retry(i: number) {
      if (rows[i]?.state === "failed" && rows[i]!.retryable) enqueue(i, jobs.get(i)?.target ?? null);
      pump();
    },
    pause(items: readonly number[]) {
      for (const i of items) {
        const r = rows[i];
        const job = jobs.get(i);
        if (!job || (r?.state !== "queued" && r?.state !== "downloading")) continue;
        job.paused = true;
        set(i, { state: "paused", rate: 0 });
      }
    },
    resume(items: readonly number[]) {
      for (const i of [...items].sort((a, b) => a - b)) {
        const job = jobs.get(i);
        if (!job || rows[i]?.state !== "paused") continue;
        job.paused = false;
        if (active === i) {
          set(i, { state: "downloading" });
          job.wake?.();
        } else {
          set(i, { state: "queued" });
          if (!queue.includes(i)) queue.push(i);
        }
      }
      pump();
    },
    stop(items: readonly number[]) {
      for (const i of items) {
        const job = jobs.get(i);
        const r = rows[i];
        if (!job || !r) continue;
        if (active === i) {
          job.stop = true;
          job.wake?.();
        } else if (r.state === "queued" || r.state === "paused" || r.state === "failed") {
          void job.sink?.abort().catch(() => undefined);
          jobs.delete(i);
          set(i, IDLE(r.total));
        }
      }
    },
    /** Archive .zip : une seule à la fois, dans la même file. */
    startZip(spec: ZipJob) {
      if (closed || zipJob || (zip && (zip.state === "downloading" || zip.state === "paused" || zip.state === "queued"))) return;
      zipJob = { spec, job: { target: null, sink: null, committed: 0, paused: false, stop: false, wake: null } };
      zip = { ...IDLE(spec.total), state: "queued" };
      pump();
    },
    pauseZip() {
      if (!zipJob || !zip || (zip.state !== "queued" && zip.state !== "downloading")) return;
      zipJob.job.paused = true;
      setZip({ state: "paused", rate: 0 });
    },
    resumeZip() {
      if (!zipJob || zip?.state !== "paused") return;
      zipJob.job.paused = false;
      setZip({ state: active === "zip" ? "downloading" : "queued" });
      zipJob.job.wake?.();
      pump();
    },
    stopZip() {
      if (!zipJob) return;
      if (active === "zip") {
        zipJob.job.stop = true;
        zipJob.job.wake?.();
      } else {
        void zipJob.spec.abort().catch(() => undefined);
        zipJob = null;
        zip = null;
      }
    },
    /** Le dernier état de l'archive (fin, échec) n'est plus montré. */
    clearZip() {
      if (zip && (zip.state === "done" || zip.state === "failed" || zip.state === "idle")) zip = null;
    },
    /**
     * Partage disparu (spec §41.8) : la lecture en cours continue (sauf si elle est en pause) ;
     * tout le reste est arrêté, partiels supprimés ; plus rien ne commence.
     */
    close() {
      if (closed) return;
      closed = true;
      queue.length = 0;
      for (const [i, job] of jobs) {
        if (active === i && !job.paused) continue;
        if (active === i) {
          job.stop = true;
          job.wake?.();
          continue;
        }
        void job.sink?.abort().catch(() => undefined);
        jobs.delete(i);
        if (rows[i]!.state !== "done") set(i, { ...IDLE(rows[i]!.total), state: "failed", reason: "gone" });
      }
      if (zipJob && (active !== "zip" || zipJob.job.paused)) {
        zipJob.job.stop = true;
        zipJob.job.wake?.();
        if (active !== "zip") {
          void zipJob.spec.abort().catch(() => undefined);
          zipJob = null;
          zip = null;
        }
      }
    },
    /** Sortie de l'écran (Terminer, détruire) : tout s'arrête, partiels supprimés. */
    dispose() {
      closed = true;
      queue.length = 0;
      for (const [i, job] of jobs) {
        job.stop = true;
        job.wake?.();
        if (active !== i) void job.sink?.abort().catch(() => undefined);
      }
      if (zipJob) {
        zipJob.job.stop = true;
        zipJob.job.wake?.();
        if (active !== "zip") void zipJob.spec.abort().catch(() => undefined);
      }
    },
  };
}
export type Downloads = ReturnType<typeof createDownloads>;

/** Résumé d'un groupe de lignes (catégorie, tout) : pour les en-têtes et la barre d'actions. */
export function summarize(rows: readonly Row[], items: readonly number[]) {
  let total = 0;
  let done = 0;
  let rate = 0;
  const count: Record<RowState, number> = { idle: 0, queued: 0, downloading: 0, paused: 0, done: 0, failed: 0 };
  for (const i of items) {
    const r = rows[i];
    if (!r) continue;
    count[r.state]++;
    total += r.total;
    done += r.state === "done" ? r.total : r.done;
    rate += r.rate;
  }
  const active = count.queued + count.downloading + count.paused;
  return { total, done, rate, count, active, retryable: items.filter((i) => rows[i]?.state === "failed" && rows[i]!.retryable) };
}

/** Secondes restantes à `bytesPerS` (null si inconnu). */
export function remainingSeconds(bytes: number, bytesPerS: number | null): number | null {
  if (bytesPerS === null || !(bytesPerS > 0)) return null;
  return Math.max(0, bytes) / bytesPerS;
}
