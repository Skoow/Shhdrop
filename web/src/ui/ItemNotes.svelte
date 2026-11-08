<script lang="ts">
  // Badges et avertissements d'un élément : nettoyage (marque « Nettoyé », « Original », ou
  // « Non nettoyé » avec sa raison courte, D41-23 : le fichier part sans clic), doublon,
  // programme à risque, illisible sans téléchargement. Une ligne chacun.
  import type { ComposeItem } from "../flows/compose.svelte";
  import { cleanLabelKey, intactKey, uncleanedReasonKey } from "../media/clean-label";
  import { t } from "../i18n/i18n.svelte";
  import { ShieldAlert, ShieldCheck, TriangleAlert } from "./Icon";
  import Tip from "./Tip.svelte";

  /** `badgesOnly` : les badges seuls ; `lines` : les avertissements seuls ; sinon les deux. */
  /** `unclean` : « only » la marque « Non nettoyé » seule (ligne du nom, ordinateur) ; « skip » sans elle. */
  type Props = { item: ComposeItem; cannotOpen?: boolean; badgesOnly?: boolean; lines?: boolean; unclean?: "only" | "skip" };
  let { item, cannotOpen = false, badgesOnly = false, lines = false, unclean }: Props = $props();
  const label = $derived(cleanLabelKey(item));
  const why = $derived(uncleanedReasonKey(item));
  const intact = $derived(intactKey(item));
</script>

{#if unclean === "only"}
  {#if why}{@render mark(why)}{/if}
{:else if !lines}<span class="badges">
  {#if item.clean === "nettoye" && label}
    <!-- « Nettoyé » : le bouclier seul sur la ligne, le détail dans la bulle (retours UI4). -->
    <Tip class="mark ok" data-clean="nettoye" label={t("clean.mark")} tip={t(label)}><ShieldCheck size={15} strokeWidth={2.1} aria-hidden="true" /></Tip>
  {:else if intact && label}
    <!-- PDF ou archive laissés intacts par décision (D41-27) : pastille neutre, pas d'alerte. -->
    <Tip class="badge plain" data-clean="intact" label={t(intact)} tip={t(label)}>{t(intact)}</Tip>
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
  {#if cannotOpen}<span class="line warn"><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{t("compose.cannotOpen")}</span>{/if}
{/if}

<!-- « Non nettoyé » : petite pastille toujours visible (D41-23) ; la raison et l'explication dans la bulle (retours UI4). -->
{#snippet mark(why: NonNullable<ReturnType<typeof uncleanedReasonKey>>)}
  <Tip class="badge warn" data-clean="non-nettoye" label={`${t("clean.mark.not")} · ${t(why)}`} tip={`${t("clean.mark.not")} · ${t(why)}. ${t("clean.uncleaned.hint")}`}><ShieldAlert size={13} strokeWidth={2} aria-hidden="true" /><b class="mk">{t("clean.mark.not")}</b></Tip>
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
  .badge,
  :global(button.tip.badge) {
    margin: 0;
    min-block-size: 24px;
    min-inline-size: 0;
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
  :global(button.tip.mark.ok) {
    color: var(--accent);
  }
  .badge.warn,
  :global(button.tip.badge.warn) {
    background: var(--warn-tint);
    color: var(--warn);
  }
  .badge.plain,
  :global(button.tip.badge.plain) {
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
  .mk {
    font-weight: 680;
  }
  @media (forced-colors: active) {
    .badge {
      border: 1px solid CanvasText;
    }
  }
</style>
