// Ouverture d'un partage par le destinataire (UI §9.7, §9.11, §12.1 ; spec §5.2, §32).
//
// Le lien (qui contient K_lien) est remis par valeur à createReceiver et ne vit que dans la
// fermeture : jamais dans l'état réactif exposé, un stockage, le titre ni la console. La barre
// d'adresse est nettoyée juste après la lecture (scrub), sauf dans un navigateur intégré
// d'application (S4), où le « # » reste jusqu'à « Continuer ici quand même ». Le mot de passe
// n'est jamais gardé : il ne vit que le temps de l'appel à unlock().
//
// Rechargement et autres onglets (spec §41.4, UI §9.7.1) : après un déverrouillage, K_lien et
// l'octroi d'ouverture sont gardés dans l'onglet (session/open-grant.ts, jamais le mot de
// passe) ; un rechargement (adresse sans « # ») passe à l'état « reopen » et rouvre la même
// ouverture, mot de passe ressaisi. Un nouvel onglet avec le lien demande l'octroi aux autres
// onglets (session/tabs.ts).
//
// Retour plus tard (D42-22) : l'octroi vaut jusqu'à l'échéance du partage ; il est aussi gardé
// chiffré dans le navigateur (history/returns.ts, jamais K_lien ni le mot de passe), sous
// l'étiquette du partage. Rouvrir le lien du message dans ce navigateur, même après avoir
// fermé l'onglet, passe à l'état « reopen » (mot de passe ressaisi, aucune ouverture de plus).
// Octroi gardé mais partage introuvable : « return_lost » (retour impossible, dit clairement).
import type { LinkState } from "../app/link";
import { pageReturns, type Returns } from "../history/returns";
import {
  BadPasswordError,
  GrantInvalidError,
  LimitError,
  NotFoundError,
  ReopenLimitError,
  ServerError,
  fetchMeta,
  grantTag,
  openShare,
  type Opened,
} from "../index";
import {
  INACTIVITY_MS,
  RESTORE_MS,
  clearOpenGrant,
  loadOpenGrant,
  saveOpenGrant,
  startInactivityGuard,
  type OpenGrantEntry,
} from "../session/open-grant";
import { answerOtherTabs, askOtherTabs } from "../session/tabs";

export type ReceiveState =
  | "meta" // fetchMeta en cours (squelette)
  | "inapp" // navigateur intégré : bandeau, rien n'est demandé au serveur
  | "locked"
  | "reopen" // rechargement après un déverrouillage : même écran, « Rouvrir », aucune ouverture de plus
  | "unlocking"
  | "open"
  | "invalid"
  | "destroyed_by_password"
  | "incomplete"
  | "return_lost" // octroi gardé ici, mais le serveur ne connaît plus le partage (D42-22)
  | "error"; // fetchMeta impossible (réseau, limite, serveur, maintenance) : page d'erreur, Réessayer

/** Message affiché à l'état « locked », ou page d'erreur de l'état « error » (tâche UP). */
export type ReceiveError =
  | "bad_password"
  | "password_required"
  | "limit"
  | "network"
  | "server"
  | "maintenance"
  | "grant_invalid" // l'ouverture précédente n'est plus reconnue : déverrouiller en utilisera une nouvelle
  | "reopen_limit" // trop de rechargements : une nouvelle ouverture sera comptée
  | null;

export type GrantStore = { load(): OpenGrantEntry | null; save(e: OpenGrantEntry): void; clear(): void };

