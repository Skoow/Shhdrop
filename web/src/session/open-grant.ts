// Octroi d'ouverture gardé dans l'onglet (spec §41.4, UI §9.7.1) : seul module autorisé à
// toucher sessionStorage (source-rules.test.ts). Exception écrite à « aucun stockage
// navigateur » : l'entrée est propre à l'onglet. Elle ne disparaît PAS forcément à sa
// fermeture : Chromium l'écrit sur le disque du profil (« Session Storage ») et la rend à
// l'onglet restauré (audit M2, constaté par persist.spec.ts) ; d'où RESTORE_MS. Elle contient
// que K_lien (43 caractères, déjà dans le « # » du lien) et l'octroi : JAMAIS le mot de passe,
// R, une clé de contenu ni le clair. Sans mot de passe, elle n'ouvre rien ; elle évite
// seulement qu'un rechargement compte une ouverture de plus.

export const OPEN_GRANT_KEY = "shh.og";
/** 30 min sans activité (clic, touche, défilement, visibilité) : l'entrée est effacée. */
export const INACTIVITY_MS = 30 * 60_000;
/**
 * Audit M2 : hors rechargement (onglet fermé puis restauré, retour arrière), l'entrée ne vaut que
 * 2 min après la dernière sortie de page (`last`, posé à pagehide) : un rechargement prend
 * moins, une réouverture plus tardive redemande une ouverture.
 */
export const RESTORE_MS = 2 * 60_000;

export type OpenGrantEntry = { v: 1; link: string /* K_lien, 43 car. */; grant: string /* 54 car. */; last: number };

const LINK = /^[A-Za-z0-9_-]{43}$/;
const GRANT = /^[A-Za-z0-9_-]{54}$/;

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // stockage refusé (réglage du navigateur) : rien n'est gardé
  }
}

/** Écrit l'entrée (après un openShare réussi seulement) ; seuls les quatre champs sont copiés. */
export function saveOpenGrant(e: OpenGrantEntry): void {
  if (e.v !== 1 || !LINK.test(e.link) || !GRANT.test(e.grant) || !Number.isFinite(e.last)) return;
  try {
    store()?.setItem(OPEN_GRANT_KEY, JSON.stringify({ v: 1, link: e.link, grant: e.grant, last: e.last }));
  } catch {
    /* quota ou refus : le rechargement comptera une ouverture, comme sans octroi */
  }
}

/** Lit l'entrée ; toute forme inattendue est effacée et donne null. */
export function loadOpenGrant(): OpenGrantEntry | null {
  const s = store();
  let raw: string | null = null;
  try {
    raw = s?.getItem(OPEN_GRANT_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(o).sort().join(",");
    if (
      keys === "grant,last,link,v" &&
      o.v === 1 &&
      typeof o.link === "string" &&
      LINK.test(o.link) &&
      typeof o.grant === "string" &&
      GRANT.test(o.grant) &&
      typeof o.last === "number" &&
      Number.isFinite(o.last)
    ) {
      return { v: 1, link: o.link, grant: o.grant, last: o.last };
    }
  } catch {
    /* JSON invalide */
  }
  clearOpenGrant();
  return null;
}

export function clearOpenGrant(): void {
  try {
    store()?.removeItem(OPEN_GRANT_KEY);
  } catch {
    /* rien à effacer */
  }
}

/**
 * Garde d'inactivité : `touch()` à chaque activité ; 30 min sans activité → clearOpenGrant puis
 * onExpire (une fois, puis la garde s'arrête). `now` en millisecondes ; vérifiée à la minute
 * par `every` et à chaque touch (une activité après 30 min d'absence ne sauve pas l'entrée).
 */
export function startInactivityGuard(
  now: () => number,
  onExpire: () => void,
  every: (ms: number, f: () => void) => () => void = (ms, f) => {
    const id = setInterval(f, ms);
    return () => clearInterval(id);
  },
): { touch(): void; stop(): void; readonly stopped: boolean } {
  let last = now();
  let stopped = false;
  let off: () => void = () => undefined;
  const check = () => {
    if (stopped || now() - last < INACTIVITY_MS) return false;
    stopped = true;
    off();
    clearOpenGrant();
    onExpire();
    return true;
  };
  off = every(60_000, check);
  return {
    touch() {
      if (!check() && !stopped) last = now();
    },
    stop() {
      stopped = true;
      off();
    },
    get stopped() {
      return stopped;
    },
  };
}
