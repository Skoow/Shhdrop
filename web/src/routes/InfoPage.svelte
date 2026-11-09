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
  {#if page.tech}
    <!-- Détails techniques (retours UI6) : repliés, en bas ; le corps reste sans jargon. -->
    <details class="tech" id="details-techniques" data-tech>
      <summary>{page.tech.h}</summary>
      <div class="tech-in">
        {#each page.tech.p ?? [] as para, j (j)}<p>{para}</p>{/each}
        {#if page.tech.list}<ul>{#each page.tech.list as li, j (j)}<li>{li}</li>{/each}</ul>{/if}
        <ul class="links">
          {#each page.tech.links as l (l.url)}<li><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<span class="sr-only"> {t("foot.external")}</span></a></li>{/each}
        </ul>
      </div>
    </details>
  {/if}
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
  .tech {
    border: 1px solid var(--hair-2);
    border-radius: var(--r-lg);
    background: var(--surface-1);
  }
  .tech summary {
    display: flex;
    align-items: center;
    min-block-size: 44px;
    padding: var(--sp-2) var(--sp-4);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--r-lg);
  }
  .tech summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .tech-in {
    display: grid;
    gap: var(--sp-3);
    padding: 0 var(--sp-4) var(--sp-4);
  }
  .tech li {
    font-size: var(--fs-small);
  }
  .links {
    list-style: none;
    padding: 0;
  }
  .links a {
    display: inline-flex;
    align-items: center;
    min-block-size: 44px;
    color: var(--accent);
    font-size: var(--fs-small);
    font-weight: 560;
  }
</style>
