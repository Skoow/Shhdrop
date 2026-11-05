// Compte à rebours (UI §8 Countdown, §11). Horloges injectées (millisecondes). Le temps écoulé
// est le plus grand des deux écarts, monotone et mural : l'horloge monotone peut s'arrêter
// pendant la veille (iOS), la murale continue ; la murale peut reculer ou sauter, la monotone
// non. Pire cas d'un saut d'heure en avant : une expiration affichée trop tôt, sans danger (le
// serveur reste l'autorité).
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

export function createCountdown(expiresInS: number, now?: () => number, wall?: () => number): Countdown {
  const mono = now ?? (() => performance.now());
  const clock = wall ?? (now ? now : () => Date.now()); // horloge injectée seule : elle sert aux deux
  const total = Number.isFinite(expiresInS) ? Math.max(0, expiresInS) : 0;
  const start = mono();
  const wallStart = clock();
  const remaining = () => {
    // Une horloge qui recule ne rallonge pas l'échéance.
    const elapsed = Math.max(0, mono() - start, clock() - wallStart);
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
