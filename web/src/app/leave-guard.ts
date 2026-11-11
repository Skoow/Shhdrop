// Garde de sortie par le bouton Retour (audit I2) : pendant un envoi et sur « Lien prêt », le
// Retour du navigateur ou du téléphone ne doit pas faire perdre le lien sans prévenir. Une
// entrée d'historique de garde (même adresse, état marqué, aucun secret) est ajoutée au début
// de l'envoi (clic : activation de l'utilisateur, sans quoi Chrome peut sauter l'entrée) ; un
// Retour qui la quitte demande confirmation : refus → l'entrée est remise et on reste ; accord →
// `onleave` (annulation, oubli des secrets), puis le vrai retour. Fermer l'onglet ou quitter le
// site reste couvert par `beforeunload`.

export const STAY_MARK = "shhStay";

export type LeaveGuard = {
  /** Demande à la personne si elle veut vraiment quitter (vrai : quitter). */
  confirm: () => boolean;
  /** Sortie confirmée : arrêter l'envoi, oublier les secrets. */
  onleave: () => void;
};

export type HistoryWindow = {
  history: Pick<History, "state" | "pushState" | "back">;
  location: Pick<Location, "pathname" | "search">;
};

export function createLeaveGuard(w: HistoryWindow) {
  let active: { g: LeaveGuard; url: string } | null = null;
  /** Retours lancés par la garde elle-même (retrait de son entrée) : absorbés. */
  let skip = 0;
  const marked = () => (w.history.state as Record<string, unknown> | null)?.[STAY_MARK] === true;
  const here = () => w.location.pathname + w.location.search;

  return {
    /** Arme la garde ; rend la fonction qui la désarme (et retire son entrée si elle est au sommet). */
    arm(g: LeaveGuard): () => void {
      const url = here();
      if (!marked()) w.history.pushState({ [STAY_MARK]: true }, "", url);
      const entry = { g, url };
      active = entry;
      return () => {
        if (active !== entry) return;
        active = null;
        if (marked()) {
          skip++;
          w.history.back();
        }
      };
    },
    /** Navigation voulue par le code (démo « Ouvrir comme destinataire ») : plus de garde, rien n'est retiré. */
    release(): void {
      active = null;
    },
    /** À appeler au début de chaque popstate : vrai si l'événement est absorbé (route inchangée). */
    onPop(): boolean {
      if (skip > 0) {
        skip--;
        return true;
      }
      if (!active) return false;
      if (marked()) return true; // retour sur l'entrée de garde (Avancer) : rien à faire
      const { g, url } = active;
      if (!g.confirm()) {
        w.history.pushState({ [STAY_MARK]: true }, "", url);
        return true;
      }
      active = null;
      g.onleave();
      // Seule l'entrée de garde a été quittée : on est encore sur la page de l'envoi, le vrai
      // retour reste à faire. Sinon (saut de plusieurs entrées), le routeur suit l'adresse.
      if (here() !== url) return false;
      w.history.back();
      return true;
    },
  };
}

export type LeaveGuardHandle = ReturnType<typeof createLeaveGuard>;
