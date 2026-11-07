// Ouverture d'un partage par le destinataire (UI §9.7, §9.11, §12.1 ; spec §5.2, §32).
//
// Le lien (qui contient K_lien) est remis par valeur à createReceiver et ne vit que dans la
// fermeture : jamais dans l'état réactif exposé, un stockage, le titre ni la console. La barre
// d'adresse est nettoyée juste après la lecture (scrub), sauf dans un navigateur intégré
// d'application (S4), où le « # » reste jusqu'à « Continuer ici quand même ». Le mot de passe
// n'est jamais gardé : il ne vit que le temps de l'appel à unlock().
import type { LinkState } from "../app/link";
import { BadPasswordError, LimitError, NotFoundError, fetchMeta, openShare, type Opened } from "../index";

export type ReceiveState =
  | "meta" // fetchMeta en cours (squelette)
  | "inapp" // navigateur intégré : bandeau, rien n'est demandé au serveur
  | "locked"
  | "unlocking"
  | "open"
  | "invalid"
  | "destroyed_by_password"
  | "incomplete"
  | "error"; // fetchMeta impossible (réseau, limite) : Réessayer

/** Message affiché à l'état « locked » ou « error ». */
export type ReceiveError = "bad_password" | "password_required" | "limit" | "network" | null;

export type ReceiverDeps = {
  fetchMeta: (link: string, expectedOrigin: string) => Promise<{ expiresInS: number }>;
  openShare: (link: string, password: string, expectedOrigin: string) => Promise<Opened>;
  /** Horloge en millisecondes. */
  now: () => number;
  /** Nom de l'application dont le navigateur intégré affiche la page, ou null (app/env.ts). */
  inAppBrowser: () => string | null;
  /** Retire le « # » et la requête de l'adresse et de l'historique (app/link.ts). */
  scrub: () => void;
  /** Origine attendue des liens : location.origin. */
  origin: string;
};

export type Receiver = {
  readonly state: ReceiveState;
  /** Durée de vie restante lue par fetchMeta (secondes, au moment de la réponse). */
  readonly expiresInS: number;
  /** Secondes restantes, recalculées à chaque lecture (0 avant fetchMeta). */
  remainingS(): number;
  readonly attemptsLeft: number | undefined;
  readonly retryAfterS: number | undefined;
  readonly error: ReceiveError;
  /** Application du navigateur intégré (état « inapp »). */
  readonly app: string | null;
  readonly opened: Opened | undefined;
  continueHere(): void;
  unlock(password: string): Promise<void>;
  /** Compte à rebours à zéro avant le déverrouillage : « Lien invalide », sans requête (A22). */
  expire(): void;
  /** État « error » : relit fetchMeta. */
  retry(): Promise<void>;
  /** Fin de lecture (clés déjà effacées) : plus aucune référence au contenu déchiffré. */
  forget(): void;
};

const isCode = (e: unknown, code: string) => e instanceof Error && e.message === code;

