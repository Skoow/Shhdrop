<script lang="ts">
  // Accueil v3, questions fréquentes (UI §9.1) : accordéon natif (<details name> : une seule
  // réponse ouverte), réponses tirées de la spécification (§2, §9, §18). La réponse entre en
  // fondu et montée de 6 px ; aucune hauteur animée (§20.6 point 1).
  import { t, type Key } from "../../i18n/i18n.svelte";
  import { reveal } from "../../ui/attach";
  import { ChevronDown } from "../../ui/Icon";

  const qs = ["server", "lost", "back", "scan", "copy", "app"] as const;
</script>

<section class="faq" aria-labelledby="faq-title">
  <h2 id="faq-title" class="rv" {@attach reveal}>{t("home.faq.title")}</h2>
  <div class="qa">
    {#each qs as k (k)}
      <details name="faq" class="rv" {@attach reveal}>
        <summary><span>{t(`home.faq.${k}.q` as Key)}</span><ChevronDown size={22} strokeWidth={1.75} aria-hidden="true" /></summary>
        <div class="a"><p>{t(`home.faq.${k}.a` as Key)}</p></div>
      </details>
    {/each}
  </div>
</section>

<style>
  .faq {
    grid-template-columns: minmax(0, 1fr);
    display: grid;
    gap: var(--sp-6);
    width: 100%;
    max-width: 52rem;
    margin-inline: auto;
    padding-block-start: 120px;
  }
  h2 {
    min-width: 0;
    overflow-wrap: break-word;
    font-size: var(--fs-section);
    line-height: 1.04;
    font-weight: 620;
    font-stretch: 110%;
    letter-spacing: -0.03em;
  }
  .qa {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-2);
  }
  details {
    border-radius: 18px;
    background: rgb(255 255 255 / 0.03);
    box-shadow: inset 0 0 0 1px var(--hair);
    transition: background-color var(--dur-base) var(--ease-out);
  }
  details[open] {
    background: rgb(255 255 255 / 0.055);
  }
  summary {
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    min-height: 64px;
    padding: var(--sp-4) 22px;
    border-radius: 18px;
    cursor: pointer;
    font-size: 1.125rem;
    font-weight: 580;
    -webkit-tap-highlight-color: transparent;
  }
  summary > span {
    min-width: 0;
    overflow-wrap: break-word;
  }
  .a {
    overflow-wrap: break-word;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary :global(svg) {
    flex: none;
    color: var(--text-2);
    transition:
      transform 520ms var(--ease-settle),
      color var(--dur-fast) var(--ease-out);
  }
  details[open] summary :global(svg) {
    transform: rotate(180deg);
    color: var(--accent);
  }
  @media (hover: hover) {
    details:not([open]):hover {
      background: rgb(255 255 255 / 0.05);
    }
    summary:hover :global(svg) {
      color: var(--accent);
    }
  }
  .a {
    padding: 0 22px 20px;
  }
  .a p {
    margin: 0;
    color: var(--text-2);
    max-width: 62ch;
  }
  @media (prefers-reduced-motion: no-preference) {
    details[open] .a {
      animation: answer 420ms var(--ease-settle) both;
    }
  }
  @keyframes answer {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    details,
    summary :global(svg) {
      transition: none;
    }
  }
  @media (min-width: 1024px) {
    .faq {
      padding-block-start: 200px;
    }
  }
  @media (forced-colors: active) {
    details {
      border: 1px solid CanvasText;
      box-shadow: none;
    }
  }
</style>
