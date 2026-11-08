<script lang="ts">
  // Badges et avertissements d'un élément : nettoyage (marque « Nettoyé », « Original », ou
  // « Non nettoyé » avec sa raison courte, D41-23 : le fichier part sans clic), doublon,
  // programme à risque, illisible sans téléchargement. Une ligne chacun.
  import type { ComposeItem } from "../flows/compose.svelte";
  import { cleanLabelKey, cleanNoteKeys, uncleanedReasonKey } from "../media/clean-label";
  import { t } from "../i18n/i18n.svelte";
  import { ShieldAlert, ShieldCheck, TriangleAlert } from "./Icon";

  /** `badgesOnly` : les badges seuls ; `lines` : les avertissements seuls ; sinon les deux. */
  /** `unclean` : « only » la marque « Non nettoyé » seule (ligne du nom, ordinateur) ; « skip » sans elle. */
  type Props = { item: ComposeItem; cannotOpen?: boolean; badgesOnly?: boolean; lines?: boolean; unclean?: "only" | "skip" };
  let { item, cannotOpen = false, badgesOnly = false, lines = false, unclean }: Props = $props();
  const label = $derived(cleanLabelKey(item));
  const why = $derived(uncleanedReasonKey(item));
  const cleanNotes = $derived(cleanNoteKeys(item));
</script>

{#if unclean === "only"}
  {#if why}{@render mark(why)}{/if}
{:else if !lines}<span class="badges">
  {#if item.clean === "nettoye" && label}
    <span class="badge ok" data-clean="nettoye" title={t(label)}><ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />{t("clean.mark")}<span class="sr-only">. {t(label)}</span></span>
  {:else if item.clean === "original"}
    <span class="badge plain" data-clean="original" title={t("clean.original.hint")}>{t("clean.original")}<span class="sr-only">. {t("clean.original.hint")}</span></span>
  {:else if why && unclean !== "skip"}
    {@render mark(why)}
  {/if}
  {#if item.risky}<span class="badge danger">{t("compose.badge.risky")}</span>{/if}
  {#if item.duplicate}<span class="badge warn">{t("compose.duplicate")}</span>{/if}
</span>{/if}
{#if !badgesOnly && unclean !== "only"}
  {#if item.risky}<span class="line danger"><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{t(item.mismatch ? "compose.mismatch" : "compose.risky")}</span>{/if}
  {#each cleanNotes as k (k)}<span class="line warn" data-clean-note><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{t(k)}</span>{/each}
  {#if cannotOpen}<span class="line warn"><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{t("compose.cannotOpen")}</span>{/if}
{/if}

<!-- « Non nettoyé » bien visible, la raison courte en clair (D41-23) ; l'explication en infobulle. -->
{#snippet mark(why: NonNullable<ReturnType<typeof uncleanedReasonKey>>)}
  <span class="badge warn unclean" data-clean="non-nettoye" title={t("clean.uncleaned.hint")}><ShieldAlert size={13} strokeWidth={2} aria-hidden="true" /><span><b class="mk">{t("clean.mark.not")}</b> · {t(why)}<span class="sr-only">. {t("clean.uncleaned.hint")}</span></span></span>
{/snippet}

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
  /* La raison peut passer à la ligne sur téléphone (jamais de débordement). */
  .badge.unclean {
    align-items: flex-start;
    white-space: normal;
    border-radius: 8px;
  }
  .badge.unclean :global(svg) {
    flex: none;
    margin-top: 0.3em;
  }
  .mk {
    font-weight: 680;
  }
  @media (forced-colors: active) {
    .badge {
      border: 1px solid CanvasText;
    }
  }
</style>
