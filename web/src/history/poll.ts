// Relectures de l'état des partages de l'historique (spec §33, §33.1 ; UI §9.6.5). Ce que voit
// le serveur : un GET /api/manage/status par relecture. Pour que l'accueil ou « Vos envois » ne
// soient pas une salve de requêtes qui relierait en direct les partages d'une même connexion :
// - jamais en arrière-plan, jamais si la page n'est pas visible, jamais au chargement de
//   l'accueil (l'appelant décide : affichage de « Vos envois », « Actualiser », carte dépliée) ;
// - au plus une fois toutes les 5 min par partage (la création compte comme un état connu) ;
// - une gigue de 0,5 à 4 s avant chaque requête, et les partages relus l'un après l'autre.
// Reste visible au serveur, en direct : une même connexion interroge plusieurs partages (§18.18).
import { LimitError, NotFoundError } from "../index";
import { effectiveState, isActive, type History, type HistoryEntry, type Patch } from "./store";

export const REFRESH_MIN_MS = 5 * 60_000;
export const JITTER_MIN_MS = 500;
export const JITTER_MAX_MS = 4000;

export type Status = { opensUsed: number; maxOpens: number; expiresInS: number; state: string };
export type PollDeps = {
  manageStatus: (manage: string) => Promise<Status>;
  manageDestroy?: (manage: string) => Promise<void>;
  now: () => number;
  visible: () => boolean;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};
export type PollError = "reseau" | "limite" | "serveur";
export type RefreshResult =
  | { kind: "updated"; entry: HistoryEntry }
  | { kind: "skipped"; reason: "fresh"; nextAt: number }
  | { kind: "skipped"; reason: "hidden" | "ended" | "missing" | "stopped" }
  | { kind: "error"; error: PollError; retryAfterS?: number };
export type DestroyResult = { kind: "destroyed"; entry?: HistoryEntry } | { kind: "error"; error: PollError };

function errorOf(e: unknown): { error: PollError; retryAfterS?: number } {
  if (e instanceof LimitError) return { error: "limite", retryAfterS: e.retryAfterS };
  if (e instanceof Error && e.message === "reseau") return { error: "reseau" };
  return { error: "serveur" };
}
const notFound = (e: unknown) => e instanceof NotFoundError || (e instanceof Error && e.message === "lien_invalide");

/** Relecture réussie à l'heure `t` : ouvertures (changement noté entre deux relectures), échéance, état. */
export function statusPatch(cur: HistoryEntry, s: Status, t: number): Patch {
  const opens = s.opensUsed > cur.opensUsed ? [...cur.opens, { count: s.opensUsed, between: [cur.lastSeenAt, t] as [number, number] }] : cur.opens;
  return {
    opensUsed: s.opensUsed,
    maxOpens: Math.max(1, s.maxOpens),
    expiresAt: t + Math.max(0, s.expiresInS) * 1000,
    state: s.state === "draining" ? "draining" : "ready",
    opens,
    lastSeenAt: t,
  };
}
/** Partage absent du serveur à l'heure `t` : expiré si l'échéance est passée, sinon terminé. */
export function missingPatch(e: HistoryEntry, t: number): Patch {
  const expired = t >= e.expiresAt;
  return { state: expired ? "expired" : "gone", endedAt: expired ? e.expiresAt : t, lastSeenAt: t };
}
/** Détruit depuis cet appareil à l'heure `t`. */
export const destroyedPatch = (t: number): Patch => ({ state: "gone", destroyedHere: true, endedAt: t, lastSeenAt: t });

export function pollHistory(h: Pick<History, "get" | "list" | "update">, deps: PollDeps) {
  // Dernière requête arrivée au serveur (réussie, 429, 5xx) : compte dans les 5 min.
  const attempted = new Map<string, number>();
  const pausedUntil = new Map<string, number>();
  const inflight = new Map<string, Promise<RefreshResult>>();
  // Parcours de start() en cours : stop() l'arrête (la page est quittée) ; une demande
  // explicite (« Actualiser ») n'en dépend pas.
  let pass: { off: boolean } | null = null;

  async function run(id: string, token?: { off: boolean }): Promise<RefreshResult> {
    const stopped = () => token?.off === true;
    if (stopped()) return { kind: "skipped", reason: "stopped" };
    if (!deps.visible()) return { kind: "skipped", reason: "hidden" };
    const e = await h.get(id);
    if (!e) return { kind: "skipped", reason: "missing" };
    const t0 = deps.now();
    if (!isActive(e, t0)) return { kind: "skipped", reason: "ended" };
    const nextAt = Math.max(e.lastSeenAt, attempted.get(id) ?? 0) + REFRESH_MIN_MS;
    const pause = pausedUntil.get(id) ?? 0;
    if (t0 < nextAt || t0 < pause) return { kind: "skipped", reason: "fresh", nextAt: Math.max(nextAt, pause) };
    await deps.sleep(Math.round(JITTER_MIN_MS + deps.random() * (JITTER_MAX_MS - JITTER_MIN_MS)));
    if (stopped()) return { kind: "skipped", reason: "stopped" };
    if (!deps.visible()) return { kind: "skipped", reason: "hidden" };
    let s: Status;
    try {
      s = await deps.manageStatus(e.manage);
    } catch (err) {
      const t = deps.now();
      if (notFound(err)) {
        attempted.set(id, t);
        const entry = await h.update(id, missingPatch(e, t));
        return entry ? { kind: "updated", entry } : { kind: "skipped", reason: "missing" };
      }
      const m = errorOf(err);
      // Une coupure réseau n'a pas atteint le serveur : un nouvel essai reste permis.
      if (m.error !== "reseau") attempted.set(id, t);
      if (m.retryAfterS !== undefined) pausedUntil.set(id, t + m.retryAfterS * 1000);
      return { kind: "error", ...m };
    }
    const t = deps.now();
    attempted.set(id, t);
    const cur = (await h.get(id)) ?? e;
    if (effectiveState(cur, t) === "gone") return { kind: "skipped", reason: "ended" }; // détruit pendant la relecture
    const entry = await h.update(id, statusPatch(cur, s, t));
    return entry ? { kind: "updated", entry } : { kind: "skipped", reason: "missing" };
  }

  function refreshOne(id: string, token?: { off: boolean }): Promise<RefreshResult> {
    const cur = inflight.get(id);
    if (cur) return cur;
    const p = run(id, token).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  return {
    refreshOne: (id: string) => refreshOne(id),
    /** Affichage de « Vos envois » : relit les partages actifs, l'un après l'autre. */
    async start(): Promise<void> {
      if (pass) pass.off = true;
      const token = (pass = { off: false });
      const t = deps.now();
      for (const e of await h.list()) {
        if (token.off) return;
        if (isActive(e, t)) await refreshOne(e.id, token);
      }
    },
    stop(): void {
      if (pass) pass.off = true;
      pass = null;
    },
    /** Détruire (geste de la personne : pas de gigue ni de limite). */
    async destroy(id: string): Promise<DestroyResult> {
      const e = await h.get(id);
      if (!e) return { kind: "destroyed" };
      try {
        await deps.manageDestroy!(e.manage);
      } catch (err) {
        if (!(err instanceof NotFoundError)) return { kind: "error", error: errorOf(err).error };
      }
      const t = deps.now();
      const entry = await h.update(id, destroyedPatch(t));
      return { kind: "destroyed", entry: entry ?? undefined };
    },
  };
}
export type Poller = ReturnType<typeof pollHistory>;
