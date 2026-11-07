// Disparition du partage pendant la lecture (spec §41.8, D41-10 ; tâche E1).
// À la cause (compte à rebours à zéro, refus du serveur pendant une lecture, signal de
// surveillance, destruction faite ici), l'interface se ferme TOUT DE SUITE : plus de liste,
// d'aperçu ni de nouvel enregistrement. Seuls les enregistrements déjà en cours continuent
// (leurs propres requêtes de segments) ; la fin de lecture (done, wipe, révocation) attend
// qu'ils aient fini. Rien de tout cela ne passe par le réseau (le serveur ne voit rien).
// Les noms montrés sont ceux de safeName (décision du propriétaire, 7 novembre).

export type GoneCause = "countdown" | "http410" | "watch410" | "destroyed-here";
export type TransferState = "running" | "done" | "failed";

export type Transfer = {
  readonly id: number;
  /** Nom nettoyé (safeName), pour l'écran de fin seulement. */
  readonly name: string;
  readonly total: number;
  readonly done: number;
  readonly state: TransferState;
};

export type Tracker = {
  progress(done: number): void;
  end(ok: boolean): void;
};

export type GoneDeps = {
  /** Fin de lecture complète : done(), wipe(), révocation des URL (endoflife.finish). */
  finish: () => Promise<void> | void;
  /** Révocation immédiate des URL blob des aperçus (viewers/blobs.revokeAll). */
  revokeAll: () => void;
};

export function createGone(deps: GoneDeps) {
  let seq = 0;
  let transfers = $state<Transfer[]>([]);
  let cause = $state<GoneCause | null>(null);
  /** Enregistrements en cours au moment de la fermeture : les seuls montrés ensuite. */
  let finishing = $state<number[]>([]);
  let finished = false;
  // Copie hors réactivité : Svelte rend aux fonctions de nettoyage (teardown) l'ancienne valeur
  // d'un $state ; le démontage de l'écran, déclenché par la fermeture elle-même, doit voir
  // « fermé ».
  let closedNow = false;

  const running = () => transfers.filter((x) => x.state === "running").length;
  const patch = (id: number, p: Partial<Transfer>) => (transfers = transfers.map((x) => (x.id === id ? { ...x, ...p } : x)));

  function maybeFinish() {
    if (cause === null || finished || running() > 0) return;
    finished = true;
    void Promise.resolve(deps.finish()).catch(() => undefined);
  }

  return {
    get cause() {
      return cause;
    },
    get closed() {
      return cause !== null;
    },
    /** Lecture non réactive, sûre dans un nettoyage d'effet. */
    closedNow(): boolean {
      return closedNow;
    },
    /** Enregistrements en cours à la fermeture, avec leur état à jour. */
    get finishing(): Transfer[] {
      return transfers.filter((x) => finishing.includes(x.id));
    },
    get running() {
      return running();
    },
    /** Un enregistrement commence (refusé après la fermeture : null). */
    begin(name: string, total: number): Tracker | null {
      if (cause !== null) return null;
      const id = ++seq;
      transfers = [...transfers, { id, name, total, done: 0, state: "running" }];
      return {
        progress: (done) => patch(id, { done }),
        end: (ok) => {
          const t = transfers.find((x) => x.id === id);
          if (!t || t.state !== "running") return;
          patch(id, { state: ok ? "done" : "failed", done: ok ? t.total : t.done });
          // Hors fermeture, l'entrée ne sert plus.
          if (cause === null) transfers = transfers.filter((x) => x.id !== id);
          maybeFinish();
        },
      };
    },
    /**
     * Ferme l'interface (idempotent : la première cause gagne). Les aperçus sont révoqués tout
     * de suite ; la fin de lecture attend les enregistrements en cours.
     */
    closeToGone(c: GoneCause): { finishing: number } {
      if (closedNow) return { finishing: finishing.length };
      closedNow = true;
      finishing = transfers.filter((x) => x.state === "running").map((x) => x.id);
      transfers = transfers.filter((x) => finishing.includes(x.id));
      cause = c;
      deps.revokeAll();
      maybeFinish();
      return { finishing: finishing.length };
    },
  };
}
export type Gone = ReturnType<typeof createGone>;
