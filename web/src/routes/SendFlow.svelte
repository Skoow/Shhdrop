<script lang="ts">
  // Parcours d'envoi (UI §9.2 à §9.5) : composeur → scellement → « Lien prêt ». Le composeur
  // n'est jamais détruit pendant l'envoi : il est masqué (`hidden`, `inert`) et revient intact
  // après une annulation ou une erreur ; « Terminé » et « Nouvel envoi » le remontent vide.
  // Les secrets (lien, lien de gestion, mot de passe) ne vivent que dans le sender et les props
  // de Ready, oubliés à Terminé ou Supprimer.
  import { flushSync, tick } from "svelte";
  import { getDemo } from "../app/demo-hooks";
  import { gate } from "../flows/clean-gate";
  import { setScreenTitle } from "../app/title";
  import { leaveGuard, router } from "../app/router.svelte";
  import { createWakeLock } from "../app/wakelock";
  import { solvePow } from "../captcha/pow";
  import { categoryOf } from "../flows/kinds";
  import { createSender, type Sender, type SendOpts } from "../flows/send.svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { createDraft, destroyShare, type CaptchaCtx, type Draft, type TtlHours } from "../index";
  import { announce } from "../ui/announce";
  import Banner from "../ui/Banner.svelte";
  import { runTransition } from "../ui/viewTransition";
  import Compose, { type SendState } from "./Compose.svelte";
  import Ready from "./Ready.svelte";
  import Sealing from "./Sealing.svelte";

  type Props = {
    /** Vrai de l'appui sur « Chiffrer et envoyer » jusqu'à « Lien prêt » (langue figée, dépôt ignoré). */
    onbusy?: (busy: boolean) => void;
    /** Page d'envoi « /envoyer » : composeur affiché même vide (retours DROP). */
    sendPage?: boolean;
  };
  let { onbusy, sendPage = false }: Props = $props();

  type View = "compose" | "sealing" | "ready";
  let view = $state<View>("compose");
  let composeKey = $state(0);
  let sender = $state.raw<Sender | null>(null);
  let sent = $state.raw<{ names: { name: string; category: ReturnType<typeof categoryOf> }[]; bytes: number; ttlHours: number; maxOpens: number } | null>(null);
  let note = $state("");

  // Démo : preuve factice acceptée par le faux serveur seulement. Production : preuve de travail
  // dans un Worker (version minimale, Task 14 pour le pré-calcul et le repli).
  const demo = getDemo();
  let powAbort: AbortController | undefined;
  function solveCaptcha(challenge: unknown, ctx: CaptchaCtx) {
    if (demo) return demo.solveCaptcha(challenge, ctx);
    powAbort = new AbortController();
    return solvePow(challenge, ctx, powAbort.signal);
  }

  // Brouillon d'envoi (spec §41.14) : créé au premier fichier, chaque fichier envoyé dès son
  // ajout ; détruit (keepalive) si la liste est vidée, la page quittée ou l'écran démonté.
  let uploadVersion = $state(0);
  let removing = $state(0);
  function newDraft(): Draft {
    const d = createDraft(typeof location === "undefined" ? "http://localhost" : location.origin, {
      solveCaptcha,
      auto: true,
      // Dernier verrou avant le chiffrement : seul un contenu déclaré prêt par le composeur
      // (nettoyé, ou « Envoyer tel quel » choisi) est chiffré (flows/clean-gate.ts, spec §35.2).
      prepare: gate,
      onChange: () => {
        if (d !== draft) return;
        uploadVersion++;
        removing = d.removing;
      },
    });
    return d;
  }
  let draft: Draft = newDraft();
  let draftUsed = false;
  function onitems(list: { id: string; data: Blob }[]) {
    if (list.length === 0 && draftUsed) {
      void draft.abandon();
      draft = newDraft();
      draftUsed = false;
      removing = 0;
      uploadVersion++;
      return;
    }
    if (list.length > 0) draftUsed = true;
    draft.sync(list);
  }

  // Démontage (autre route, démo « Ouvrir comme destinataire ») : plus d'envoi en cours. L'envoi
  // est annulé (le partage créé est détruit), la preuve de travail arrêtée, le brouillon abandonné
  // (une finalisation qui attend échoue aussitôt) et les secrets oubliés (audit I2).
  $effect(() => () => {
    onbusy?.(false);
    stop();
    powAbort?.abort();
    disarm?.();
    void draft.abandon();
  });

  // Bouton Retour pendant l'envoi et sur « Lien prêt » (audit I2) : confirmation, sinon on reste.
  let disarm: (() => void) | undefined;
  function guard() {
    disarm?.();
    disarm = leaveGuard?.arm({
      confirm: () => window.confirm(view === "ready" ? t("leave.ready") : t("leave.sending")),
      onleave: () => {
        disarm = undefined;
        unloadArmed = false;
        stop();
        powAbort?.abort();
        const wasReady = view === "ready";
        sender = null;
        sent = null;
        if (wasReady) composeKey++;
        setView("compose");
      },
    });
  }
  /**
   * Sortie sans « Terminé » : l'envoi est annulé ; pendant la finalisation (plus annulable,
   * UI §9.4.5), le partage qui en sortira, dont personne n'aura vu le lien, est supprimé dès
   * qu'il existe. Après « Lien prêt », le partage reste (le lien a pu être copié).
   */
  let running: Promise<void> | undefined;
  function stop() {
    const s = sender;
    if (!s) return;
    if (s.cancellable) s.cancel();
    else if (s.phase === "finalize" && running)
      void running.then(() => {
        const r = s.result;
        s.forget();
        if (r) void destroyShare(r.manage, location.origin).catch(() => undefined);
      });
    if (s.phase !== "finalize") s.forget();
  }
  function unguard() {
    const d = disarm;
    disarm = undefined;
    d?.();
  }

  const wake = typeof document === "undefined" ? undefined : createWakeLock();
  $effect(() => () => wake?.dispose());

  let unloadArmed = $state(false);
  $effect(() => {
    if (!unloadArmed) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  });

  function setView(v: View) {
    // Retour au composeur (annuler, modifier, nouvel envoi) : glissement inverse sur téléphone.
    void runTransition(() => flushSync(() => (view = v)), { back: v === "compose" });
    onbusy?.(v !== "compose");
  }

  function start(state: SendState) {
    // Double envoi : un seul parcours à la fois. Le garde porte sur `sender` (posé tout de suite),
    // pas sur `view` : l'écran change après la transition de vue, plus tard sous WebKit, et un
    // second clic lançait alors une seconde finalisation (refusée, « transfert interrompu »).
    // `sender` repasse à null à chaque retour au composeur (exit, reset, forget).
    if (sender) return;
    note = "";
    const ids = state.ids;
    const d = draft;
    const s = createSender({
      createShare: (_origin, items, o) => d.finalize(items.map((item, k) => ({ id: ids[k]!, item })), o),
      solveCaptcha,
      wakeLock: wake,
      onBeforeUnload: (armed) => (unloadArmed = armed),
      onStep: (st) => announce(t(`seal.step.${st}`)),
      onAutoResume: () => announce(t("seal.autoresume")),
    });
    sender = s;
    sent = {
      names: state.items.map((i) => ({ name: i.name, category: categoryOf(i.kind, i.name, i.mime) })),
      bytes: state.items.reduce((n, i) => n + (i.data instanceof Blob ? i.data.size : i.data.byteLength), 0),
      ttlHours: state.ttlHours,
      maxOpens: state.maxOpens,
    };
    const opts: SendOpts = {
      origin: location.origin,
      base: import.meta.env.BASE_URL,
      ttlHours: state.ttlHours as TtlHours,
      maxOpens: state.maxOpens,
      password: state.password,
      rights: state.rights,
      keepTtlH: state.keepTtlH,
    };
    guard();
    setView("sealing");
    running = s.start(state.items, opts);
  }

  function focusSend() {
    const b = document.querySelector<HTMLButtonElement>(".sendbar button.primary, .sendbar button:last-of-type");
    b?.focus();
  }

  async function exit(why: "cancelled" | "edit") {
    const s = sender;
    note = why === "cancelled" ? (s?.createdOnServer ? t("seal.cancelled.created") : t("seal.cancelled")) : "";
    powAbort?.abort();
    unguard();
    sender = null;
    sent = null;
    setView("compose");
    await tick();
    focusSend();
    if (note) announce(note);
  }

  function sealed() {
    unloadArmed = false;
    // Brouillon finalisé : le prochain envoi aura le sien.
    draft = newDraft();
    draftUsed = false;
    setView("ready");
  }

  /** Terminé, Nouvel envoi : composeur vide, plus aucune référence aux secrets. */
  function reset() {
    unguard();
    sender?.forget();
    sender = null;
    sent = null;
    composeKey++;
    setView("compose");
  }
  function forget() {
    unguard(); // partage supprimé : plus rien à perdre
    sender?.forget();
    sender = null;
  }

  // pagehide pendant l'envoi : abort (le partage créé est détruit en keepalive), arrêt du Worker.
  function onPageHide(e: PageTransitionEvent) {
    sender?.cancel();
    powAbort?.abort();
    // Page gardée en cache (bfcache) : elle peut revenir ; sinon le brouillon est détruit.
    if (!e.persisted) void draft.abandon();
  }
  function onOffline() {
    sender?.markOffline();
  }

  const lang = $derived(getLang());
  // Titre de l'onglet (scan UX B9) ; pendant le scellement, Sealing.svelte le tient.
  $effect(() => {
    void lang;
    // Accueil (« / ») : titre descriptif pour les moteurs de recherche ; page d'envoi : « Envoyer ».
    if (view === "compose") setScreenTitle(router.current.name === "home" ? "landing" : "home");
    else if (view === "ready") setScreenTitle("ready");
  });
  const summary = $derived(sent ? t("seal.summary", { n: sent.names.length, size: formatBytes(sent.bytes, lang) }) : "");
