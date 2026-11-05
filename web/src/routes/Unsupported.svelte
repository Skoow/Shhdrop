<script lang="ts">
  import { t } from "../i18n/i18n.svelte";
</script>

<!-- UI §9.11 : une capacité de §9 manque ; aucune route ne démarre, rien n'est envoyé. -->
<section class="unsupported">
  <h1 tabindex="-1">{t("unsupported")}</h1>
</section>

<style>
  .unsupported {
    padding-block: var(--sp-8);
  }
  h1 {
    font-size: var(--fs-h2);
    line-height: var(--lh-h2);
    max-width: 36ch;
  }
  h1:focus {
    outline: none;
  }
</style>
