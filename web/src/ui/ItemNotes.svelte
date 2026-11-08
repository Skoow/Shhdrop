<script lang="ts">
  // Badges et avertissements d'un élément : nettoyage (marque « Nettoyé », « Original », ou
  // « Non nettoyé » avec le choix Envoyer tel quel / Retirer), doublon, programme à risque,
  // archive (contenu ni vérifié ni nettoyé), illisible sans téléchargement. Une ligne chacun.
  import type { ComposeItem } from "../flows/compose.svelte";
  import { cleanLabelKey, needsChoice } from "../media/clean-label";
  import { t } from "../i18n/i18n.svelte";
  import { FileArchive, ShieldAlert, ShieldCheck, TriangleAlert } from "./Icon";

  /** `badgesOnly` : les badges seuls ; `lines` : les avertissements seuls ; sinon les deux. */
  type Props = { item: ComposeItem; cannotOpen?: boolean; badgesOnly?: boolean; lines?: boolean; onaccept?: () => void; onremove?: () => void };
  let { item, cannotOpen = false, badgesOnly = false, lines = false, onaccept, onremove }: Props = $props();
  const label = $derived(cleanLabelKey(item));
  const choose = $derived(needsChoice(item));
  const name = $derived(item.base + item.ext);
</script>

{#if !lines}<span class="badges">
  {#if item.clean === "nettoye" && label}
    <span class="badge ok" data-clean="nettoye" title={t(label)}><ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />{t("clean.mark")}<span class="sr-only">. {t(label)}</span></span>
  {:else if item.clean === "original"}
    <span class="badge plain" data-clean="original" title={t("clean.original.hint")}>{t("clean.original")}<span class="sr-only">. {t("clean.original.hint")}</span></span>
  {:else if label && !choose}
    <span class="badge warn" data-clean="tel-quel" title={t("clean.accepted")}><ShieldAlert size={13} strokeWidth={2} aria-hidden="true" />{t("clean.mark.not")}<span class="sr-only">. {t("clean.accepted")}</span></span>
  {/if}
  {#if item.risky}<span class="badge danger">{t("compose.badge.risky")}</span>{/if}
  {#if item.duplicate}<span class="badge warn">{t("compose.duplicate")}</span>{/if}
</span>{/if}
{#if !badgesOnly}
  {#if choose && label}
    <span class="line warn choice" data-clean={item.clean}>
      <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" /><span>{t(label)}</span>
      {#if onaccept || onremove}
        <span class="acts">
          {#if onaccept}<button type="button" class="act" aria-label={t("clean.sendAsIs.label", { name })} onclick={onaccept}>{t("clean.sendAsIs")}</button>{/if}
          {#if onremove}<button type="button" class="act" aria-label={t("clean.remove.label", { name })} onclick={onremove}>{t("clean.remove")}</button>{/if}
        </span>
      {/if}
    </span>
  {/if}
  {#if item.risky}<span class="line danger"><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{t(item.mismatch ? "compose.mismatch" : "compose.risky")}</span>{/if}
  {#if item.category === "archives"}<span class="line info"><FileArchive size={14} strokeWidth={2} aria-hidden="true" />{t("compose.meta.archive")}</span>{/if}
  {#if cannotOpen}<span class="line warn"><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{t("compose.cannotOpen")}</span>{/if}
{/if}

<style>
  .badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px 6px;
  }
  .badges:empty {
    display: none;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    border-radius: var(--r-pill);
    font-size: var(--fs-micro);
    font-weight: 560;
    line-height: 1.6;
    white-space: nowrap;
  }
  .badge.ok {
    background: var(--accent-tint);
    color: var(--accent);
  }
  .badge.warn {
    background: var(--warn-tint);
    color: var(--warn);
  }
  .badge.plain {
    background: var(--surface-2, transparent);
    color: var(--text-2);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .badge.danger {
    background: var(--danger-tint);
    color: var(--danger);
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    font-size: var(--fs-micro);
    font-weight: 540;
    line-height: 1.45;
  }
  .line :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .line.warn {
    color: var(--warn);
  }
  .line.danger {
    color: var(--danger);
  }
  .choice {
    flex-wrap: wrap;
  }
  .choice > span:not(.acts) {
    flex: 1 1 12rem;
  }
  .acts {
    display: inline-flex;
    gap: 6px;
  }
  .act {
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid currentColor;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-weight: 620;
    cursor: pointer;
  }
  @media (pointer: coarse) {
    .act {
      min-height: 44px;
    }
  }
  .act:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .line.info {
    color: var(--text-2);
  }
  @media (forced-colors: active) {
    .badge {
      border: 1px solid CanvasText;
    }
  }
</style>
