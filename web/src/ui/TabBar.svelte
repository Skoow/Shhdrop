<script lang="ts">
  // Barre d'onglets du téléphone (< 768 px), façon app : Envoyer, Mes partages, Salon (bientôt). Plus d'onglet Réglages : langue, nettoyage et liens sont dans le pied de page.
  // Visibilité décidée par app/tabbar.ts ; masquée sur ordinateur par la CSS seule.
  import { currentTab, TABS, type TabId } from "../app/tabbar";
  import { followLink, href, router } from "../app/router.svelte";
  import { t, type Key } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import TabIcon from "./TabIcon.svelte";

  const current = $derived(currentTab(router.current.name));

  function soon(id: TabId) {
    announce(t(`tabs.soon.${id}` as Key));
  }
</script>

<nav class="tabbar" aria-label={t("tabs.nav")} data-tabbar>
  <ul>
    {#each TABS as tab (tab.id)}
      <li>
        {#if !tab.soon}
          {@const to = tab.id === "send" ? "/" : "/envois"}
          <a class="tab" href={href(to)} aria-current={current === tab.id ? "page" : undefined} onclick={(e) => followLink(e, to)}>
            <TabIcon id={tab.id} /><span class="lb">{t(`tabs.${tab.id}` as Key)}</span>
          </a>
        {:else}
          <button type="button" class="tab soon" aria-disabled="true" aria-describedby="tab-soon-{tab.id}" onclick={() => soon(tab.id)}>
            <TabIcon id={tab.id} /><span class="lb">{t(`tabs.${tab.id}` as Key)}</span>
            <span class="dot" aria-hidden="true"></span><span class="badge" id="tab-soon-{tab.id}">{t("tabs.soon")}</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</nav>

<style>
  .tabbar {
    display: none;
  }
  @media (max-width: 767px) {
    .tabbar {
      display: block;
      position: fixed;
      inset-inline: 0;
      inset-block-end: 0;
      z-index: 20;
      padding: 6px max(var(--sp-2), env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom, 0px)) max(var(--sp-2), env(safe-area-inset-left));
      background: rgb(11 13 18 / 0.97);
      -webkit-backdrop-filter: blur(20px) saturate(1.2);
      backdrop-filter: blur(20px) saturate(1.2);
      box-shadow: 0 -1px 0 var(--hair);
    }
  }
  :global(html.kbd-open) .tabbar {
    display: none;
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .tabbar {
      background: var(--surface-1);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }
  ul {
    list-style: none;
    margin: 0 auto;
    padding: 0;
    max-width: 560px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .tab {
    position: relative;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 3px;
    width: 100%;
    min-height: 52px;
    padding: 4px 2px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 560;
    line-height: 1.15;
    text-decoration: none;
    text-align: center;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .tab:active {
    transform: scale(0.94);
    background: rgb(255 255 255 / 0.06);
  }
  .tab[aria-current="page"] {
    color: var(--accent);
  }
  .tab.soon {
    color: var(--text-disabled);
    cursor: default;
  }
  .lb {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* « Bientôt » : un point discret près de l'icône (le texte reste pour les lecteurs d'écran,
     relié par aria-describedby) ; il ne chevauche plus l'icône. */
  .badge {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .dot {
    position: absolute;
    inset-block-start: 7px;
    inset-inline-start: calc(50% + 10px);
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--info);
    box-shadow: 0 0 0 2px var(--bg);
  }

  @media (prefers-reduced-motion: reduce) {
    .tab {
      transition: none;
    }
    .tab:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .tabbar {
      background: Canvas;
      border-top: 1px solid CanvasText;
    }
  }
</style>
