<script lang="ts">
  // Carte d'un partage de l'historique (UI §9.6.3) : état (mot + icône), création locale,
  // ouvertures, échéance, taille, nombre d'éléments ; jamais un nom d'élément (spec §33).
  // Données locales seulement ; ouvertures et état relus du serveur sur demande (Actualiser,
  // Détails), par le parent. `compact` : accueil (une ligne de mesures).
  import { formatAgo, formatBytes, formatClock, formatDayTime, formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import type { ShareInfo } from "../history/live.svelte";
  import { effectiveState, type HistoryEntry } from "../history/store";
  import { announce } from "./announce";
  import Button from "./Button.svelte";
  import { copyText } from "./clipboard";
  import DestroyReceipt from "./DestroyReceipt.svelte";
  import { ChevronDown, Copy, RefreshCw, Trash2, X } from "./Icon";
  import InlineConfirm from "./InlineConfirm.svelte";
  import { reducedMotion } from "./motion";
  import StateChip from "./StateChip.svelte";

  type Props = {
    entry: HistoryEntry;
    /** Heure courante (ms), donnée par le parent (une minuterie pour toute la liste). */
    now: number;
    compact?: boolean;
    info?: ShareInfo;
    onrefresh: () => Promise<void>;
    ondestroy: () => Promise<boolean>;
    onremove: () => void;
  };
  let { entry, now, compact = false, info = {}, onrefresh, ondestroy, onremove }: Props = $props();
  const lang = $derived(getLang());
  const uid = $props.id();

  const shown = $derived(effectiveState(entry, now));
  const active = $derived(shown === "ready" || shown === "draining");
  const leftS = $derived(Math.max(0, (entry.expiresAt - now) / 1000));
  const created = $derived(t("hist.created", { ago: formatAgo(now - entry.createdAt, lang), date: formatDayTime(entry.createdAt, lang) }));
  const opens = $derived(t("hist.opens", { u: entry.opensUsed, max: entry.maxOpens }));
  // L'échéance du serveur est au quart d'heure ; arrondie à la minute pour l'affichage.
  const endsAt = $derived(Math.round(entry.expiresAt / 60_000) * 60_000);
  const ends = $derived(t("hist.ends", { time: formatDayTime(endsAt, lang) }));
  const errorText = $derived(
    info.error === "reseau"
      ? t("hist.err.reseau")
      : info.error === "limite"
        ? t("hist.err.limite", { duration: formatDuration(info.retryAfterS ?? 60, lang) })
        : info.error === "serveur"
          ? t("hist.err.serveur")
          : "",
  );
  const freshText = $derived(info.nextAt && info.nextAt > now ? t("hist.fresh", { duration: formatDuration((info.nextAt - now) / 1000, lang) }) : "");

  let open = $state(false);
  let copyNote = $state("");
  let el: HTMLLIElement | undefined = $state();

  async function copy() {
    const r = await copyText(entry.manage);
    copyNote = r === "copied" ? t("hist.copied") : t("hist.copy.manual");
    announce(copyNote);
  }
  function toggle() {
    open = !open;
    // Carte ouverte : une relecture (au plus une fois toutes les 5 min, après une gigue).
    if (open && active) void onrefresh();
  }
  async function destroy() {
    const ok = await ondestroy();
    if (!ok) return;
    // Dissolution après la réponse du serveur seulement (UI §7.4).
    if (el && typeof el.animate === "function" && !reducedMotion()) {
      await el
        .animate([{ opacity: 1, filter: "blur(0)" }, { opacity: 0.35, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 420, easing: "cubic-bezier(0.65, 0, 0.35, 1)" })
        .finished.catch(() => undefined);
    }
    announce(t("hist.destroyed"));
  }
</script>

<li class={["card", { compact, ended: !active }]} bind:this={el} aria-labelledby="{uid}-s {uid}-c" data-share-card data-state={shown}>
  <div class="hd">
    <StateChip id="{uid}-s" state={shown} destroyedHere={entry.destroyedHere} />
    <p class="created" id="{uid}-c"><time datetime={new Date(entry.createdAt).toISOString()}>{created}</time></p>
  </div>

  <ul class="m num" role="list">
    <li data-opens>{opens}</li>
    {#if active}<li data-expires>{t("hist.expires", { duration: formatDuration(leftS, lang) })}</li>{/if}
    <li>{formatBytes(entry.sizeBytes, lang)}</li>
    <li>{t("hist.items", { n: entry.itemsCount })}</li>
  </ul>

  {#if shown === "draining"}<p class="sub">{t("manage.draining")}</p>{/if}
  {#if shown === "expired"}<p class="sub">{t("hist.expired.note")}</p>{/if}
  {#if shown === "gone" && !entry.destroyedHere}<p class="sub">{t("hist.erased.note")}</p>{/if}
  {#if shown === "gone" && entry.destroyedHere && !compact}<DestroyReceipt />{/if}
  {#if errorText}<p class="stale" role="status" data-stale><span class="tag">{t("hist.stale")}</span> {errorText}</p>{/if}
  {#if info.destroyError}<p class="err" role="alert">{t("hist.destroy.net")}</p>{/if}

  <div class="acts">
    {#if active}
      {#if !compact}
        <Button variant="secondary" dense onpress={copy}>
          {#snippet icon()}<Copy size={18} strokeWidth={1.75} />{/snippet}
          {t("hist.copy")}
        </Button>
      {:else}
        <Button variant="ghost" dense busy={info.busy === true} onpress={onrefresh}>
          {#snippet icon()}<RefreshCw size={18} strokeWidth={1.75} />{/snippet}
          {t("hist.refresh")}
        </Button>
      {/if}
      <InlineConfirm
        label={t("hist.destroy")}
        message={t("hist.destroy.confirm")}
        confirmLabel={t("hist.destroy.yes")}
        kind="danger"
        triggerVariant="danger"
        dense
        onconfirm={destroy}
      >
        {#snippet icon()}<Trash2 size={18} strokeWidth={1.75} />{/snippet}
      </InlineConfirm>
    {:else}
      <Button variant="ghost" dense onpress={onremove}>
        {#snippet icon()}<X size={18} strokeWidth={1.75} />{/snippet}
        {t("hist.remove")}
      </Button>
    {/if}
    {#if !compact}
      <button type="button" class="more" aria-expanded={open} aria-controls="{uid}-d" onclick={toggle}>
        {t("hist.details")}<ChevronDown class="chev" size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    {/if}
  </div>
  {#if copyNote}<p class="sub" role="status">{copyNote}</p>{/if}

  {#if !compact}
    <div class="details" id="{uid}-d" hidden={!open}>
      <p class="sub">{t("hist.server", { size: formatBytes(entry.sizeBytes, lang), ends, opens })}</p>
      {#if entry.opens.length === 0}
        <p class="sub">{t("hist.opened.none")}</p>
      {:else}
        <ul class="opens" role="list">
          {#each entry.opens as o (o.count)}
            <li class="num">{t("hist.opened.between", { from: formatClock(o.between[0], lang), to: formatClock(o.between[1], lang) })} · {o.count} / {entry.maxOpens}</li>
          {/each}
        </ul>
      {/if}
      {#if active}
        <div class="row">
          <Button variant="ghost" dense busy={info.busy === true} onpress={onrefresh}>
            {#snippet icon()}<RefreshCw size={18} strokeWidth={1.75} />{/snippet}
            {t("hist.refresh")}
          </Button>
          <p class="sub num" data-seen>{t("hist.seen", { ago: formatAgo(now - entry.lastSeenAt, lang) })}</p>
        </div>
        {#if freshText}<p class="sub" role="status" data-fresh>{freshText}</p>{/if}
      {:else}
        <p class="sub">{t("hist.autoremove")}</p>
      {/if}
      <p class="sub">{t("hist.nolink")}</p>
    </div>
  {:else if active}
    <p class="sub num seen" data-seen>{t("hist.seen", { ago: formatAgo(now - entry.lastSeenAt, lang) })}</p>
    {#if freshText}<p class="sub" role="status" data-fresh>{freshText}</p>{/if}
  {/if}
</li>

<style>
  .card {
    display: grid;
    align-content: start;
    gap: var(--sp-3);
    min-width: 0;
    padding: var(--sp-4);
    border: 1px solid var(--hair-2);
    border-radius: var(--r-xl);
    background: var(--vessel);
    box-shadow: var(--edge-hi);
  }
  .card.compact {
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-lg);
  }
  .card.ended {
    opacity: 0.78;
  }
  .hd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
  }
  .created {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .m {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1) var(--sp-4);
    margin: 0;
    padding: 0;
    list-style: none;
    font-weight: 600;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .sub {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    max-width: 62ch;
  }
  .stale {
    margin: 0;
    font-size: var(--fs-small);
    color: var(--text);
  }
  .tag {
    padding: 0 6px;
    border-radius: 6px;
    background: var(--warn-tint);
    color: var(--warn);
    font-weight: 600;
  }
  .err {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-small);
  }
  .acts,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    margin-inline-start: auto;
    padding: 0 var(--sp-2);
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--text-2);
    font: inherit;
    font-weight: 560;
    cursor: pointer;
  }
  .more:hover {
    color: var(--text);
  }
  .more :global(.chev) {
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .more[aria-expanded="true"] :global(.chev) {
    transform: rotate(180deg);
  }
  .details {
    display: grid;
    gap: var(--sp-2);
    padding-top: var(--sp-3);
    border-top: 1px solid var(--line);
  }
  .details[hidden] {
    display: none;
  }
  .opens {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
    font-size: var(--fs-small);
  }
  @media (prefers-reduced-motion: reduce) {
    .more :global(.chev) {
      transition: none;
    }
  }
  @media (max-width: 759px) {
    .card {
      padding: var(--sp-4);
      border-radius: var(--r-lg);
    }
  }
</style>
