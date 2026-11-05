<script lang="ts">
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
</script>

<section class="nf">
  <h1 tabindex="-1">{t("notfound.title")}</h1>
  <p><a class="back" href={href("/")} onclick={(e) => followLink(e, "/")}>{t("notfound.home")}</a></p>
</section>

<style>
  .nf {
    padding-block: var(--sp-8);
    display: grid;
    gap: var(--sp-4);
  }
  h1:focus {
    outline: none;
  }
  .back {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent);
    text-underline-offset: 0.2em;
  }
  @media (hover: hover) {
    .back:hover {
      color: var(--accent-hover);
    }
  }
</style>
