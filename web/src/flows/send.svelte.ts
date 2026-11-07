// Flux d'envoi (UI §9.4) : phases, mesures, coupure, pause, annulation, erreurs et ordre des
// essais anti-robot autour de createShare. Aucune clé ici : le mot de passe n'est gardé que
// dans `result`, le lien et le lien de gestion n'existent qu'après la résolution.
import {
  LimitError,
  NotFoundError,
  SERVER_STALL_MS,
  type CaptchaCtx,
  type CaptchaProof,
  type CreateOpts,
  type Item,
  type KeepTtl,
  type Rights,
  type TtlHours,
} from "../index";
import { createStats } from "./stats";

/** Pause bornée à 10 min (UI §9.4.4). */
export const PAUSE_MAX_MS = 600_000;
/** Limite d'un envoi, mesurée depuis la création (spec §7.4, §41.2 : 6 h jusqu'à 2 Gio). */
export const UPLOAD_WINDOW_MS = 6 * 3600_000;
/** Aucun octet depuis 10 s pendant l'envoi → coupure affichée (sans rapport avec SERVER_STALL_MS). */
export const STALL_MS = 10_000;
/** La pause est refusée s'il reste moins de 15 min avant la limite de 6 h. */
export const PAUSE_MIN_LEFT_MS = 15 * 60_000;
const TICK_MS = 250;

export type Phase = "idle" | "keys" | "captcha" | "fallback" | "upload" | "paused" | "offline" | "finalize" | "sealed" | "cancelled" | "error";
export type SendError = "reseau" | "interrompu" | "limite" | "plein" | "gele" | "captcha" | "fichier_modifie" | "inattendu";
/** Coches sous la capsule (benchmark M3) : chacune seulement après un progrès réel. */
export type Step = "chiffre" | "envoye" | "scelle";

type Prepared = NonNullable<CreateOpts["prepared"]>;
type Created = { link: string; manage: string; expiresInS: number };

export type SendDeps = {
  createShare: (origin: string, items: Item[], opts: CreateOpts) => Promise<Created>;
  solveCaptcha: (challenge: unknown, ctx: CaptchaCtx) => Promise<CaptchaProof>;
  /** Preuve pré-calculée (Task 14) ; absent en démo. */
  prefetcher?: { take(): Prepared | undefined; stop(): void };
  now?: () => number;
  wakeLock?: { acquire(): void; release(): void };
  /** Arme (true) ou désarme (false) la garde `beforeunload`. */
  onBeforeUnload?: (armed: boolean) => void;
  /** Une coche vient de s'allumer (annonce polie, une par étape). */
  onStep?: (s: Step) => void;
  /** La pause a pris fin d'elle-même (annonce). */
  onAutoResume?: () => void;
};

export type SendOpts = {
  origin: string;
  base: string;
  ttlHours: TtlHours;
  maxOpens: number;
  password: string;
  rights?: Rights;
  keepTtlH?: KeepTtl;
};

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "");

/** Élément illisible (fichier modifié ou déplacé) : premier fichier dont la lecture échoue. */
async function unreadable(items: Item[]): Promise<number | undefined> {
  for (let i = 0; i < items.length; i++) {
    const d = items[i]!.data;
    if (!(d instanceof Blob)) continue;
    try {
      await d.slice(0, 1).arrayBuffer();
    } catch {
      return i;
    }
  }
  return undefined;
}

