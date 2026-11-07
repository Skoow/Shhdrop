<script lang="ts">
  // Écran d'envoi (UI §9.4) : capsule de scellement, phase, mesures réelles, coches d'étape
  // honnêtes (M3), bandeaux de coupure, de pause et de lenteur, Pause/Reprendre, Annuler.
  // « Lien prêt » n'est jamais monté ici : l'écran parent l'affiche après onsealed(), c'est-à-
  // dire après la résolution de createShare puis la fermeture du sceau.
  import { tick } from "svelte";
  import { setScreenTitle } from "../app/title";
  import { UPLOAD_WINDOW_MS, type Sender, type Step } from "../flows/send.svelte";
  import type { Category } from "../flows/kinds";
  import { formatBytes, formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "../ui/announce";
  import Banner from "../ui/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import { CircleHelp, Check, Pause, Play } from "../ui/Icon";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import PhaseList from "../ui/PhaseList.svelte";
  import SealCapsule from "../ui/SealCapsule.svelte";
  import UploadStats from "../ui/UploadStats.svelte";

  type Props = {
    sender: Sender;
    items: { name: string; category: Category }[];
    bytes: number;
    /** Après la fermeture du sceau (résolution seulement). */
    onsealed: () => void;
    /** Retour au composeur (annulation, ou « Modifier l'envoi » après une erreur). */
    onexit: (why: "cancelled" | "edit") => void;
  };
  let { sender, items, bytes, onsealed, onexit }: Props = $props();
  const lang = $derived(getLang());
  const s = $derived(sender);
  const phase = $derived(s.phase);

  const MAX_NAMES = 4;
  const shownNames = $derived(items.slice(0, MAX_NAMES));
  const more = $derived(items.length > MAX_NAMES ? t("seal.more", { n: items.length - MAX_NAMES }) : "");
  const summary = $derived(t("seal.summary", { n: items.length, size: formatBytes(bytes, lang) }));

  const mode = $derived.by(() => {
    switch (phase) {
      case "idle":
      case "keys":
      case "captcha":
      case "fallback":
        return "spin" as const;
      case "upload":
        return "progress" as const;
      case "paused":
        return "paused" as const;
      case "offline":
        return "offline" as const;
      case "finalize":
        return "final" as const;
      case "sealed":
        return "sealed" as const;
      case "cancelled":
        return "cancelled" as const;
      default:
        return "error" as const;
    }
  });
  const chip = $derived.by(() => {
    switch (phase) {
      case "idle":
      case "keys":
        return t("seal.chip.keys");
      case "captcha":
      case "fallback":
        return t("seal.chip.captcha");
      case "upload":
        return t("seal.chip.upload");
      case "paused":
        return t("seal.chip.paused");
      case "offline":
        return t("seal.chip.offline");
      case "finalize":
        return t("seal.chip.finalize");
      case "sealed":
        return t("seal.chip.sealed");
      default:
        return t("seal.chip.stopped");
    }
  });
  const title = $derived.by(() => {
    switch (phase) {
      case "idle":
      case "keys":
        return t("seal.keys");
      case "captcha":
      case "fallback":
        return t("seal.phase.captcha");
      case "upload":
        return t("seal.upload");
      case "paused":
        return t("seal.phase.paused");
      case "offline":
        return t("seal.phase.offline");
      case "finalize":
        return t("seal.phase.finalize");
      case "sealed":
        return t("seal.phase.sealed");
      case "cancelled":
        return t("seal.cancelled");
      default:
        return t("seal.phase.error");
    }
  });
  const sub = $derived.by(() => {
    switch (phase) {
      case "idle":
      case "keys":
        return t("seal.sub.keys");
      case "captcha":
      case "fallback":
        return t("seal.sub.captcha");
      case "upload":
      case "paused":
      case "offline":
        return t("seal.sub.upload");
      case "finalize":
        return t("seal.sub.finalize");
      case "sealed":
        return t("seal.sub.sealed");
      default:
        return "";
    }
  });
  const indeterminate = $derived(mode === "spin");
  const progress = $derived(s.total > 0 ? s.sent / s.total : 0);

  // Repère des phases (keys · captcha · upload · finalize).
  const reached = $derived.by(() => {
    switch (phase) {
      case "idle":
      case "keys":
        return 0;
      case "captcha":
      case "fallback":
        return 1;
      case "upload":
      case "paused":
      case "offline":
        return 2;
      case "finalize":
        return 3;
      case "sealed":
        return 4;
      default:
        return s.steps.includes("chiffre") ? 3 : s.createdOnServer ? 2 : 1;
    }
  });
  const phases = $derived(
    [t("seal.keys"), t("seal.phase.captcha"), t("seal.upload"), t("seal.phase.finalize")].map((label, i) => ({
      label,
      state: i < reached ? ("done" as const) : i === reached && phase !== "error" && phase !== "cancelled" ? ("doing" as const) : ("todo" as const),
    })),
  );
  const STEPS: Step[] = ["chiffre", "envoye", "scelle"];

  // ---------- Bandeaux ----------
  const lost = $derived(phase === "offline");
  const lostText = $derived.by(() => {
    const r = s.netRetry;
    if (r?.offline || (typeof navigator !== "undefined" && navigator.onLine === false)) return t("seal.offline.off");
    if (r && s.retryLeftMs !== undefined && s.retryLeftMs > 0) return t("seal.offline", { duration: formatDuration(s.retryLeftMs / 1000, lang) });
    return t("seal.offline.wait");
  });
  let restored = $state(false);
  let restoredTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (s.restoredAt === undefined) return;
    restored = true;
    announce(t("seal.restored"));
    clearTimeout(restoredTimer);
    restoredTimer = setTimeout(() => (restored = false), 3000);
    return () => clearTimeout(restoredTimer);
  });
  const mmss = (ms: number) => {
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  // ---------- Erreurs ----------
  const errorText = $derived.by(() => {
    switch (s.error) {
      case "reseau":
        return t("err.send.network");
      case "interrompu":
        return t("err.interrupted");
      case "limite":
        return t("err.limit", { duration: formatDuration(s.retryAfterS ?? 60, lang, { coarse: true }) });
      case "plein":
        return t("err.full");
      case "gele":
        return t("err.frozen");
      case "captcha":
        return s.captchaLocal ? t("err.captcha.local") : t("err.captcha");
      case "fichier_modifie":
        return t("err.changed", { name: items[s.failedItem ?? -1]?.name ?? "?" });
      default:
        return t("err.unexpected");
    }
  });
  const canRetry = $derived(s.error !== undefined && s.error !== "gele" && s.error !== "fichier_modifie");
  let alertEl: HTMLParagraphElement | undefined = $state();
  $effect(() => {
    if (phase === "error") void tick().then(() => alertEl?.focus());
  });

  // ---------- Titre de l'onglet, annonces de progression (tous les 10 %) ----------
  // Pourcentage seulement, jamais un nom : « 42 % · Shhdrop » ; sinon « Envoi en cours · Shhdrop ».
  // La démo y ajoute son préfixe (demo/install.ts).
  const sending = $derived(phase === "upload" || phase === "paused" || phase === "offline" || phase === "finalize");
  $effect(() => {
    void getLang();
    if (sending) document.title = `${s.percent} % · Shhdrop`;
    else setScreenTitle("sealing");
  });
  let lastDecile = 0;
  $effect(() => {
    const d = Math.floor(s.percent / 10);
    if (sending && d > lastDecile && d < 10) {
      lastDecile = d;
      announce(t("seal.progress.say", { p: d * 10 }));
    }
  });

  // ---------- Focus, fermeture du sceau ----------
  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    heading?.focus({ preventScroll: true });
  });
  let capsule: SealCapsule | undefined = $state();
  let closing = false;
  $effect(() => {
    if (phase !== "sealed" || closing) return;
    closing = true;
    void tick()
      .then(() => capsule?.close())
      .then(() => onsealed());
  });

  function cancel() {
    sender.cancel();
    onexit("cancelled");
  }
