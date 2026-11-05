<script lang="ts">
  import type { Snippet } from "svelte";
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import Schema from "../ui/Schema.svelte";

  type Props = {
    /** Vrai dès qu'un élément est ajouté : le titre se replie (UI §9.1), le reste du Persuade part. */
    compact?: boolean;
    /** Le composeur (Task 10). Sans lui, un emplacement réservé de la hauteur de la rangée d'ajout. */
    children?: Snippet;
  };
  let { compact = false, children }: Props = $props();
</script>

<div class="home">
  <header class="hero" class:compact>
    <h1 tabindex="-1" class:compact>{t("hero.title")}</h1>
    {#if !compact}
      <div class="body">
        <div class="say">
          <p class="lede">{t("hero.lede")}</p>
          <a class="how" href={href("/securite")} onclick={(e) => followLink(e, "/securite")}>{t("hero.how")}</a>
        </div>
        <div class="demo">
          <Schema />
        </div>
      </div>
    {/if}
  </header>

  <div class="compose" data-slot="compose">
    {#if children}{@render children()}{/if}
  </div>
</div>

<style>
  .home {
    display: grid;
    gap: var(--sp-6);
  }

  .hero {
    display: grid;
    gap: var(--sp-5);
    padding-block-start: var(--sp-3);
  }
  .hero.compact {
    gap: 0;
    padding-block-start: 0;
  }

  h1 {
    font-size: var(--fs-display);
    line-height: var(--lh-display);
    font-weight: var(--fw-display);
    font-stretch: var(--wd-display);
    letter-spacing: -0.03em;
    max-width: 16ch;
  }
  h1.compact {
    font-size: var(--fs-h1);
    line-height: var(--lh-h1);
    font-weight: var(--fw-h1);
    font-stretch: var(--wd-h1);
    letter-spacing: -0.01em;
    max-width: none;
  }
  h1:focus {
    outline: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    h1 {
      transition:
        font-size var(--dur-base) var(--ease-out),
        letter-spacing var(--dur-base) var(--ease-out);
    }
  }

  .body {
    display: grid;
    gap: var(--sp-6);
  }
  .say {
    display: grid;
    gap: var(--sp-2);
    justify-items: start;
  }
  .lede {
    margin: 0;
    max-width: 46ch;
    color: var(--text-2);
  }
  .how {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--text);
    text-decoration-line: underline;
    text-decoration-thickness: 1px;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 0.3em;
    transition: text-decoration-color var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .how:hover {
      text-decoration-color: var(--accent);
    }
  }

  .demo {
    /* Le schéma garde de l'air à droite comme à gauche : ses libellés touchent les bords du trait. */
    padding-block: var(--sp-2);
    min-width: 0;
  }

  /* Emplacement du composeur : la rangée d'ajout (48 px) tient dans le premier écran du téléphone. */
  .compose {
    min-height: 48px;
  }

  @media (min-width: 960px) {
    .home {
      gap: var(--sp-7);
    }
    .hero {
      gap: var(--sp-6);
      padding-block-start: var(--sp-7);
    }
    .body {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      align-items: start;
      gap: var(--sp-7);
    }
    .demo {
      padding-block-start: var(--sp-1);
    }
  }

  @media (forced-colors: active) {
    .how {
      text-decoration-color: currentColor;
    }
  }
</style>
