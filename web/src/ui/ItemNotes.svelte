<script lang="ts">
  // Badges et avertissements d'un élément : doublon, programme à risque, illisible sans
  // téléchargement. Une ligne chacun. L'état du nettoyage n'est plus ici (D41-34, retours UI7) :
  // il est dans la bulle du cadenas, avec une petite marque à côté du type (ItemRow).
  import type { ComposeItem } from "../flows/compose.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { TriangleAlert } from "./Icon";

  /** `badgesOnly` : les badges seuls ; `lines` : les avertissements seuls ; sinon les deux. */
  type Props = { item: ComposeItem; cannotOpen?: boolean; badgesOnly?: boolean; lines?: boolean };
  let { item, cannotOpen = false, badgesOnly = false, lines = false }: Props = $props();
</script>

{#if !lines}<span class="badges">
  {#if item.risky}<span class="badge danger">{t("compose.badge.risky")}</span>{/if}
  {#if item.duplicate}<span class="badge warn">{t("compose.duplicate")}</span>{/if}
</span>{/if}
{#if !badgesOnly}
  {#if item.risky}<span class="line danger"><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />{t(item.mismatch ? "compose.mismatch" : "compose.risky")}</span>{/if}
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
  .badge.warn {
    background: var(--warn-tint);
    color: var(--warn);
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
  @media (forced-colors: active) {
    .badge {
      border: 1px solid CanvasText;
    }
  }
</style>
