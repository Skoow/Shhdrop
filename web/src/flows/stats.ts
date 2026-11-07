// Mesures de l'envoi (UI §9.4.1) : vitesse en moyenne mobile exponentielle sur 3 s des
// octets de onBytes, temps restant et pourcentage. Fonctions pures du temps injecté.

const TAU_S = 3;
const RATE_AFTER_MS = 3000;
const ETA_AFTER_MS = 5000;

export type Stats = {
  push(sent: number, total: number): void;
  /** Octets par seconde ; null avant 3 s de mesure. */
  rate(): number | null;
  /** Secondes restantes ; null avant 5 s de mesure ou si la vitesse est nulle. */
  eta(): number | null;
  /** Arrondi à l'entier inférieur : jamais 100 avant le dernier octet. */
  percent(): number;
  /** Nouvelle mesure (reprise après une pause ou une coupure) ; les octets restent. */
  reset(): void;
};

export function createStats(now: () => number): Stats {
  let sent = 0;
  let total = 0;
  let t0: number | null = null;
  let lastT = 0;
  let lastSent = 0;
  let v: number | null = null;

  return {
    push(s, tot) {
      const t = now();
      total = tot;
      if (t0 === null) {
        t0 = lastT = t;
        lastSent = sent = s;
        return;
      }
      sent = s;
      const dt = (t - lastT) / 1000;
      if (dt <= 0) return;
      const inst = Math.max(0, s - lastSent) / dt;
      v = v === null ? inst : v + (1 - Math.exp(-dt / TAU_S)) * (inst - v);
      lastT = t;
      lastSent = s;
    },
    rate() {
      if (t0 === null || v === null || now() - t0 < RATE_AFTER_MS) return null;
      return v;
    },
    eta() {
      if (t0 === null || now() - t0 < ETA_AFTER_MS) return null;
      const r = this.rate();
      if (r === null || r <= 0) return null;
      return Math.max(0, total - sent) / r;
    },
    percent() {
      if (total <= 0) return 0;
      if (sent >= total) return 100;
      return Math.min(99, Math.floor((100 * sent) / total));
    },
    reset() {
      if (t0 !== null) t0 = lastT = now();
      lastSent = sent;
      v = null;
    },
  };
}
