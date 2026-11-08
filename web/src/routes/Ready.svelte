<script lang="ts">
  // « Lien prêt » (UI §9.5) : affiché seulement après la résolution de createShare. L'avertissement
  // « plus jamais affichés » en tête ; deux cartes pour deux secrets (M18, S2) : le lien (Copier,
  // Partager, QR) et le mot de passe (Copier, Partager), chacun partagé à part ; lien de gestion
  // replié ; Supprimer ce partage (secondaire) ; Terminé (principal,
  // collé en bas sur téléphone). Les valeurs ne viennent que des props (Copier lit l'état, jamais le
  // DOM) ; rien n'est écrit dans la console, le titre, l'URL ou un stockage.
  import { tick } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { getDemo } from "../app/demo-hooks";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { NotFoundError, destroyShare } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import CopyField from "../ui/CopyField.svelte";
  import Deadline from "../ui/Deadline.svelte";
  import { ChevronDown, ClipboardX, Eye, Lock, QrCode as QrIcon, Share2, Trash2 } from "../ui/Icon";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import Logo from "../ui/Logo.svelte";
  import QrCode from "../ui/QrCode.svelte";
  import { reducedMotion } from "../ui/motion";
  import { canShareLink, haptic, shareLink, sharePassword } from "../ui/native";
  import Sheet from "../ui/Sheet.svelte";
  import "../ui/seal.css";

  export type ReadyResult = { link: string; manage: string; expiresInS: number; password: string };
  type Props = {
    /** null après Terminé ou Supprimer : plus aucune référence aux secrets. */
    result: ReadyResult | null;
    summary: string;
    ttlHours: number;
    maxOpens: number;
    /** Terminé : retour au composeur vide. */
    ondone: () => void;
    /** Le partage est supprimé : oublier les secrets. */
    onforget: () => void;
    /** « Nouvel envoi » après la suppression. */
    onnew: () => void;
  };
  let { result, summary, ttlHours, maxOpens, ondone, onforget, onnew }: Props = $props();
  const lang = $derived(getLang());
  const demo = getDemo();
  const narrow = new MediaQuery("max-width: 759px");

  const selfDestruct = $derived(
    t("ready.selfdestruct", { opens: t("ready.opens", { n: maxOpens }), ttl: formatDuration(ttlHours * 3600, lang) }),
  );

  // ---------- Garde de sortie : jusqu'à Terminé ou Supprimer (UI §9.5, A12) ----------
  let guarded = $state(true);
  $effect(() => {
    if (!guarded) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  });

  // ---------- Arrivée : focus sur le titre, annonce, montée en éventail (M18) ----------
  let heading: HTMLHeadingElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!heading) return;
    heading.focus({ preventScroll: true });
    haptic();
    announce(t("ready.created"));
  });
  $effect(() => {
    if (!panel || reducedMotion() || typeof panel.animate !== "function") return;
    const blocks = [...panel.querySelectorAll<HTMLElement>("[data-fan]")];
    blocks.forEach((el, i) =>
      el.animate([{ transform: "translateY(14px)", opacity: 0 }, { transform: "none", opacity: 1 }], {
        duration: 520,
        delay: Math.min(i, 2) * 60,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      }),
    );
  });

  // ---------- Partager, QR ----------
  const canShare = canShareLink();
  async function share() {
    if (result) await shareLink(result.link); // le lien seul, jamais le mot de passe
  }
  let qrShown = $state(false);
  let qrSheet = $state(false);
  function toggleQr() {
    if (narrow.current) qrSheet = true;
    else qrShown = !qrShown;
  }

  // ---------- Mot de passe : partagé seul, jamais avec le lien ----------
  async function sharePw() {
    if (result) await sharePassword(result.password); // le mot de passe seul, jamais avec le lien
  }

  // ---------- Terminé, Supprimer ----------
  function done() {
    guarded = false;
    ondone();
  }
  let deleteError = $state("");
  let deleted = $state(false);
  let logo: Logo | undefined = $state();
  let goneTitle: HTMLHeadingElement | undefined = $state();
  async function remove() {
    if (!result) return;
    deleteError = "";
    try {
      await destroyShare(result.manage, location.origin);
    } catch (e) {
      if (!(e instanceof NotFoundError)) {
        deleteError = t("ready.deleted.net");
        return;
      }
    }
    // Après la réponse du serveur seulement : dissolution, puis message (UI §7.4).
    guarded = false;
    if (panel && typeof panel.animate === "function") {
      const reduce = reducedMotion();
      const a = panel.animate(
        reduce
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, filter: "blur(0)", transform: "none" },
              { opacity: 0, filter: "blur(2px)", transform: "translateY(-4px)" },
            ],
        { duration: reduce ? 240 : 400, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" },
      );
      await a.finished.catch(() => undefined);
    }
    deleted = true;
    onforget();
    await tick();
    goneTitle?.focus({ preventScroll: true });
    announce(t("ready.deleted"));
    await logo?.erase();
  }
