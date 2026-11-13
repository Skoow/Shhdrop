// Démo : dictionnaire anglais intégré au script (sa CSP, connect-src 'none', interdit tout fetch).
import { en } from "./en";

/** Dictionnaire déjà là (sans requête), ou undefined s'il faut le lire. */
export const bundled: Record<string, string> | undefined = en;

export function fetchEn(): Promise<unknown> {
  return Promise.resolve(en);
}