</script>

<svelte:window onpagehide={onPageHide} onoffline={onOffline} />

<!-- Inerte dès l'appui sur Envoyer (audit I1) : la transition de vue arrive plus tard. -->
<div class="compose-host" hidden={view !== "compose"} inert={view !== "compose" || sender !== null}>
  {#if note && view === "compose"}
    <div class="note"><Banner kind="info" action={{ label: t("common.close"), onpress: () => {
          note = "";
        } }}>{note}</Banner></div>
  {/if}
  {#key composeKey}
    <Compose
      {sendPage}
      active={view === "compose"}
      onsend={start}
      {onitems}
      uploadOf={(id) => draft.status(id)}
      {uploadVersion}
      onretry={(id) => draft.retry(id)}
      {removing}
    />
  {/key}
</div>

{#if view === "sealing" && sender && sent}
  <Sealing {sender} items={sent.names} bytes={sent.bytes} onsealed={sealed} onexit={exit} />
{:else if view === "ready" && sent}
  <Ready
    result={sender?.result ?? null}
    {summary}
    ttlHours={sent.ttlHours}
    maxOpens={sent.maxOpens}
    ondone={reset}
    onforget={forget}
    onnew={reset}
  />
{/if}

<style>
  .compose-host[hidden] {
    display: none;
  }
  .note {
    width: min(100% - 2 * var(--sp-4), 1120px);
    margin: var(--sp-4) auto 0;
  }
</style>
