<script lang="ts">
  // Contenu d'un partage ouvert (UI §9.8, §9.10, §12.2) : éléments regroupés comme à l'envoi,
  // dans l'ordre du manifeste ; visionneuses natives ; Enregistrer si l'expéditeur l'a permis ;
  // pied : Terminer et effacer, Détruire pour tout le monde, Signaler. Les noms viennent de
  // safeName, les visionneuses de previewKind ; rien n'est écrit dans la console, le titre,
  // l'adresse ni un stockage. Le bandeau collé (temps restant) est la capsule d'Open.svelte.
  import { guardUnload } from "../app/lifecycle";
  import { destroyFromContent, finish, type DestroyOutcome } from "../flows/endoflife";
  import { CATEGORY_ORDER, categoryOfReceived, type Category } from "../flows/kinds";
  import { t, type Key } from "../i18n/i18n.svelte";
  import type { Opened } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { Eye, Flag, Trash2 } from "../ui/Icon";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import { reducedMotion } from "../ui/motion";
  import ReportSheet from "../ui/ReportSheet.svelte";
  import { previewQueue } from "../viewers/collect";
  import ReceivedItem from "../viewers/ReceivedItem.svelte";

  type ContentEnd = "finished" | Exclude<DestroyOutcome, "network">;
  type Props = {
    opened: Opened;
    /** Compte à rebours à zéro (porté par la capsule d'Open). */
    expired: boolean;
    /** Fin de lecture : la capsule passe à l'état voulu. */
    onend: (kind: "finished" | "destroyed" | "gone") => void;
  };
  let { opened, expired, onend }: Props = $props();

  const viewOnly = $derived(opened.manifest.rights === "voir");
  const CAT_KEY: Record<Category, Key> = {
    texte: "compose.cat.text",
    photos: "compose.cat.photos",
    videos: "compose.cat.videos",
    audio: "compose.cat.audio",
    documents: "compose.cat.documents",
    archives: "compose.cat.archives",
    autres: "compose.cat.autres",
  };
  const groups = $derived.by(() => {
    const by = new Map<Category, number[]>();
    opened.manifest.items.forEach((e, i) => {
      const c = categoryOfReceived(e.kind, opened.previewKind(i), opened.safeName(i), e.mime);
      by.set(c, [...(by.get(c) ?? []), i]);
    });
    return CATEGORY_ORDER.filter((c) => by.has(c)).map((c) => ({ c, items: by.get(c)! }));
  });

  const queue = previewQueue();
  let busy = $state(0);
  const onbusy = (d: 1 | -1) => (busy = Math.max(0, busy + d));
  // UI §9.8 : avertir avant de quitter seulement pendant un aperçu ou un enregistrement.
  $effect(() => guardUnload(() => busy > 0));

  let gone = $state(false);
  let ended = $state<ContentEnd | null>(null);
  const disabled = $derived(expired || gone || ended !== null);
  let wiped = false;

  // UI §12.2 : sortie de page → done (keepalive), wipe, révocation. Démontage (nouveau lien
  // collé dans la barre, autre route) : même effacement.
  function leave() {
    if (wiped) return;
    wiped = true;
    void finish(opened);
  }
  $effect(() => () => leave());

  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (!heading) return;
    heading.focus({ preventScroll: true });
    announce(t("content.title"));
  });

  // ---------- Dissolution (UI §7.4, repli fondu et flou) : après la réponse ou l'effacement ----------
  let panel: HTMLDivElement | undefined = $state();
  async function dissolve(): Promise<void> {
    if (!panel || typeof panel.animate !== "function") return;
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

  // La fin s'affiche dans Open (Ended.svelte), une fois cet écran démonté.
  function arrive(kind: ContentEnd) {
    ended = kind;
    onend(kind);
  }

  async function finishNow() {
    if (ended !== null) return;
    wiped = true;
    await finish(opened);
    await dissolve();
    arrive("finished");
  }

  let destroyError = $state("");
  async function destroy(report: boolean): Promise<string | null> {
    if (ended !== null || wiped) return null;
    destroyError = "";
    let dissolving: Promise<void> = Promise.resolve();
    const out = await destroyFromContent(opened, report, { onDestroyed: () => (dissolving = dissolve()) });
    if (out === "network") {
      if (!report) destroyError = t("content.destroy.net");
      return t("content.destroy.net");
    }
    wiped = true;
    reportOpen = false;
    await dissolving;
    arrive(out);
    return null;
  }
  let reportOpen = $state(false);
</script>

<svelte:window onpagehide={leave} />

  <div class="content" bind:this={panel}>
    <h1 class="title" tabindex="-1" bind:this={heading}>{t("content.title")}</h1>
    {#if viewOnly}
      <p class="notice"><Eye size={18} aria-hidden="true" /> <span>{t("content.viewOnly")}</span></p>
    {/if}
    {#if gone}
      <p class="alert" role="alert">{t("content.gone")}</p>
    {/if}

    {#each groups as g (g.c)}
      <section class="group" aria-labelledby="g-{g.c}">
        <h2 id="g-{g.c}" class="gh">{t(CAT_KEY[g.c])}<span class="sr-only">,</span> <span class="count num">{g.items.length}</span></h2>
        <ul class="items">
          {#each g.items as i (i)}
            <ReceivedItem {opened} {i} {queue} {disabled} {expired} {viewOnly} {onbusy} ongone={() => (gone = true)} />
          {/each}
        </ul>
      </section>
    {/each}

    <footer class="eol" data-eol>
      <Button variant="secondary" onpress={finishNow}>{t("content.finish")}</Button>
      {#if !gone}
        <div class="danger-zone">
          <p class="hint">{t("content.destroy.hint")}</p>
          <div class="row">
            <InlineConfirm
              label={t("content.destroy")}
              message={t("content.destroy.confirm")}
              confirmLabel={t("content.destroy.yes")}
              kind="danger"
              triggerVariant="ghost"
              onconfirm={async () => void (await destroy(false))}
            >
              {#snippet icon()}<Trash2 size={18} />{/snippet}
            </InlineConfirm>
            <Button variant="ghost" onpress={() => void (reportOpen = true)}>
              {#snippet icon()}<Flag size={18} />{/snippet}
              {t("content.report")}
            </Button>
          </div>
          {#if destroyError}<p class="err" role="alert">{destroyError}</p>{/if}
        </div>
      {/if}
    </footer>
  </div>
  <ReportSheet bind:open={reportOpen} onconfirm={() => destroy(true)} />

<style>
  .content {
    display: grid;
    gap: var(--sp-5);
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--fs-h1);
    font-weight: var(--fw-h1);
    font-stretch: var(--wd-h1);
    line-height: var(--lh-h1);
  }
  .title:focus {
    outline: none;
  }
  .notice {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    border: 1px solid var(--hair-2);
    color: var(--text-2);
    max-width: 65ch;
  }
  .alert {
    margin: 0;
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-lg);
    background: var(--warn-tint);
    color: var(--warn);
    max-width: 65ch;
  }
  .group {
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }
  .gh {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    font-size: var(--fs-h3);
    font-weight: var(--fw-h3);
  }
  .count {
    color: var(--text-3);
    font-size: var(--fs-small);
    font-weight: 500;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .items {
    margin: 0;
    padding: 0 var(--sp-4);
    list-style: none;
    border: 1px solid var(--hair-2);
    border-radius: var(--r-xl);
    background: var(--vessel);
    box-shadow: var(--edge-hi);
    min-width: 0;
  }
  .eol {
    display: grid;
    justify-items: start;
    gap: var(--sp-5);
    margin-top: var(--sp-4);
    padding-top: var(--sp-5);
    border-top: 1px solid var(--line);
  }
  .danger-zone {
    display: grid;
    justify-items: start;
    gap: var(--sp-2);
  }
  .danger-zone .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .danger-zone :global(button.ghost) {
    color: var(--danger);
  }
  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .err {
    margin: 0;
    color: var(--danger);
  }
</style>
