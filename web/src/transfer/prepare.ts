// Défi anti-robot récupéré à l'avance (pré-calcul de la preuve de travail, UI §9.4.2, Q2) :
// l'écran lance la preuve dès le premier élément composé, sans jamais appeler /api/captcha
// lui-même. Le jeton shown_at, le sel, l'origine et l'instant de réception restent internes
// (WeakMap) : l'objet rendu est opaque et figé, et un objet forgé par l'appelant est ignoré.
import * as api from "./api";
import { checkOrigin } from "./link";
import { senderError } from "./client";

export type PreparedCaptcha = {
  /** Défi à résoudre (réponse du serveur sans shown_at ni fallback). */
  readonly challenge: unknown;
  /** Origine du cadre de vérification du repli ; null si le repli est désactivé. */
  readonly fallbackOrigin: string | null;
  /**
   * Fin de validité du défi sur l'horloge monotone du client : à comparer à
   * performance.now(), jamais à Date.now() ni à une heure du serveur. Réception + 2 min au
   * plus (moins si le serveur l'indique avec un en-tête Date).
   */
  readonly expiresAt: number;
};

type Internal = { origin: string; cap: api.Captcha };
const internal = new WeakMap<PreparedCaptcha, Internal>();

/** Lit un défi (GET /api/captcha) et note l'instant de réception. Utilisé aussi par createShare. */
export async function readCaptcha(c: api.Ctx): Promise<PreparedCaptcha> {
  const cap = await api.captcha(c);
  const p: PreparedCaptcha = Object.freeze({ challenge: cap.challenge, fallbackOrigin: cap.fallbackOrigin, expiresAt: cap.expiresAt });
  internal.set(p, { origin: c.origin, cap });
  return p;
}

/**
 * Défi préparé pour `origin`, à usage unique : rendu une seule fois (le serveur consomme
 * le sel à la création), sinon undefined (objet forgé, déjà utilisé ou autre origine).
 */
export function takeCaptcha(p: PreparedCaptcha, origin: string): api.Captcha | undefined {
  const i = internal.get(p);
  if (i === undefined || i.origin !== origin) return undefined;
  internal.delete(p);
  return i.cap;
}

/**
 * Récupère un défi à l'avance pour CreateOpts.prepared. createShare s'en sert s'il reste
 * plus de 15 s de validité. Erreurs : comme createShare (Error("reseau"), LimitError…).
 */
export async function prepareCaptcha(origin: string, net?: api.Net): Promise<PreparedCaptcha> {
  checkOrigin(origin);
  try {
    return await readCaptcha(api.ctx(origin, net));
  } catch (e) {
    throw senderError(e);
  }
}
