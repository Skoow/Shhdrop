<script lang="ts">
  // Reçu de destruction (benchmark S4) : affiché seulement après la réponse du serveur à
  // Détruire ou Signaler (jamais pour « Terminer et effacer »). Dit ce qui est effacé, et ce
  // qui ne l'est pas : jamais « il n'existe plus nulle part ».
  import { t } from "../i18n/i18n.svelte";
</script>

<section class="receipt" aria-label={t("receipt.title")} data-receipt>
  <p class="line">{t("receipt.erased")}</p>
  <p class="line">{t("receipt.kept")}</p>
</section>

<style>
  .receipt {
    display: grid;
    gap: var(--sp-2);
    padding: var(--sp-4);
    border: 1px dashed var(--line-strong);
    border-radius: var(--r-lg);
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    color: var(--text-2);
    max-width: 60ch;
  }
  .line {
    margin: 0;
  }
  @media (forced-colors: active) {
    .receipt {
      border-color: CanvasText;
    }
  }
</style>