</script>

{#if deleted || !result}
  <section class="gone" aria-labelledby="gone-title">
    <div class="gone-logo"><Logo bind:this={logo} /></div>
    <span class="mini dashed" aria-hidden="true"></span>
    <h2 id="gone-title" class="title" tabindex="-1" bind:this={goneTitle}>{t("ready.deleted")}</h2>
    <p class="lede">{t("ready.deleted.body")}</p>
    <Button variant="primary" onpress={onnew}>{t("ready.new")}</Button>
  </section>
{:else}
  <section class="ready" aria-labelledby="ready-title">
    <div class="panel" bind:this={panel}>
      <header class="hd" data-fan>
        <span class="mini" aria-hidden="true" data-capsule><Lock size={22} strokeWidth={1.9} /></span>
        <div class="hd-tx">
          <h2 id="ready-title" class="title" tabindex="-1" data-large-title bind:this={heading}>{t("ready.title")}</h2>
          <p class="meta num">{summary}</p>
          <p class="active num"><span class="dot" aria-hidden="true"></span>{t("ready.active")}</p>
          <!-- Retours UI4 : date et heure exactes de fin, puis le décompte vivant. -->
          <p class="when"><Deadline expiresInS={result?.expiresInS ?? 0} /></p>
          <p class="self">{selfDestruct}</p>
        </div>
      </header>

      <p class="never" data-fan><ClipboardX size={18} strokeWidth={1.75} aria-hidden="true" />{t("ready.never")}</p>

      <div class="card" role="group" aria-label={t("ready.link.title")} data-fan>
        <CopyField label={t("ready.link.label")} value={result.link} />
        <div class="row">
          {#if canShare}
            <Button variant="secondary" dense onpress={share}>
              {#snippet icon()}<Share2 size={20} strokeWidth={1.75} />{/snippet}
              {t("ready.share")}
            </Button>
          {/if}
          <Button variant="secondary" dense aria-expanded={narrow.current ? undefined : qrShown} onpress={toggleQr}>
            {#snippet icon()}<QrIcon size={20} strokeWidth={1.75} />{/snippet}
            {qrShown ? t("ready.qr.hide") : t("ready.qr")}
          </Button>
          {#if demo}
            <Button variant="ghost" dense onpress={() => demo.openAsRecipient(result!.link)}>
              {#snippet icon()}<Eye size={20} strokeWidth={1.75} />{/snippet}
              {t("ready.demo.open")}
            </Button>
          {/if}
        </div>
        {#if qrShown && !narrow.current}
          <figure class="qr">
            <QrCode text={result.link} label={t("ready.qr.alt")} />
            <figcaption>{t("ready.qr.caption")}</figcaption>
          </figure>
        {/if}
      </div>

      <div class="card" role="group" aria-label={t("ready.pw.title")} data-fan>
        <CopyField label={t("ready.pw.title")} value={result.password} whole />
        {#if canShare}
          <div class="row">
            <Button variant="secondary" dense onpress={sharePw}>
              {#snippet icon()}<Share2 size={20} strokeWidth={1.75} />{/snippet}
              {t("ready.share.pw")}
            </Button>
          </div>
        {/if}
      </div>

      <details class="card manage">
        <summary class="ct">
          <span>{t("ready.manage.title")}</span>
          <ChevronDown class="chev" size={20} strokeWidth={1.75} aria-hidden="true" />
        </summary>
        <div class="manage-body">
          <CopyField label={t("ready.manage.label")} value={result.manage} />
          <p class="hint">{t("ready.manage.hint")}</p>
        </div>
      </details>

      <div class="danger-zone">
        <InlineConfirm
          label={t("ready.delete")}
          message={t("ready.delete.confirm")}
          confirmLabel={t("ready.delete.yes")}
          kind="danger"
          triggerVariant="ghost"
          onconfirm={remove}
        >
          {#snippet icon()}<Trash2 size={20} strokeWidth={1.75} />{/snippet}
        </InlineConfirm>
        {#if deleteError}<p class="del-err" role="alert">{deleteError}</p>{/if}
      </div>

      <div class="done">
        <InlineConfirm
          label={t("ready.done")}
          message={t("ready.done.confirm")}
          confirmLabel={t("ready.done.yes")}
          triggerVariant="primary"
          onconfirm={done}
        />
      </div>
    </div>
  </section>

  <Sheet bind:open={qrSheet} title={t("ready.qr")}>
    <figure class="qr">
      <QrCode text={result.link} label={t("ready.qr.alt")} />
      <figcaption>{t("ready.qr.caption")}</figcaption>
    </figure>
  </Sheet>

{/if}

<style>
  /* Échéance en deux lignes (Deadline, retours UI4). */
  .when {
    margin: 0;
    font-size: var(--fs-small);
  }
  .ready,
  .gone {
    width: min(100%, 720px);
    margin-inline: auto;
    padding: var(--sp-6) var(--sp-4) var(--sp-8);
  }
  .panel {
    display: grid;
    gap: var(--sp-5);
  }
  .hd {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-5);
  }
  .mini {
    flex: none;
    display: grid;
    place-items: center;
    width: 96px;
    height: 60px;
    border: 2px solid var(--accent);
    border-radius: var(--r-pill);
    background: var(--accent-tint);
    color: var(--accent);
    view-transition-name: capsule;
  }
  .mini.dashed {
    border-style: dashed;
    border-color: var(--line-strong);
    background: transparent;
  }
  .hd-tx {
    display: grid;
    gap: var(--sp-1);
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--fs-ready);
    font-stretch: var(--wd-ready);
    letter-spacing: var(--ls-ready);
    line-height: 1.05;
  }
  .title:focus {
    outline: none;
  }
  .meta,
  .self {
    margin: 0;
    color: var(--text-2);
  }
  .active {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    justify-self: start;
    padding: 2px var(--sp-3);
    border-radius: var(--r-pill);
    background: var(--accent-tint);
    color: var(--accent);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .active .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .card {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
    padding: var(--sp-4);
    border: 1px solid var(--hair-2);
    border-radius: var(--r-xl);
    background: var(--vessel);
    box-shadow: var(--edge-hi);
  }
  .ct {
    margin: 0;
    font-size: var(--fs-h3);
    line-height: var(--lh-h3);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .hint {
    margin: 0;
    font-size: var(--fs-small);
    color: var(--text-2);
  }
  .qr {
    margin: 0;
    display: grid;
    justify-items: start;
    gap: var(--sp-2);
  }
  .qr figcaption {
    font-size: var(--fs-small);
    color: var(--text-2);
  }
  .never {
    max-width: none;
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    background: var(--warn-tint);
    color: var(--text);
    font-weight: 560;
  }
  .never :global(svg) {
    flex: none;
    color: var(--warn);
  }
  .manage {
    gap: 0;
  }
  .manage summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    min-height: 44px;
    cursor: pointer;
    list-style: none;
  }
  .manage summary::-webkit-details-marker {
    display: none;
  }
  .manage :global(.chev) {
    flex: none;
    color: var(--text-2);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .manage[open] :global(.chev) {
    transform: rotate(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .manage :global(.chev) {
      transition: none;
    }
  }
  .manage-body {
    display: grid;
    gap: var(--sp-3);
    padding-top: var(--sp-3);
  }
  .done {
    display: grid;
    justify-items: start;
    padding-top: var(--sp-4);
    border-top: 1px solid var(--line);
  }
  .danger-zone {
    display: grid;
    justify-items: start;
    gap: var(--sp-2);
  }
  .danger-zone :global(button.ghost) {
    color: var(--danger);
  }
  .del-err {
    margin: 0;
    color: var(--danger);
  }
  @media (max-width: 759px) {
    .ready {
      padding: var(--sp-2) 0 0;
    }
    .panel {
      gap: var(--sp-4);
    }
    .hd {
      gap: var(--sp-4);
      align-items: center;
    }
    .hd-tx {
      gap: var(--sp-2);
    }
    .mini {
      width: 56px;
      height: 56px;
      align-self: flex-start;
    }
    .card {
      padding: var(--sp-4);
      border-radius: var(--r-lg);
    }
    /* Actions d'une carte : deux colonnes égales, pleine largeur (pouce, alignement). */
    .card .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
    }
    .card .row :global(.btn) {
      width: 100%;
      justify-content: center;
    }
    /* Supprimer reste loin de la barre collée de Terminé (pas de geste raté). */
    .danger-zone {
      justify-items: stretch;
      margin-block-end: var(--sp-6);
    }
    /* Terminé, l'action principale, sous le pouce ; la suppression reste dans le fil. */
    .done {
      position: sticky;
      bottom: 0;
      z-index: 2;
      justify-items: stretch;
      margin-inline: calc(-1 * var(--sp-4));
      padding: var(--sp-2) var(--sp-4) calc(var(--sp-2) + env(safe-area-inset-bottom));
      background: var(--bg);
    }
  }
  .gone {
    display: grid;
    justify-items: start;
    gap: var(--sp-4);
  }
  .gone-logo {
    width: 180px;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
  }
</style>
