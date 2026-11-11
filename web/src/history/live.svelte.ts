// État partagé de l'historique pour les écrans (accueil, « Vos envois », « Lien prêt »).
// Ouvre le stockage une seule fois : IndexedDB en production, mémoire dans la démo (origine
// partagée de GitHub Pages : rien n'y est écrit) ; indisponible → `status: "unavailable"` et
// le site marche sans historique. Lire l'historique ne fait AUCUNE requête réseau ; les
// relectures passent par `refreshShare` (poll.ts : visible, 5 min, gigue).
import { getDemo } from "../app/demo-hooks";
import { destroyShare, shareStatus } from "../index";
import { pollHistory, type PollError, type Poller, type RefreshResult } from "./poll";
import { idbBackend, memoryBackend, openHistory, type Backend, type History, type HistoryEntry, type NewEntry } from "./store";

export type ShareInfo = {
  busy?: boolean;
  /** Dernière relecture échouée : l'entrée montre son dernier état connu, « non mis à jour ». */
  error?: PollError;
  retryAfterS?: number;
  /** Relecture refusée (moins de 5 min) : prochaine relecture possible à cette heure. */
  nextAt?: number;
  destroyError?: PollError;
};

export const shares = $state({
  status: "idle" as "idle" | "loading" | "ready" | "unavailable",
  entries: [] as HistoryEntry[],
  /** « Garder dans mon historique » (Q-H2 : activé par défaut). */
  enabled: true,
  info: {} as Record<string, ShareInfo>,
});

function backend(): Backend | null {
  if (getDemo()) return memoryBackend();
  try {
    const idb = globalThis.indexedDB;
    return idb ? idbBackend(idb) : null;
  } catch {
    return null; // accès refusé (certains navigateurs en navigation privée, cadres)
  }
}

let chosen: Backend | null | undefined;
const theBackend = () => (chosen === undefined ? (chosen = backend()) : chosen);

let opening: Promise<History | null> | undefined;
/** Ouvre l'historique, en le créant au besoin (clé, base) : seulement pour y écrire. */
function store(): Promise<History | null> {
  return (opening ??= openHistory({ backend: theBackend() }).catch(() => null));
}
/**
 * Ouvre sans rien créer : une simple visite (accueil, « Vos envois ») n'écrit rien dans le
 * navigateur tant qu'aucun partage n'a été gardé. « absent » : aucun historique encore.
 */
async function peek(): Promise<History | null | "absent"> {
  if (opening) return opening;
  const b = theBackend();
  if (!b) return null;
  try {
    if (!(await b.exists())) return "absent";
  } catch {
    return null;
  }
  return store();
}

let poller: Poller | undefined;
async function getPoller(): Promise<Poller | null> {
  const h = await store();
  if (!h) return null;
  return (poller ??= pollHistory(h, {
    manageStatus: (m) => shareStatus(m, location.origin),
    manageDestroy: (m) => destroyShare(m, location.origin),
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32,
  }));
}

async function reload(h: History): Promise<void> {
  shares.entries = await h.list();
}

/** Lecture locale (aucune requête). Sans effet si déjà lue, sauf `force`. */
export async function loadHistory(force = false): Promise<History | null> {
  if (shares.status === "ready" && !force) return opening ?? null;
  if (shares.status === "idle") shares.status = "loading";
  const h = await peek();
  if (h === "absent") {
    shares.entries = [];
    shares.enabled = true;
    shares.status = "ready";
    return null;
  }
  if (!h) {
    shares.status = "unavailable";
    return null;
  }
  try {
    const [list, enabled] = await Promise.all([h.list(), h.enabled()]);
    shares.entries = list;
    shares.enabled = enabled;
    shares.status = "ready";
    return h;
  } catch {
    shares.status = "unavailable";
    return null;
  }
}

/** « Lien prêt » : garde le partage (lien de gestion et mesures, jamais le lien ni le mot de passe). */
export async function recordShare(e: NewEntry): Promise<string | null> {
  const h = await store();
  if (!h) {
    shares.status = "unavailable";
    return null;
  }
  try {
    const got = await h.add(e);
    await reload(h);
    return got.id;
  } catch {
    return null;
  }
}

export async function forgetShare(id: string): Promise<void> {
  const h = await store();
  if (!h) return;
  await h.remove(id).catch(() => undefined);
  delete shares.info[id];
  await reload(h).catch(() => undefined);
}

export async function clearHistory(): Promise<void> {
  const h = await store();
  if (!h) return;
  await h.clear();
  shares.info = {};
  await reload(h);
}

export async function setHistoryEnabled(v: boolean): Promise<void> {
  const h = await store();
  if (!h) return;
  await h.setEnabled(v).catch(() => undefined);
  shares.enabled = v;
}

/** Marque un partage détruit ailleurs sur ce site (« Lien prêt », Supprimer). */
export async function markDestroyed(id: string): Promise<void> {
  const h = await store();
  if (!h) return;
  const t = Date.now();
  await h.update(id, { state: "gone", destroyedHere: true, endedAt: t, lastSeenAt: t }).catch(() => undefined);
  await reload(h).catch(() => undefined);
}

function apply(id: string, r: RefreshResult): void {
  const info: ShareInfo = {};
  if (r.kind === "error") {
    info.error = r.error;
    info.retryAfterS = r.retryAfterS;
  } else if (r.kind === "skipped" && r.reason === "fresh") info.nextAt = r.nextAt;
  shares.info[id] = info;
}

/** « Actualiser », carte dépliée : au plus une fois toutes les 5 min, après une gigue. */
export async function refreshShare(id: string): Promise<RefreshResult | null> {
  const p = await getPoller();
  if (!p) return null;
  shares.info[id] = { ...shares.info[id], busy: true };
  const r = await p.refreshOne(id);
  apply(id, r);
  const h = await store();
  if (h) await reload(h).catch(() => undefined);
  return r;
}

/** Affichage de « Vos envois » : relit les partages actifs dont l'état date de plus de 5 min. */
export async function refreshAll(): Promise<void> {
  const p = await getPoller();
  const h = await store();
  if (!p || !h) return;
  await p.start();
  await reload(h).catch(() => undefined);
}
export function stopRefresh(): void {
  poller?.stop();
}

/** Détruire : en un geste, depuis la carte. */
export async function destroyFromHistory(id: string): Promise<boolean> {
  const p = await getPoller();
  if (!p) return false;
  const r = await p.destroy(id);
  const h = await store();
  if (h) await reload(h).catch(() => undefined);
  if (r.kind === "error") {
    shares.info[id] = { ...shares.info[id], destroyError: r.error };
    return false;
  }
  shares.info[id] = {};
  return true;
}