</script>

<section class="sealing" aria-labelledby="seal-title">
  <div class="cap-col">
    <SealCapsule
      bind:this={capsule}
      {mode}
      {progress}
      percent={s.percent}
      {summary}
      {chip}
      names={shownNames}
      {more}
      sealedLabel={t("seal.phase.sealed")}
      caption={t("seal.veil")}
    />
  </div>

  <div class="info">
    <div class="phase">
      <h2 id="seal-title" class={["title", { pulse: indeterminate }]} tabindex="-1" bind:this={heading}>{title}</h2>
      {#if sub}<p class="sub">{sub}</p>{/if}
    </div>

    <div
      class="sr-only"
      role="progressbar"
      aria-label={t("seal.progress.label")}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={indeterminate ? undefined : s.percent}
      aria-valuetext={indeterminate ? title : `${s.percent} %`}
    ></div>

    {#if s.createdOnServer && phase !== "cancelled"}
      <UploadStats sent={s.sent} total={s.total} rate={s.rate} eta={s.eta} done={s.segments.done} segments={s.segments.total} />
    {/if}

    {#if s.steps.length > 0}
      <ul class="steps" aria-label={t("seal.steps.label")}>
        {#each STEPS.filter((x) => s.steps.includes(x)) as st (st)}
          <li><Check size={18} strokeWidth={2.2} aria-hidden="true" />{t(`seal.step.${st}`)}</li>
        {/each}
      </ul>
    {/if}

    {#if lost}
      <Banner kind="warn">
        <span class="num">{lostText}</span>
        {#if s.keptMs !== undefined}<span class="kept num">{t("seal.offline.kept", { duration: formatDuration(s.keptMs / 1000, lang) })}</span>{/if}
      </Banner>
    {:else if restored && phase === "upload"}
      <Banner kind="info">{t("seal.restored")}</Banner>
    {/if}
    {#if phase === "paused" && s.pauseLeftMs !== undefined}
      <Banner kind="info"><span class="num">{t("seal.paused", { duration: mmss(s.pauseLeftMs) })}</span></Banner>
    {/if}
    {#if s.tooSlow}
      <Banner kind="warn">{t("seal.tooSlow", { h: UPLOAD_WINDOW_MS / 3600_000 })}</Banner>
    {/if}

    {#if phase === "error"}
      <div class="err">
        <p class="err-msg" role="alert" tabindex="-1" bind:this={alertEl}>{errorText}</p>
        <div class="actions">
          {#if canRetry}
            <Button variant="primary" disabled={s.retryWaitS > 0} onpress={() => sender.retry()}>
              {s.retryWaitS > 0 ? t("seal.retryIn", { duration: formatDuration(s.retryWaitS, lang, { precise: true }) }) : t("common.retry")}
            </Button>
          {/if}
          <Button variant="secondary" onpress={() => onexit("edit")}>{t("seal.edit")}</Button>
        </div>
      </div>
    {/if}

    <PhaseList {phases} />

    {#if phase !== "error" && phase !== "sealed" && phase !== "cancelled"}
      <div class="actions">
        {#if phase === "finalize"}
          <p class="why">{t("seal.cancel.finalize")}</p>
        {:else}
          {#if phase === "paused"}
            <Button variant="primary" onpress={() => sender.resume()}>
              {#snippet icon()}<Play size={20} strokeWidth={1.75} />{/snippet}
              {t("seal.resume")}
            </Button>
          {:else if phase === "upload" || phase === "offline"}
            <Button
              variant="secondary"
              disabled={!s.canPause}
              aria-describedby={!s.canPause && s.pausing === false && phase === "upload" ? "pause-why" : undefined}
              onpress={() => sender.pause()}
            >
              {#snippet icon()}<Pause size={20} strokeWidth={1.75} />{/snippet}
              {t("seal.pause")}
            </Button>
          {/if}
          {#if s.cancellable}
            <InlineConfirm
              label={t("seal.cancel")}
              message={t("seal.cancel.confirm")}
              confirmLabel={t("seal.cancel.yes")}
              cancelLabel={t("seal.cancel.no")}
              triggerVariant="ghost"
              kind="warn"
              onconfirm={cancel}
            />
          {/if}
        {/if}
      </div>
      {#if s.pausing}<p class="why" role="status">{t("seal.pausing")}</p>{/if}
      {#if phase === "upload" && !s.canPause && !s.pausing}<p id="pause-why" class="why">{t("seal.pause.refused")}</p>{/if}
    {/if}

    <p class="foot"><CircleHelp size={18} strokeWidth={1.75} aria-hidden="true" /><span>{t("seal.padding")} {t("seal.keepOpen")}</span></p>
  </div>
</section>

<style>
  .sealing {
    width: min(100%, 1120px);
    margin-inline: auto;
    padding: var(--sp-6) var(--sp-4) var(--sp-8);
    display: grid;
    gap: var(--sp-6);
  }
  @media (min-width: 960px) {
    .sealing {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      align-items: center;
      /* Centré dans la hauteur utile (sans en-tête ni pied) : plus de demi-page vide (scan UX). */
      align-content: center;
      min-height: calc(100dvh - 11rem);
      gap: var(--sp-8);
      padding-block: var(--sp-6);
    }
  }
  .cap-col {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
  }
  .info {
    display: grid;
    gap: var(--sp-5);
    min-width: 0;
  }
  .phase {
    display: grid;
    gap: var(--sp-1);
  }
  .title {
    margin: 0;
    font-size: var(--fs-h1);
    line-height: var(--lh-h1);
    font-weight: var(--fw-h1);
    font-stretch: var(--wd-h1);
  }
  .title:focus {
    outline: none;
  }
  .sub {
    margin: 0;
    color: var(--text-2);
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: seal-label-pulse 1.2s ease-in-out infinite;
    }
  }
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-4);
  }
  .steps li {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--accent);
    font-weight: 600;
  }
  .kept {
    display: block;
    margin-top: var(--sp-1);
    color: var(--text-2);
  }
  .err {
    display: grid;
    gap: var(--sp-3);
    padding: var(--sp-4);
    border: 1px solid var(--danger);
    border-radius: var(--r-md);
    background: var(--danger-tint);
  }
  .err-msg {
    margin: 0;
  }
  .err-msg:focus {
    outline: none;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
  }
  .why {
    margin: 0;
    font-size: var(--fs-small);
    color: var(--text-2);
  }
  .foot {
    margin: 0;
    display: flex;
    gap: var(--sp-2);
    font-size: var(--fs-small);
    color: var(--text-2);
  }
  .foot :global(svg) {
    flex: none;
    margin-top: 2px;
  }
</style>