export type ReceiverDeps = {
  fetchMeta: (link: string, expectedOrigin: string, grant?: string) => Promise<{ expiresInS: number; opensLeft: number }>;
  openShare: (link: string, password: string, expectedOrigin: string, grant?: string) => Promise<Opened>;
  /** Octroi gardé dans l'onglet (session/open-grant.ts). */
  grants: GrantStore;
  /** Étiquette du partage entre onglets (grantTag). */
  tag: (link: string, expectedOrigin: string) => Promise<string>;
  /** Octroi détenu en mémoire par un autre onglet (askOtherTabs), ou null. */
  askTabs: (tag: string) => Promise<string | null>;
  /** Répondre aux autres onglets (answerOtherTabs) ; rend l'arrêt. */
  answerTabs: (getGrant: (tag: string) => string | null) => () => void;
  /** Octrois gardés pour revenir jusqu'à l'échéance (history/returns.ts, D42-22). */
  returns: Returns;
  /** Minuterie répétée (garde d'inactivité) ; rend l'arrêt. */
  every: (ms: number, f: () => void) => () => void;
  /** Horloge en millisecondes. */
  now: () => number;
  /** Nom de l'application dont le navigateur intégré affiche la page, ou null (app/env.ts). */
  inAppBrowser: () => string | null;
  /** Retire le « # » et la requête de l'adresse et de l'historique (app/link.ts). */
  scrub: () => void;
  /** Origine attendue des liens : location.origin. */
  origin: string;
  /** Faux si le navigateur se sait hors ligne (navigator.onLine) : page « hors ligne » sans requête. */
  online: () => boolean;
  /** Type de la navigation qui a chargé la page (PerformanceNavigationTiming.type), "" inconnu. */
  navType: () => string;
  /** Sortie de la page (pagehide) ; rend l'arrêt. */
  onHide: (f: () => void) => () => void;
};

export type Receiver = {
  readonly state: ReceiveState;
  /** Durée de vie restante lue par fetchMeta (secondes, au moment de la réponse). */
  readonly expiresInS: number;
  /** Ouvertures restantes lues par fetchMeta (0 avant), pour « encore N fois » (ruling 5). */
  readonly opensLeft: number;
  /** Secondes restantes, recalculées à chaque lecture (0 avant fetchMeta). */
  remainingS(): number;
  readonly attemptsLeft: number | undefined;
  readonly retryAfterS: number | undefined;
  readonly error: ReceiveError;
  /** Application du navigateur intégré (état « inapp »). */
  readonly app: string | null;
  readonly opened: Opened | undefined;
  /** Un autre onglet de ce navigateur détient l'ouverture : l'ouvrir ici n'en compte pas d'autre. */
  readonly otherTab: boolean;
  /** Rechargement : l'écran dit « Rouvrir » (états reopen et unlocking qui en vient). */
  readonly reopening: boolean;
  /** Activité (clic, touche, défilement, visibilité) : repousse l'effacement après 30 min. */
  touch(): void;
  continueHere(): void;
  unlock(password: string): Promise<void>;
  /** Compte à rebours à zéro avant le déverrouillage : « Lien invalide », sans requête (A22). */
  expire(): void;
  /** État « error » : relit fetchMeta. */
  retry(): Promise<void>;
  /**
   * Fin de l'ouverture (Terminer, destruction, disparition, échéance ; clés déjà effacées) :
   * plus aucune référence au contenu déchiffré, octroi effacé de l'onglet.
   */
  forget(): void;
  /**
   * Écran démonté (autre route, nouveau lien) : un calcul ou une lecture en cours n'aboutit plus
   * à rien ; minuteries arrêtées. L'entrée de l'onglet n'est gardée que si le contenu était
   * affiché (spec §41.4) ; sinon, comme forget.
   */
  dispose(): void;
};

const isCode = (e: unknown, code: string) => e instanceof Error && e.message === code;

/** K_lien (43 caractères) d'un lien de partage `${origin}/#<clé>`. */
const keyOf = (l: string) => l.slice(l.lastIndexOf("#") + 1);

