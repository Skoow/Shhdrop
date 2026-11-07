<script lang="ts">
  // « Lien prêt » (UI §9.5) : affiché seulement après la résolution de createShare. Deux cartes
  // pour deux secrets (M18, S2) : le lien (Copier, Partager, QR) et le mot de passe (Copier,
  // dictée), séparées par le rappel ; lien de gestion ; Vider le presse-papier ; Terminé ;
  // Supprimer ce partage. Les valeurs ne viennent que des props (Copier lit l'état, jamais le
  // DOM) ; rien n'est écrit dans la console, le titre, l'URL ou un stockage.
  import { tick } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { getDemo } from "../app/demo-hooks";
  import { dictate } from "../flows/dictate";
  import { clockText, roundQuarter } from "../flows/ready";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { NotFoundError, destroyShare } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { clearClipboard } from "../ui/clipboard";
  import CopyField from "../ui/CopyField.svelte";
  import { AudioLines, ClipboardX, Eye, Lock, QrCode, Share2, Trash2 } from "../ui/Icon";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import Logo from "../ui/Logo.svelte";
  import { reducedMotion } from "../ui/motion";
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

  // Échéance fixée à l'arrivée sur l'écran (expiresInS est relatif à la réponse de finalize).
  const expiresAt = $derived.by(() => Date.now() + (result?.expiresInS ?? 0) * 1000);
  const around = $derived(clockText(roundQuarter(expiresAt), lang));
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
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function share() {
    if (!result) return;
    try {
      await navigator.share({ url: result.link }); // jamais le mot de passe
    } catch {
      /* annulé par l'utilisateur */
    }
  }
  let qrShown = $state(false);
  let qrSheet = $state(false);
  function toggleQr() {
    if (narrow.current) qrSheet = true;
    else qrShown = !qrShown;
  }

  // ---------- Dictée du mot de passe (S5) ----------
  let dictating = $state(false);
  let pos = $state(0);
  const chars = $derived(result ? dictate(result.password, lang) : []);
  function dictKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") pos = Math.min(chars.length - 1, pos + 1);
    else if (e.key === "ArrowLeft") pos = Math.max(0, pos - 1);
  }

  async function clearClip() {
    await clearClipboard();
    announce(t("ready.cleared"));
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
          <h2 id="ready-title" class="title" tabindex="-1" bind:this={heading}>{t("ready.title")}</h2>
          <p class="meta num">{summary}</p>
          <p class="active num"><span class="dot" aria-hidden="true"></span>{t("ready.active", { time: around })}</p>
          <p class="self">{selfDestruct}</p>
        </div>
      </header>

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
            {#snippet icon()}<QrCode size={20} strokeWidth={1.75} />{/snippet}
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
            {#await import("../ui/QrCode.svelte") then m}<m.default text={result.link} label={t("ready.qr.alt")} />{/await}
            <figcaption>{t("ready.qr.caption")}</figcaption>
          </figure>
        {/if}
      </div>

      <p class="two" data-fan>{t("ready.two")}</p>

      <div class="card" role="group" aria-label={t("ready.pw.title")} data-fan>
        <CopyField label={t("ready.pw.title")} value={result.password} />
        <p class="hint">{t("ready.pw.reminder")}</p>
        <div class="row">
          <Button variant="ghost" dense onpress={() => {
            pos = 0;
            dictating = true;
          }}>
            {#snippet icon()}<AudioLines size={20} strokeWidth={1.75} />{/snippet}
            {t("ready.dictate")}
          </Button>
        </div>
      </div>

      <section class="card manage" aria-labelledby="g-manage">
        <h3 id="g-manage" class="ct">{t("ready.manage.title")}</h3>
        <CopyField label={t("ready.manage.label")} value={result.manage} />
        <p class="hint">{t("ready.manage.hint")}</p>
      </section>

      <div class="clip">
        <p class="never"><ClipboardX size={18} strokeWidth={1.75} aria-hidden="true" />{t("ready.never")}</p>
        <Button variant="ghost" dense onpress={clearClip}>{t("ready.clear")}</Button>
        <p class="hint">{t("ready.clear.note")}</p>
      </div>

      <div class="done">
        <InlineConfirm label={t("ready.done")} message={t("ready.done.confirm")} confirmLabel={t("ready.done.yes")} onconfirm={done} />
      </div>

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
    </div>
  </section>

  <Sheet bind:open={qrSheet} title={t("ready.qr")}>
    <figure class="qr">
      {#await import("../ui/QrCode.svelte") then m}<m.default text={result.link} label={t("ready.qr.alt")} />{/await}
      <figcaption>{t("ready.qr.caption")}</figcaption>
    </figure>
  </Sheet>

  <Sheet bind:open={dictating} title={t("ready.dictate.title")}>
    {#if chars.length > 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="dict" onkeydown={dictKey}>
        <p class="big" translate="no" aria-hidden="true">{chars[pos]!.ch}</p>
        <p class="lab" aria-live="polite">{chars[pos]!.label}</p>
        <p class="pos num">{t("ready.dictate.pos", { pos: pos + 1, count: chars.length })}</p>
        <div class="row">
          <Button variant="secondary" disabled={pos === 0} onpress={() => {
            pos = Math.max(0, pos - 1);
          }}>{t("ready.dictate.prev")}</Button>
          <Button variant="primary" disabled={pos >= chars.length - 1} onpress={() => {
            pos = Math.min(chars.length - 1, pos + 1);
          }}>{t("ready.dictate.next")}</Button>
        </div>
      </div>
    {/if}
  </Sheet>
{/if}

<style>
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
  .two {
    margin: 0;
    padding: var(--sp-3) var(--sp-4);
    border-left: 2px solid var(--accent);
    color: var(--text);
    font-weight: 560;
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
  .clip {
    display: grid;
    justify-items: start;
    gap: var(--sp-2);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--line);
  }
  .never {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--text-2);
  }
  .done {
    display: grid;
    justify-items: start;
  }
  .danger-zone {
    display: grid;
    justify-items: start;
    gap: var(--sp-2);
    margin-top: var(--sp-6);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--line);
  }
  .danger-zone :global(button.ghost) {
    color: var(--danger);
  }
  .del-err {
    margin: 0;
    color: var(--danger);
  }
  @media (max-width: 759px) {
    .hd {
      gap: var(--sp-4);
    }
    .mini {
      width: 72px;
      height: 46px;
    }
    .danger-zone {
      position: sticky;
      bottom: 0;
      z-index: 2;
      margin-inline: calc(-1 * var(--sp-4));
      padding: var(--sp-2) var(--sp-4) calc(var(--sp-2) + env(safe-area-inset-bottom));
      background: var(--bg);
    }
  }
  .dict {
    display: grid;
    justify-items: center;
    gap: var(--sp-3);
    padding: var(--sp-4) 0;
  }
  .big {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 6rem;
    line-height: 1;
  }
  .lab {
    margin: 0;
    font-size: var(--fs-h3);
  }
  .pos {
    margin: 0;
    color: var(--text-2);
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
