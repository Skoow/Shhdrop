// Compte à rebours (UI §8 Countdown, §11). L'horloge est injectée (millisecondes, monotone par
// défaut : un changement d'heure du système ne rallonge ni ne raccourcit le partage affiché).
import { formatDuration, type Lang } from "../i18n/format";

/** Seuils annoncés aux lecteurs d'écran, en secondes : 1 h, 15 min, 5 min, 1 min, expiration. */
export const ANNOUNCE_THRESHOLDS = [3600, 900, 300, 60, 0] as const;

export type Countdown = {
  /** Secondes restantes, arrondies vers le haut, jamais négatives. */
  remaining(): number;
  display(lang: Lang): string;
  /** Seuil franchi depuis le dernier appel (le plus bas si plusieurs), sinon null. Une fois par seuil. */
  announceAt(): number | null;
};

export function createCountdown(expiresInS: number, now: () => number = () => performance.now()): Countdown {
  const total = Number.isFinite(expiresInS) ? Math.max(0, expiresInS) : 0;
  const start = now();
  const remaining = () => {
    const elapsed = Math.max(0, now() - start); // une horloge qui recule ne rallonge pas l'échéance
    return Math.max(0, Math.ceil((total * 1000 - elapsed) / 1000));
  };
  // Seuils déjà dépassés au départ : jamais annoncés (on n'annonce que ce qu'on voit franchir).
  const done = new Set<number>(ANNOUNCE_THRESHOLDS.filter((s) => s > 0 && s >= total));
  return {
    remaining,
    display: (lang) => formatDuration(remaining(), lang, { precise: true }),
    announceAt() {
      const r = remaining();
      let hit: number | null = null;
      for (const s of ANNOUNCE_THRESHOLDS) {
        if (r <= s && !done.has(s)) {
          done.add(s);
          hit = s; // la boucle descend : on garde le plus bas
        }
      }
      return hit;
    },
  };
}