export function createReceiver(link: LinkState, deps: Partial<ReceiverDeps> = {}): Receiver {
  const d: ReceiverDeps = {
    fetchMeta: (l, o, g) => fetchMeta(l, o, undefined, g),
    openShare: (l, p, o, g) => openShare(l, p, o, { grant: g }),
    grants: { load: loadOpenGrant, save: saveOpenGrant, clear: clearOpenGrant },
    tag: grantTag,
    askTabs: (t) => askOtherTabs(t),
    answerTabs: (g) => answerOtherTabs(g),
    returns: pageReturns(),
    every: (ms, f) => {
      const id = setInterval(f, ms);
      return () => clearInterval(id);
    },
    now: () => Date.now(),
    inAppBrowser: () => null,
    scrub: () => undefined,
    origin: typeof location === "undefined" ? "" : location.origin,
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    navType: () => {
      try {
        return (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? "";
      } catch {
        return "";
      }
    },
    onHide: (f) => {
      if (typeof addEventListener !== "function") return () => undefined;
      addEventListener("pagehide", f);
      return () => removeEventListener("pagehide", f);
    },
    ...deps,
  };

  // Seule référence au secret : oubliée dès qu'elle ne sert plus (ouvert, invalide, détruit).
  let secret: string | null = link.kind === "s" ? link.link : null;
  // Octroi d'ouverture à présenter (rechargement ou autre onglet), et celui de l'ouverture en
  // cours (en mémoire, pour répondre aux autres onglets et pour l'entrée de l'onglet).
  let grant: string | null = null;
  let reloaded = false;
  let held: { key: string; grant: string; tag: string | null } | null = null;
  let tagP: Promise<string | null> = Promise.resolve(null);
  let stopAnswer: () => void = () => undefined;
  const stored = d.grants.load();
  if (secret !== null && stored !== null && stored.link !== keyOf(secret)) d.grants.clear(); // autre partage
  else if (stored !== null && d.now() - stored.last >= INACTIVITY_MS) d.grants.clear();
  // Audit M2 : le navigateur écrit le stockage de l'onglet sur le disque et le rend avec un onglet
  // restauré (Ctrl+Maj+T, reprise après panne ; Chromium : navigation « back_forward »).
  // Hors rechargement, l'entrée ne vaut que RESTORE_MS après la dernière sortie de page.
  else if (stored !== null && d.navType() !== "reload" && d.now() - stored.last >= RESTORE_MS) d.grants.clear();
  else if (stored !== null) {
    if (secret === null) secret = d.origin + "/#" + stored.link; // rechargement : plus de « # »
    grant = stored.grant;
    reloaded = true;
  }
  // Heure de sortie de page notée dans l'entrée (RESTORE_MS). Jamais retirée : sans entrée,
  // elle ne fait rien, et une ouverture suivante dans la page en a besoin.
  d.onHide(() => {
    const e = d.grants.load();
    if (e !== null) d.grants.save({ ...e, last: d.now() });
  });
  let expiresAt = 0;
  let limitedUntil = 0;
  let inflight = false;
  /** Écran quitté (forget) : un déverrouillage qui aboutit ensuite est effacé, jamais gardé (audit M2). */
  let disposed = false;

  const s = $state({
    state: "meta" as ReceiveState,
    expiresInS: 0,
    opensLeft: 0,
    attemptsLeft: undefined as number | undefined,
    retryAfterS: undefined as number | undefined,
    error: null as ReceiveError,
    app: null as string | null,
    otherTab: false,
    reopening: reloaded,
  });
  let opened = $state.raw<Opened | undefined>(undefined);

  /** L'ouverture gardée s'arrête ici : plus d'entrée d'onglet, de retour gardé ni de réponse. */
  const drop = () => {
    grant = null;
    held = null;
    stopAnswer();
    stopAnswer = () => undefined;
    d.grants.clear();
    void tagP.then((t) => (t === null ? undefined : d.returns.forget(t))).catch(() => undefined);
  };

  const end = (state: "invalid" | "destroyed_by_password" | "incomplete" | "return_lost") => {
    secret = null;
    drop();
    s.state = state;
    s.error = null;
  };

  // 30 min sans activité : l'entrée de l'onglet (qui contient K_lien) est effacée, plus de
  // réponse aux autres onglets (l'écran ouvert reste utilisable). Le retour gardé (sans K_lien)
  // reste : rouvrir le lien du message reviendra sur la même ouverture (D42-22).
  const onIdle = () => {
    held = null;
    stopAnswer();
    d.grants.clear();
  };
  let guard = startInactivityGuard(d.now, onIdle, d.every);

  async function keep(o: Opened, key: string, tag: string | null): Promise<void> {
    if (guard.stopped) guard = startInactivityGuard(d.now, onIdle, d.every);
    held = { key, grant: o.grant, tag };
    d.grants.save({ v: 1, link: key, grant: o.grant, last: d.now() });
    // D42-22 : gardé jusqu'à l'échéance du partage (celle de l'octroi), pour revenir plus tard.
    stopAnswer = tag === null ? () => undefined : d.answerTabs((t) => (held !== null && t === held.tag ? held.grant : null));
    // Attendu (quelques ms) avant d'afficher le contenu : fermer l'onglet aussitôt après ne
    // perd pas le retour. Échec : silencieux, revenir comptera une ouverture.
    if (tag !== null && expiresAt > 0) await d.returns.save({ tag, grant: o.grant, expiresAt }).catch(() => undefined);
  }

  async function loadMeta(): Promise<void> {
    if (secret === null || inflight) return;
    if (!d.online()) {
      s.error = "network";
      s.state = "error";
      return;
    }
    inflight = true;
    s.state = "meta";
    s.error = null;
    try {
      const l = secret;
      tagP = d.tag(l, d.origin).catch(() => null);
      if (grant === null) {
        // Nouvel onglet : un autre onglet détient-il déjà cette ouverture ? (400 ms au plus)
        const tag = await tagP;
        const g = tag === null ? null : await d.askTabs(tag).catch(() => null);
        if (secret === null) return;
        if (g !== null) {
          grant = g;
          s.otherTab = true;
        } else if (tag !== null) {
          // Retour plus tard depuis ce navigateur (D42-22) : même ouverture, mot de passe ressaisi.
          const kept = await d.returns.find(tag).catch(() => null);
          if (secret === null || disposed) return;
          if (kept !== null) {
            grant = kept;
            reloaded = true;
            s.reopening = true;
          }
        }
      }
      const m = grant === null ? await d.fetchMeta(l, d.origin) : await d.fetchMeta(l, d.origin, grant);
      if (secret === null || disposed) return; // déjà terminé pendant l'attente
      expiresAt = d.now() + m.expiresInS * 1000;
      s.expiresInS = m.expiresInS;
      s.opensLeft = m.opensLeft;
      if (m.expiresInS <= 0) end("invalid");
      else if (reloaded && grant !== null) s.state = "reopen";
      else s.state = "locked";
    } catch (e) {
      if (disposed) return;
      // Octroi présenté (rechargement, retour gardé, autre onglet) et partage introuvable : la
      // personne l'avait ouvert, mais ne peut plus y revenir (détruit, expiré, ou serveur
      // redémarré alors que toutes les ouvertures sont prises) : écran dédié (D42-22).
      if (e instanceof NotFoundError && grant !== null) end("return_lost");
      else if (e instanceof NotFoundError || isCode(e, "lien_invalide") || isCode(e, "origine_invalide")) end("invalid");
      else if (e instanceof LimitError) {
        s.retryAfterS = e.retryAfterS;
        s.error = "limit";
        s.state = "error";
      } else if (e instanceof ServerError) {
        s.error = e.maintenance ? "maintenance" : "server";
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

  /**
   * Octroi refusé : effacé, retour à l'écran normal ; la prochaine fois comptera une ouverture.
   * Plus aucune ouverture restante (partage « draining ») : déverrouiller serait refusé, on le
   * dit tout de suite (« retour impossible », avec la cause : limite des retours ou octroi).
   */
  function grantRefused(error: "grant_invalid" | "reopen_limit") {
    if (s.opensLeft === 0) {
      end("return_lost");
      s.error = error;
      return;
    }
    drop();
    reloaded = false;
    s.otherTab = false;
    s.reopening = false;
    s.error = error;
    s.state = "locked";
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
    get opensLeft() {
      return s.opensLeft;
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
    get otherTab() {
      return s.otherTab;
    },
    get reopening() {
      return s.reopening;
    },
    touch() {
      guard.touch();
    },
    continueHere() {
      if (s.state !== "inapp") return;
      d.scrub();
      start();
    },
    expire() {
      if (s.state === "locked" || s.state === "reopen" || s.state === "meta" || s.state === "error") end("invalid");
    },
    async retry() {
      if (s.state === "error") await loadMeta();
    },
    forget() {
      disposed = true;
      secret = null;
      opened = undefined;
      drop();
      guard.stop();
    },
    dispose() {
      // Contenu déjà affiché : son entrée d'onglet et son retour gardé restent (spec §41.4,
      // D42-22 : un retour ou un rechargement rouvre la même ouverture jusqu'à l'échéance), mais
      // plus rien ne tourne ici (réponses aux autres onglets). Sinon : comme forget (audit M2).
      if (s.state !== "open") return this.forget();
      disposed = true;
      secret = null;
      opened = undefined;
      held = null;
      stopAnswer();
      stopAnswer = () => undefined;
      guard.stop();
    },
    async unlock(password: string) {
      // Garde synchrone, avant tout await : un double appui ne fait qu'un appel.
      if ((s.state !== "locked" && s.state !== "reopen") || inflight || secret === null) return;
      const back = s.state;
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
        const l = secret;
        const o = grant === null ? await d.openShare(l, password, d.origin) : await d.openShare(l, password, d.origin, grant);
        secret = null; // les clés utiles sont dans Opened ; le lien ne sert plus
        const tag = disposed ? null : await tagP;
        if (disposed) {
          // Plus personne ne regarde : clés effacées, rien n'est gardé dans l'onglet.
          void o.done().catch(() => undefined);
          return;
        }
        // L'octroi n'est écrit qu'après un déverrouillage réussi (jamais le mot de passe).
        await keep(o, keyOf(l), tag);
        if (disposed) {
          // Écran quitté pendant l'écriture : rien n'est gardé (comme avant le déverrouillage).
          if (tag !== null) await d.returns.forget(tag).catch(() => undefined);
          void o.done().catch(() => undefined);
          return;
        }
        opened = o;
        s.state = "open";
      } catch (e) {
        if (disposed) return;
        if (e instanceof BadPasswordError) {
          s.attemptsLeft = e.attemptsLeft;
          s.error = "bad_password";
          s.state = back;
        } else if (e instanceof GrantInvalidError) {
          grantRefused("grant_invalid");
        } else if (e instanceof ReopenLimitError) {
          grantRefused("reopen_limit");
        } else if (e instanceof NotFoundError) {
          // A23 : le dernier essai a échoué → le partage vient d'être détruit (la personne sait qu'il existait).
          end(s.attemptsLeft === 1 ? "destroyed_by_password" : grant !== null ? "return_lost" : "invalid");
        } else if (e instanceof LimitError) {
          s.retryAfterS = e.retryAfterS;
          limitedUntil = d.now() + e.retryAfterS * 1000;
          s.error = "limit";
          s.state = back;
        } else if (isCode(e, "mot_de_passe_requis")) {
          // Aucun essai consommé (refus local, avant toute requête).
          s.error = "password_required";
          s.state = back;
        } else if (isCode(e, "lien_invalide") || isCode(e, "origine_invalide")) {
          end("invalid");
        } else {
          // Réseau : on ne sait pas si une ouverture a été consommée (UI §9.7) ; rien n'est affirmé.
          s.error = "network";
          s.state = back;
        }
      } finally {
        inflight = false;
      }
    },
  };
}
