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
  import { createWakeLock } from "../app/wakelock";
  import { solvePow } from "../captcha/pow";
  import { categoryOf } from "../flows/kinds";
  import { createSender, type Sender, type SendOpts } from "../flows/send.svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { createDraft, type CaptchaCtx, type Draft, type TtlHours } from "../index";
  import { announce } from "../ui/announce";
  import Banner from "../ui/Banner.svelte";
  import { runTransition } from "../ui/viewTransition";
  import Compose, { type SendState } from "./Compose.svelte";
  import Ready from "./Ready.svelte";
  import Sealing from "./Sealing.svelte";

  type Props = {
    vaultAllowed?: boolean;
    /** Vrai de l'appui sur « Chiffrer et envoyer » jusqu'à « Lien prêt » (langue figée, dépôt ignoré). */
    onbusy?: (busy: boolean) => void;
  };
  let { vaultAllowed = false, onbusy }: Props = $props();

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

  // Démontage (autre route, démo « Ouvrir comme destinataire ») : plus d'envoi en cours.
  $effect(() => () => {
    onbusy?.(false);
    void draft.abandon();
  });

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
    if (sender && view !== "compose") return; // double envoi : un seul parcours à la fois
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
    setView("sealing");
    void s.start(state.items, opts);
  }

  function focusSend() {
    const b = document.querySelector<HTMLButtonElement>(".sendbar button.primary, .sendbar button:last-of-type");
    b?.focus();
  }

  async function exit(why: "cancelled" | "edit") {
    const s = sender;
    note = why === "cancelled" ? (s?.createdOnServer ? t("seal.cancelled.created") : t("seal.cancelled")) : "";
    powAbort?.abort();
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
    sender?.forget();
    sender = null;
    sent = null;
    composeKey++;
    setView("compose");
  }
  function forget() {
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
    if (view === "compose") setScreenTitle("home");
    else if (view === "ready") setScreenTitle("ready");
  });
  const summary = $derived(sent ? t("seal.summary", { n: sent.names.length, size: formatBytes(sent.bytes, lang) }) : "");
</script>

<svelte:window onpagehide={onPageHide} onoffline={onOffline} />

<div class="compose-host" hidden={view !== "compose"} inert={view !== "compose"}>
  {#if note && view === "compose"}
    <div class="note"><Banner kind="info" action={{ label: t("common.close"), onpress: () => {
          note = "";
        } }}>{note}</Banner></div>
  {/if}
  {#key composeKey}
    <Compose
      {vaultAllowed}
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
