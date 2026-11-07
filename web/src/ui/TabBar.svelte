<script lang="ts">
  // Barre d'onglets du téléphone (< 900 px), façon app : Envoyer, Mes partages (bientôt),
  // Salon (bientôt), Réglages (feuille : langue, Sécurité, Confidentialité, À propos).
  // Visibilité décidée par app/tabbar.ts ; masquée sur ordinateur par la CSS seule.
  import { currentTab, TABS, type TabId } from "../app/tabbar";
  import { followLink, href, router } from "../app/router.svelte";
  import { getLang, setLang, t, type Key } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import { ArrowRight, MessagesSquare, Send, SlidersHorizontal, Clock } from "./Icon";
  import Sheet from "./Sheet.svelte";

  const CODE_URL = "https://github.com/Skoow/Shhdrop";
  const ICONS = { send: Send, shares: Clock, chat: MessagesSquare, settings: SlidersHorizontal } as const;

  let settings = $state(false);
  const current = $derived(settings ? "settings" : currentTab(router.current.name));

  function soon(id: TabId) {
    announce(t(`tabs.soon.${id}` as Key));
  }
  function go(e: MouseEvent, path: string) {
    settings = false;
    followLink(e, path);
  }
</script>

<nav class="tabbar" aria-label={t("tabs.nav")} data-tabbar>
  <ul>
    {#each TABS as tab (tab.id)}
      {@const Icon = ICONS[tab.id]}
      <li>
        {#if tab.id === "send"}
          <a class="tab" href={href("/")} aria-current={current === "send" ? "page" : undefined} onclick={(e) => go(e, "/")}>
            <Icon size={22} strokeWidth={1.8} aria-hidden="true" /><span class="lb">{t("tabs.send")}</span>
          </a>
        {:else if tab.soon}
          <button type="button" class="tab soon" aria-disabled="true" aria-describedby="tab-soon-{tab.id}" onclick={() => soon(tab.id)}>
            <Icon size={22} strokeWidth={1.8} aria-hidden="true" /><span class="lb">{t(`tabs.${tab.id}` as Key)}</span>
            <span class="badge" id="tab-soon-{tab.id}">{t("tabs.soon")}</span>
          </button>
        {:else}
          <button type="button" class="tab" aria-haspopup="dialog" aria-expanded={settings} aria-current={current === "settings" ? "page" : undefined} onclick={() => (settings = true)}>
            <Icon size={22} strokeWidth={1.8} aria-hidden="true" /><span class="lb">{t("tabs.settings")}</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</nav>

<Sheet bind:open={settings} title={t("settings.title")}>
  <div class="set">
    <section aria-labelledby="set-lang">
      <h3 id="set-lang">{t("settings.lang")}</h3>
      <div class="langs">
        <button type="button" class="row" lang="fr" aria-pressed={getLang() === "fr"} onclick={() => setLang("fr")}>Français</button>
        <button type="button" class="row" lang="en" aria-pressed={getLang() === "en"} onclick={() => setLang("en")}>English</button>
      </div>
    </section>
    <section aria-labelledby="set-info">
      <h3 id="set-info">{t("settings.info")}</h3>
      <a class="row link" href={href("/securite")} onclick={(e) => go(e, "/securite")}>{t("shell.security")}<ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></a>
      <a class="row link" href={href("/confidentialite")} onclick={(e) => go(e, "/confidentialite")}>{t("shell.privacy")}<ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></a>
    </section>
    <section aria-labelledby="set-about">
      <h3 id="set-about">{t("settings.about")}</h3>
      <p class="about">{t("settings.about.body")}</p>
      <a class="row link" href={CODE_URL} rel="noopener noreferrer" target="_blank">{t("settings.code")}<ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></a>
    </section>
  </div>
</Sheet>

<style>
  .tabbar {
    display: none;
  }
  @media (max-width: 899px) {
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
  .badge {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: calc(50% + 6px);
    padding: 0 5px;
    border-radius: var(--r-pill);
    background: var(--surface-3);
    color: var(--text-2);
    font-size: 0.625rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .set {
    display: grid;
    gap: var(--sp-5);
  }
  section {
    display: grid;
    gap: var(--sp-2);
  }
  h3 {
    font-size: var(--fs-small);
    color: var(--text-2);
    font-weight: 600;
  }
  .langs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    min-height: 52px;
    padding: 0 var(--sp-4);
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.05);
    box-shadow: inset 0 0 0 1px var(--hair-2);
    color: var(--text);
    font: inherit;
    font-weight: 560;
    text-decoration: none;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .langs .row {
    justify-content: center;
  }
  .row:active {
    background: rgb(255 255 255 / 0.1);
  }
  .row[aria-pressed="true"] {
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .about {
    margin: 0;
    color: var(--text-2);
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
