<script lang="ts">
  // Accueil v3, questions fréquentes (UI §9.1) : accordéon natif (<details name> : une seule
  // réponse ouverte), réponses tirées de la spécification (§2, §9, §18). La réponse entre en
  // fondu et montée de 6 px ; aucune hauteur animée (§20.6 point 1).
  import { t, type Key } from "../../i18n/i18n.svelte";
  import { magnet, reveal } from "../../ui/attach";
  import { ChevronDown } from "../../ui/Icon";

  const qs = ["server", "lost", "back", "scan", "copy"] as const;
</script>

<section class="faq" aria-labelledby="faq-title">
  <h2 id="faq-title" class="rv" {@attach reveal}>{t("home.faq.title")}</h2>
  <div class="qa">
    {#each qs as k (k)}
      <!-- « Ce que voit le serveur » (menu Sécurité de la barre du haut) ouvre la première question. -->
      <details name="faq" id="faq-{k}" class="rv" {@attach reveal} {@attach magnet}>
        <summary><span>{t(`home.faq.${k}.q` as Key)}</span><ChevronDown size={22} strokeWidth={1.75} aria-hidden="true" /></summary>
        <div class="a"><p>{t(`home.faq.${k}.a` as Key)}</p></div>
      </details>
    {/each}
  </div>
</section>

<style>
  .faq {
    position: relative;
    isolation: isolate;
    padding-block-end: 120px;
    grid-template-columns: minmax(0, 1fr);
    display: grid;
    gap: var(--sp-6);
    width: 100%;
    max-width: 52rem;
    margin-inline: auto;
    padding-block-start: 120px;
  }
  details {
    scroll-margin-top: 96px;
  }
  h2 {
    text-align: center;
    text-wrap: balance;
    min-width: 0;
    overflow-wrap: break-word;
    font-size: clamp(2rem, 1.4rem + 2vw, 3rem);
    line-height: 1.05;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: -0.035em;
  }
  .qa {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-2);
  }
  /* Question : relief léger, reflet sous le pointeur, barre menthe qui se lève à l'ouverture. */
  details {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgb(15 22 42 / 0.92), rgb(10 15 30 / 0.92)) padding-box,
      linear-gradient(180deg, rgb(150 175 255 / 0.18), rgb(150 175 255 / 0.04)) border-box;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04);
  }
  details::before {
    content: "";
    position: absolute;
    z-index: -1;
    left: 0;
    top: 0;
    width: 320px;
    height: 320px;
    margin: -160px 0 0 -160px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.08), transparent);
    opacity: 0;
    transform: translate(var(--lx, 50%), var(--ly, 50%));
    transition: opacity var(--dur-base) var(--ease-out);
  }
  details::after {
    content: "";
    position: absolute;
    left: 0;
    top: 14px;
    bottom: 14px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
    transform: scaleY(0);
    transition: transform 420ms var(--ease-settle);
  }
  details[open]::after {
    transform: scaleY(1);
  }
  @media (hover: hover) {
    details:hover::before {
      opacity: 1;
    }
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
      animation: answer 480ms var(--ease-settle) both;
    }
    details[open] summary > span {
      animation: nudge 480ms var(--ease-settle) both;
    }
  }
  @keyframes answer {
    from {
      opacity: 0;
      transform: translateY(-10px);
      filter: blur(3px);
    }
  }
  @keyframes nudge {
    from {
      transform: translateX(-4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    details::after,
    summary :global(svg) {
      transition: none;
    }
  }
  @media (min-width: 1024px) {
    .faq {
      padding-block: 140px 140px;
    }
  }
  @media (forced-colors: active) {
    details {
      border: 1px solid CanvasText;
      box-shadow: none;
      background: Canvas;
    }
    details::before {
      display: none;
    }
    details::after {
      background: Highlight;
    }
  }
</style>