export function createReceiver(link: LinkState, deps: Partial<ReceiverDeps> = {}): Receiver {
  const d: ReceiverDeps = {
    fetchMeta: (l, o) => fetchMeta(l, o),
    openShare: (l, p, o) => openShare(l, p, o),
    now: () => Date.now(),
    inAppBrowser: () => null,
    scrub: () => undefined,
    origin: typeof location === "undefined" ? "" : location.origin,
    ...deps,
  };

  // Seule référence au secret : oubliée dès qu'elle ne sert plus (ouvert, invalide, détruit).
  let secret: string | null = link.kind === "s" ? link.link : null;
  let expiresAt = 0;
  let limitedUntil = 0;
  let inflight = false;

  const s = $state({
    state: "meta" as ReceiveState,
    expiresInS: 0,
    attemptsLeft: undefined as number | undefined,
    retryAfterS: undefined as number | undefined,
    error: null as ReceiveError,
    app: null as string | null,
  });
  let opened = $state.raw<Opened | undefined>(undefined);

  const end = (state: "invalid" | "destroyed_by_password" | "incomplete") => {
    secret = null;
    s.state = state;
    s.error = null;
  };

  async function loadMeta(): Promise<void> {
    if (secret === null || inflight) return;
    inflight = true;
    s.state = "meta";
    s.error = null;
    try {
      const m = await d.fetchMeta(secret, d.origin);
      if (secret === null) return; // déjà terminé pendant l'attente
      expiresAt = d.now() + m.expiresInS * 1000;
      s.expiresInS = m.expiresInS;
      if (m.expiresInS <= 0) end("invalid");
      else s.state = "locked";
    } catch (e) {
      if (e instanceof NotFoundError || isCode(e, "lien_invalide") || isCode(e, "origine_invalide")) end("invalid");
      else if (e instanceof LimitError) {
        s.retryAfterS = e.retryAfterS;
        s.error = "limit";
        s.state = "error";
      } else {
        s.error = "network";
        s.state = "error";
      }
    } finally {
      inflight = false;
    }
  }

  function start(): void {
    if (secret === null) end("incomplete");
    else void loadMeta();
  }

  const app = d.inAppBrowser();
  if (app !== null) {
    // S4 : le « # » reste, pour « Ouvrir dans le navigateur » ; rien n'est demandé au serveur.
    s.app = app;
    if (secret === null) end("incomplete");
    else s.state = "inapp";
  } else {
    d.scrub();
    start();
  }

  const expired = () => expiresAt > 0 && d.now() >= expiresAt;

  return {
    get state() {
      return s.state;
    },
    get expiresInS() {
      return s.expiresInS;
    },
    remainingS() {
      return expiresAt === 0 ? 0 : Math.max(0, Math.ceil((expiresAt - d.now()) / 1000));
    },
    get attemptsLeft() {
      return s.attemptsLeft;
    },
    get retryAfterS() {
      return s.retryAfterS;
    },
    get error() {
      return s.error;
    },
    get app() {
      return s.app;
    },
    get opened() {
      return opened;
    },
    continueHere() {
      if (s.state !== "inapp") return;
      d.scrub();
      start();
    },
    expire() {
      if (s.state === "locked" || s.state === "meta" || s.state === "error") end("invalid");
    },
    async retry() {
      if (s.state === "error") await loadMeta();
    },
    forget() {
      secret = null;
      opened = undefined;
    },
    async unlock(password: string) {
      // Garde synchrone, avant tout await : un double appui ne fait qu'un appel.
      if (s.state !== "locked" || inflight || secret === null) return;
      if (expired()) return end("invalid");
      if (d.now() < limitedUntil) return;
      if (password === "") {
        s.error = "password_required";
        return;
      }
      inflight = true;
      s.state = "unlocking";
      s.error = null;
      try {
        const o = await d.openShare(secret, password, d.origin);
        secret = null; // les clés utiles sont dans Opened ; le lien ne sert plus
        opened = o;
        s.state = "open";
      } catch (e) {
        if (e instanceof BadPasswordError) {
          s.attemptsLeft = e.attemptsLeft;
          s.error = "bad_password";
          s.state = "locked";
        } else if (e instanceof NotFoundError) {
          // A23 : le dernier essai a échoué → le partage vient d'être détruit (la personne sait qu'il existait).
          end(s.attemptsLeft === 1 ? "destroyed_by_password" : "invalid");
        } else if (e instanceof LimitError) {
          s.retryAfterS = e.retryAfterS;
          limitedUntil = d.now() + e.retryAfterS * 1000;
          s.error = "limit";
          s.state = "locked";
        } else if (isCode(e, "mot_de_passe_requis")) {
          // Aucun essai consommé (refus local, avant toute requête).
          s.error = "password_required";
          s.state = "locked";
        } else if (isCode(e, "lien_invalide") || isCode(e, "origine_invalide")) {
          end("invalid");
        } else {
          // Réseau : on ne sait pas si une ouverture a été consommée (UI §9.7) ; rien n'est affirmé.
          s.error = "network";
          s.state = "locked";
        }
      } finally {
        inflight = false;
      }
    },
  };
}
