// Surveillance de la disparition d'un partage ouvert (spec §41.8, cas 1 et 2) : une requête
// tenue au plus 25 s par le serveur, relancée en boucle tant que la page est visible et active.
// S'arrête : page cachée (reprend au retour), 30 min sans activité (reprend à la suivante),
// partage disparu (onGone, une fois), réponse inattendue ("stop"), ou stop(). Aucun secret
// ici : `poll` porte lui-même le jeton de téléchargement (Opened.watch).
export type WatchPoll = (signal: AbortSignal) => Promise<"alive" | "gone" | "stop">;

export type WatchDeps = {
  now: () => number;
  /** Visibilité de la page (document.visibilityState === "visible"). */
  visible: () => boolean;
  /** Abonnement aux événements qui relancent (visibilitychange, activité) ; rend le désabonnement. */
  listen: (wake: (activity: boolean) => void) => () => void;
  /** Attente entre deux requêtes (une réponse instantanée ne doit pas tourner en boucle serrée). */
  pause: (ms: number) => Promise<void>;
};

/** Inactivité au-delà de laquelle la surveillance s'arrête (spec §41.4 : 30 min). */
export const IDLE_MS = 30 * 60_000;
/** Écart minimal entre deux requêtes de surveillance. */
export const MIN_GAP_MS = 1_000;

export function startWatch(poll: WatchPoll, onGone: () => void, deps: WatchDeps): { stop(): void } {
  let stopped = false;
  let running = false;
  let lastActivity = deps.now();
  let ac: AbortController | null = null;

  const active = () => deps.visible() && deps.now() - lastActivity < IDLE_MS;

  async function loop(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped && active()) {
        const started = deps.now();
        ac = new AbortController();
        let r: "alive" | "gone" | "stop";
        try {
          r = await poll(ac.signal);
        } catch {
          if (stopped || ac.signal.aborted) return;
          r = "stop";
        } finally {
          ac = null;
        }
        if (stopped) return;
        if (r === "gone") {
          stopped = true;
          off();
          onGone();
          return;
        }
        if (r === "stop") {
          stopped = true;
          off();
          return;
        }
        const spent = deps.now() - started;
        if (spent < MIN_GAP_MS) await deps.pause(MIN_GAP_MS - spent);
      }
    } finally {
      running = false;
    }
  }

  const off = deps.listen((activity) => {
    if (activity) lastActivity = deps.now();
    if (!deps.visible()) ac?.abort(); // page cachée : la requête tenue est relâchée
    else void loop();
  });
  void loop();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      ac?.abort();
      off();
    },
  };
}

/** Dépendances du navigateur. */
export function browserWatchDeps(): WatchDeps {
  return {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    listen: (wake) => {
      const vis = () => wake(false);
      const act = () => wake(true);
      document.addEventListener("visibilitychange", vis);
      for (const ev of ["pointerdown", "keydown", "scroll"]) window.addEventListener(ev, act, { passive: true });
      return () => {
        document.removeEventListener("visibilitychange", vis);
        for (const ev of ["pointerdown", "keydown", "scroll"]) window.removeEventListener(ev, act);
      };
    },
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
