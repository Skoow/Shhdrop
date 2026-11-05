<script module lang="ts">
  export const MARK = "__SHH_DEMO__";
</script>

<script lang="ts">
  // Bandeau permanent de la démo (UI §14.3) : en haut de toutes les pages, non fermable.
  // Le texte vit ici, pas dans le dictionnaire de production (check-dist.mjs l'y interdit).
  import { getLang } from "../i18n/i18n.svelte";
  import { TriangleAlert } from "../ui/Icon";

  const TEXT = {
    fr: "Démo : rien n'est envoyé, le lien ne marche que dans cet onglet.",
    en: "Demo: nothing is sent, the link only works in this tab.",
  } as const;
</script>

<div class="demo-banner" role="note" data-demo={MARK}>
  <p class="in">
    <span class="ic" aria-hidden="true"><TriangleAlert size={18} strokeWidth={1.75} /></span>
    <span>{TEXT[getLang()]}</span>
  </p>
</div>

<style>
  .demo-banner {
    background: var(--warn-tint);
    border-block-end: 1px solid var(--line);
    color: var(--text);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
  }
  .in {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--sp-2) max(var(--sp-4), env(safe-area-inset-right)) var(--sp-2) max(var(--sp-4), env(safe-area-inset-left));
  }
  @media (min-width: 600px) {
    .in {
      padding-inline: max(var(--sp-5), env(safe-area-inset-left)) max(var(--sp-5), env(safe-area-inset-right));
    }
  }
  .ic {
    display: inline-flex;
    flex: none;
    padding-block-start: 1px;
    color: var(--warn);
  }
  @media (forced-colors: active) {
    .demo-banner {
      border-block-end-color: CanvasText;
    }
  }
</style>
