<script lang="ts">
  // Page d'information (Sécurité, Confidentialité, Conditions, Mentions légales, Signaler un
  // abus ; retours UI5) : lecture d'abord, colonne de texte étroite, titres ancrés par id (sans
  // « # » dans l'adresse : le « # » est réservé aux clés). Bandeau « En cours de rédaction »
  // pour les pages juridiques que le propriétaire doit compléter.
  import { getLang, t } from "../i18n/i18n.svelte";
  import { infoPage, type InfoName } from "./pages/content";

  let { name }: { name: InfoName } = $props();
  const page = $derived(infoPage(name, getLang()));
</script>

<article class="info" data-info={name} aria-labelledby="info-title">
  <header class="hd">
    <h1 id="info-title" class="title" tabindex="-1" data-large-title>{page.title}</h1>
    <p class="lede">{page.lede}</p>
    {#if page.draft}<p class="draft" role="note" data-draft>{t("info.draft")}</p>{/if}
  </header>
  {#each page.blocks as b, i (i)}
    <section class="blk" id={b.id} aria-labelledby="info-h-{i}">
      <h2 id="info-h-{i}">{b.h}</h2>
      {#each b.p ?? [] as para, j (j)}<p>{para}</p>{/each}
      {#if b.list}
        <ul>{#each b.list as li, j (j)}<li>{li}</li>{/each}</ul>
      {/if}
    </section>
  {/each}
</article>

<style>
  .info {
    display: grid;
    gap: var(--sp-6);
    max-width: 68ch;
    padding-block: var(--sp-5) var(--sp-7);
  }
  .hd {
    display: grid;
    gap: var(--sp-3);
  }
  .title {
    margin: 0;
    font-size: var(--fs-screen);
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .title:focus {
    outline: none;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    font-size: 1.125rem;
  }
  .draft {
    justify-self: start;
    margin: 0;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-md);
    background: var(--warn-tint);
    color: var(--warn);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .blk {
    display: grid;
    gap: var(--sp-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-h3);
    line-height: 1.25;
  }
  p,
  li {
    margin: 0;
    color: var(--text-2);
    line-height: 1.6;
  }
  ul {
    display: grid;
    gap: var(--sp-2);
    margin: 0;
    padding-inline-start: 1.2em;
  }
  li::marker {
    color: var(--text-3);
  }
</style>