export function createSender(deps: SendDeps) {
  const now = deps.now ?? (() => Date.now());
  const stats = createStats(now);

  let phase = $state<Phase>("idle");
  let sent = $state(0);
  let total = $state(0);
  let segments = $state({ done: 0, total: 0 });
  let retry = $state<{ inMs: number; offline: boolean; at: number } | undefined>();
  let error = $state<SendError | undefined>();
  let retryAfterS = $state<number | undefined>();
  let retryAt = $state<number | undefined>();
  let failedItem = $state<number | undefined>();
  let captchaLocal = $state(false);
  let createdOnServer = $state(false);
  let createdAt = $state<number | undefined>();
  let lastAckAt = $state(0);
  let pausing = $state(false);
  let resumeAt = $state<number | undefined>();
  let steps = $state<Step[]>([]);
  let result = $state.raw<(Created & { password: string }) | undefined>();
  let restoredAt = $state<number | undefined>();
  /** Horloge relue par les getters (comptes à rebours). */
  let clock = $state(now());

  let items: Item[] = [];
  let opts: SendOpts | undefined;
  let ac: AbortController | undefined;
  let run = 0;
  let lastByteAt = 0;
  let releasePause: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const cancellable = () => ["keys", "captcha", "fallback", "upload", "paused", "offline"].includes(phase);

  function step(s: Step) {
    if (steps.includes(s)) return;
    steps = [...steps, s];
    deps.onStep?.(s);
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(onTick, TICK_MS);
  }
  function stopTimer() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }
  function onTick() {
    const t = now();
    clock = t;
    if (phase === "upload" && t - lastByteAt >= STALL_MS) {
      phase = "offline";
      retry = undefined;
    }
    if (phase === "paused" && resumeAt !== undefined && t >= resumeAt) {
      resume();
      deps.onAutoResume?.();
    }
  }

  function end() {
    stopTimer();
    deps.wakeLock?.release();
    deps.onBeforeUnload?.(false);
    releasePause?.();
    releasePause = undefined;
    pausing = false;
    resumeAt = undefined;
  }

  function backOnline() {
    if (phase !== "offline") return;
    phase = "upload";
    retry = undefined;
    restoredAt = now();
    stats.reset();
  }

  function resetRun() {
    sent = total = 0;
    segments = { done: 0, total: 0 };
    retry = undefined;
    error = undefined;
    retryAfterS = retryAt = failedItem = undefined;
    captchaLocal = false;
    createdOnServer = false;
    createdAt = undefined;
    pausing = false;
    resumeAt = undefined;
    steps = [];
    restoredAt = undefined;
  }

  async function fail(e: unknown, id: number) {
    let code: SendError = "inattendu";
    if (e instanceof LimitError) {
      code = "limite";
      retryAfterS = e.retryAfterS;
      retryAt = now() + e.retryAfterS * 1000;
    } else if (e instanceof NotFoundError) code = "interrompu";
    else if (e instanceof DOMException && (e.name === "NotReadableError" || e.name === "NotFoundError")) {
      code = "fichier_modifie";
      const i = await unreadable(items);
      if (id !== run) return;
      failedItem = i;
    } else if (errMsg(e) === "reseau") code = "reseau";
    else if (errMsg(e) === "full") code = "plein";
    else if (errMsg(e) === "frozen") code = "gele";
    error = code;
    phase = "error";
    end();
  }

  async function go(): Promise<void> {
    const id = ++run;
    const o = opts!;
    resetRun();
    phase = "keys";
    ac = new AbortController();
    const signal = ac.signal;
    deps.wakeLock?.acquire();
    deps.onBeforeUnload?.(true);
    startTimer();

    // Ordre des essais (UI §9.4.2) : (1) preuve pré-calculée ou preuve de travail ; (2) preuve
    // de travail sans pré-calcul ; (3) repli Google seulement si fallbackOrigin ≠ null.
    let fallbackOrigin: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const mode: CaptchaCtx["mode"] = attempt === 3 ? "fallback" : "pow";
      let solverFailed = false;
      const live = () => id === run && !signal.aborted;
      let prepared: Prepared | undefined;
      if (attempt === 1) {
        const p = deps.prefetcher?.take();
        if (p) {
          fallbackOrigin = p.cap.fallbackOrigin;
          prepared = {
            cap: p.cap,
            proof: p.proof.catch((e: unknown) => {
              solverFailed = true;
              throw e;
            }),
          };
        }
      }
      try {
        const r = await deps.createShare(o.origin, items, {
          base: o.base,
          ttlHours: o.ttlHours,
          maxOpens: o.maxOpens,
          password: o.password,
          rights: o.rights,
          keepTtlH: o.keepTtlH,
          prepared,
          signal,
          solveCaptcha: async (challenge, ctx) => {
            fallbackOrigin = ctx.fallbackOrigin;
            if (live()) phase = mode === "fallback" ? "fallback" : "captcha";
            try {
              return await deps.solveCaptcha(challenge, { fallbackOrigin: ctx.fallbackOrigin, mode });
            } catch (e) {
              solverFailed = true;
              throw e;
            }
          },
          onProgress: (done, n) => {
            if (!live()) return;
            const t = now();
            segments = { done, total: n };
            lastAckAt = lastByteAt = t;
            if (done === 0) {
              createdOnServer = true;
              createdAt ??= t;
              if (phase === "keys" || phase === "captcha" || phase === "fallback") phase = "upload";
            } else backOnline();
            if (done === n && n > 0) {
              step("chiffre");
              step("envoye");
              if (phase === "upload" || phase === "offline") phase = "finalize";
            }
          },
          onBytes: (s, n) => {
            if (!live()) return;
            const grew = s > sent;
            sent = s;
            total = n;
            stats.push(s, n);
            if (grew) {
              lastByteAt = now();
              backOnline();
            }
            if (n > 0 && s >= n) {
              step("chiffre");
              if (phase === "upload" || phase === "offline") phase = "finalize";
            }
          },
          onRetry: (r) => {
            if (!live() || phase === "paused") return;
            phase = "offline";
            retry = { inMs: r.inMs, offline: r.offline, at: now() };
          },
          pause: () => {
            if (!live() || !pausing) return;
            pausing = false;
            phase = "paused";
            const t = now();
            resumeAt = Math.min(t + PAUSE_MAX_MS, lastAckAt + SERVER_STALL_MS);
            deps.wakeLock?.release();
            return new Promise<void>((res) => (releasePause = res));
          },
        });
        if (!live()) return;
        result = { ...r, password: o.password };
        step("chiffre");
        step("envoye");
        step("scelle");
        phase = "sealed";
        end();
        return;
      } catch (e) {
        if (id !== run || signal.aborted || isAbort(e)) return;
        const captchaFailed = !createdOnServer && (errMsg(e) === "bad_request" || solverFailed);
        if (captchaFailed) {
          const next = attempt + 1;
          if (next === 2 || (next === 3 && fallbackOrigin !== null)) {
            phase = "keys";
            continue;
          }
          captchaLocal = solverFailed;
          error = "captcha";
          phase = "error";
          end();
          return;
        }
        await fail(e, id);
        return;
      }
    }
  }

  function resume() {
    if (phase === "paused") {
      phase = "upload";
      resumeAt = undefined;
      lastByteAt = now();
      stats.reset();
      deps.wakeLock?.acquire();
      const r = releasePause;
      releasePause = undefined;
      r?.();
    } else pausing = false;
  }

  return {
    get phase() {
      return phase;
    },
    get sent() {
      return sent;
    },
    get total() {
      return total;
    },
    get segments() {
      return segments;
    },
    /** Dernier onRetry (le brief nommait ce champ `retry`, déjà pris par la méthode retry()). */
    get netRetry() {
      return retry;
    },
    /** Temps restant avant le nouvel essai annoncé par onRetry. */
    get retryLeftMs() {
      return retry ? Math.max(0, retry.at + retry.inMs - clock) : undefined;
    },
    get pauseLeftMs() {
      return phase === "paused" && resumeAt !== undefined ? Math.max(0, resumeAt - Math.max(clock, now())) : undefined;
    },
    /** Temps pendant lequel le serveur garde l'envoi sans nouveau segment (échéance unique). */
    get keptMs() {
      return createdOnServer ? Math.max(0, lastAckAt + SERVER_STALL_MS - clock) : undefined;
    },
    get pausing() {
      return pausing;
    },
    get canPause() {
      void clock;
      return phase === "upload" && !pausing && createdAt !== undefined && createdAt + UPLOAD_WINDOW_MS - now() >= PAUSE_MIN_LEFT_MS;
    },
    get tooSlow() {
      void clock;
      void sent;
      if (createdAt === undefined || (phase !== "upload" && phase !== "offline")) return false;
      const eta = stats.eta();
      return eta !== null && eta * 1000 > createdAt + UPLOAD_WINDOW_MS - now();
    },
    /** Octets par seconde (null : pas encore mesurée, ou masquée en pause et pendant une coupure). */
    get rate() {
      void sent;
      void clock;
      return phase === "upload" ? stats.rate() : null;
    },
    get eta() {
      void sent;
      void clock;
      return phase === "upload" ? stats.eta() : null;
    },
    get percent() {
      void sent;
      void total;
      return stats.percent();
    },
    get restoredAt() {
      return restoredAt;
    },
    get error() {
      return error;
    },
    get retryAfterS() {
      return retryAfterS;
    },
    /** Secondes avant que Réessayer se réactive après une LimitError. */
    get retryWaitS() {
      return retryAt === undefined ? 0 : Math.max(0, Math.ceil((retryAt - clock) / 1000));
    },
    get failedItem() {
      return failedItem;
    },
    get captchaLocal() {
      return captchaLocal;
    },
    get createdOnServer() {
      return createdOnServer;
    },
    get steps() {
      return steps;
    },
    get result() {
      return result;
    },
    get cancellable() {
      return cancellable();
    },

    async start(list: Item[], o: SendOpts): Promise<void> {
      if (phase !== "idle") return;
      items = list;
      opts = o;
      await go();
    },
    pause(): void {
      if (this.canPause) pausing = true;
    },
    resume,
    /** Coupure signalée par l'événement `offline` du navigateur. */
    markOffline(): void {
      if (phase === "upload") {
        phase = "offline";
        retry = undefined;
      }
    },
    cancel(): void {
      if (!cancellable()) return;
      run++;
      ac?.abort();
      deps.prefetcher?.stop();
      phase = "cancelled";
      steps = [];
      end();
    },
    async retry(): Promise<void> {
      if (phase !== "error" || opts === undefined) return;
      if (retryAt !== undefined && now() < retryAt) return;
      await go();
    },
    /** Oublie le résultat (Terminé, Supprimer) : les chaînes ne sont plus référencées ici. */
    forget(): void {
      result = undefined;
      items = [];
      opts = undefined;
    },
  };
}

export type Sender = ReturnType<typeof createSender>;
