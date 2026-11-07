<script lang="ts">
  import type { Snippet } from "svelte";
  import { followLink, href, router } from "../app/router.svelte";
  import { getLang, setLang, t } from "../i18n/i18n.svelte";
  import Aurora from "./Aurora.svelte";
  import { Languages } from "./Icon";
  import LiveRegion from "./LiveRegion.svelte";
  import Logo from "./Logo.svelte";
  import TabBar from "./TabBar.svelte";

  type Props = {
    children: Snippet;
    /** Emplacement du bandeau de démo (vide hors démo). */
    banner?: Snippet;
    /** Vrai pendant un envoi : la bascule de langue est inerte (UI §10). */
    langLocked?: boolean;
    /** Barre d'onglets du téléphone (app/tabbar.ts) ; rendue sous 900 px seulement (CSS). */
    tabs?: boolean;
  };
  let { children, banner, langLocked = false, tabs = false }: Props = $props();

  // Téléphone : la page réserve la hauteur de la barre d'onglets (base.css, html.has-tabbar).
  $effect(() => {
    document.documentElement.classList.toggle("has-tabbar", tabs);
    return () => document.documentElement.classList.remove("has-tabbar");
  });

  let main: HTMLElement | undefined = $state();
  let sentinel: HTMLElement | undefined = $state();
  let scrolled = $state(false);
  // Hauteur du bandeau collant (varie avec la largeur et la taille du texte) : l'en-tête se colle dessous.
  let bannerH = $state(0);

  // Verre de l'en-tête seulement une fois la page défilée (UI §5.4).
  $effect(() => {
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => (scrolled = !entry!.isIntersecting));
    io.observe(sentinel);
    return () => io.disconnect();
  });

  // Après un changement d'écran, le focus va au contenu, sauf si l'écran l'a déjà pris (son titre).
  let first = true;
  $effect(() => {
    void router.current;
    if (first) {
      first = false;
      return;
    }
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  });

  // Lien d'évitement : pas de « #contenu » dans l'adresse (le « # » est réservé aux clés).
  function skip(e: MouseEvent) {
    e.preventDefault();
    main?.focus();
  }

  const other = $derived(getLang() === "fr" ? "en" : "fr");
  function toggleLang() {
    if (!langLocked) setLang(other);
  }

  const here = (name: string) => (router.current.name === name ? "page" : undefined);
</script>

<Aurora />

<a class="skip" href="#contenu" onclick={skip}>{t("shell.skip")}</a>

{#if banner}
  <div class="banner-slot" bind:clientHeight={bannerH}>{@render banner()}</div>
{/if}

<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>

<header class="top" class:scrolled style:--banner-h={banner ? `${bannerH}px` : undefined}>
  <div class="bar wrap">
    <a class="logo" href={href("/")} onclick={(e) => followLink(e, "/")} aria-label={t("shell.home")}>
      <!-- Logo « Trame » (scripts/gen-logo.mjs) ; l'introduction ne se joue que sur l'accueil, une fois par chargement. -->
      <Logo />
    </a>
    <button
      type="button"
      class="lang"
      aria-label={t("shell.lang.switch")}
      aria-disabled={langLocked}
      aria-describedby={langLocked ? "lang-locked" : undefined}
      onclick={toggleLang}
    >
      <Languages size={20} strokeWidth={1.75} aria-hidden="true" />
      <span lang={other}>{t("shell.lang.label")}</span>
    </button>
    {#if langLocked}<span id="lang-locked" class="sr">{t("shell.lang.locked")}</span>{/if}
  </div>
</header>

<main id="contenu" tabindex="-1" bind:this={main} class="wrap">
  {@render children()}
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <nav aria-label={t("shell.nav")}>
      <a href={href("/securite")} aria-current={here("securite")} onclick={(e) => followLink(e, "/securite")}>{t("shell.security")}</a>
      <a href={href("/confidentialite")} aria-current={here("confidentialite")} onclick={(e) => followLink(e, "/confidentialite")}>{t("shell.privacy")}</a>
    </nav>
  </div>
</footer>

{#if tabs}<TabBar />{/if}

<LiveRegion />

<style>
  .wrap {
    width: 100%;
    /* Grands écrans : la largeur disponible sert (accueil et composeur), jusqu'à 1 520 px. */
    max-width: 1520px;
    margin-inline: auto;
    padding-inline: max(var(--sp-4), env(safe-area-inset-left)) max(var(--sp-4), env(safe-area-inset-right));
  }
  @media (min-width: 600px) {
    .wrap {
      padding-inline: max(var(--sp-5), env(safe-area-inset-left)) max(var(--sp-5), env(safe-area-inset-right));
    }
  }
  @media (min-width: 1024px) {
    .wrap {
      padding-inline: max(40px, env(safe-area-inset-left)) max(40px, env(safe-area-inset-right));
    }
  }

  .skip {
    position: absolute;
    inset-block-start: var(--sp-2);
    inset-inline-start: var(--sp-2);
    z-index: 100;
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    background: var(--surface-3);
    color: var(--text);
    transform: translateY(-200%);
  }
  .skip:focus-visible {
    transform: none;
  }

  /* Bandeau de démo collé en haut ; l'en-tête (.top) se colle juste dessous. */
  .banner-slot {
    position: sticky;
    inset-block-start: 0;
    z-index: 11;
    /* App installée (barre d'état translucide sur iOS) : rien sous l'encoche. */
    padding-top: env(safe-area-inset-top, 0px);
    background: var(--bg);
  }
  @media (max-height: 500px) and (orientation: landscape) {
    .banner-slot {
      position: static;
    }
  }

  .sentinel {
    position: absolute;
    inset-block-start: 0;
    height: 1px;
    width: 1px;
  }

  .top {
    position: sticky;
    inset-block-start: var(--banner-h, 0px);
    z-index: 10;
    padding-top: env(safe-area-inset-top, 0px);
    transition:
      background-color var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .banner-slot ~ .top {
    padding-top: 0;
  }
  /* Verre mobile (§5.4) : le contenu défile dessous, le flou est donc justifié (K6). */
  .top.scrolled {
    background: var(--glass);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    backdrop-filter: blur(20px) saturate(1.2);
    box-shadow: 0 1px 0 var(--hair);
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .top.scrolled {
      background: var(--surface-1);
    }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .top.scrolled {
      background: var(--surface-1);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: 0 1px 0 var(--line-strong);
    }
  }
  @media (max-height: 500px) and (orientation: landscape) {
    .top {
      position: static;
    }
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    min-height: 64px;
    gap: var(--sp-3);
  }

  .logo {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--text);
    text-decoration: none;
    border-radius: var(--r-sm);
  }
  .lang {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    min-width: 44px;
    padding-inline: 14px;
    border: 1px solid var(--hair-2);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 560;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .lang:active:not([aria-disabled="true"]) {
    transform: scale(0.97);
  }
  .lang[aria-disabled="true"] {
    color: var(--text-disabled);
    border-color: var(--line);
    cursor: not-allowed;
  }
  @media (hover: hover) {
    .lang:not([aria-disabled="true"]):hover {
      background: rgb(255 255 255 / 0.05);
    }
  }

  main {
    min-height: 60dvh;
    padding-block: var(--sp-5);
  }
  main:focus {
    outline: none;
  }

  .foot {
    border-block-start: 1px solid var(--hair);
    margin-block-start: var(--sp-8);
    padding-block: var(--sp-5) calc(var(--sp-5) + env(safe-area-inset-bottom));
  }
  /* Téléphone avec onglets : Sécurité et Confidentialité sont dans « Réglages ». */
  @media (max-width: 899px) {
    :global(html.has-tabbar) .foot {
      display: none;
    }
  }
  .foot-in {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3) var(--sp-5);
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-5);
  }
  nav a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--text-2);
    text-underline-offset: 0.2em;
  }
  nav a[aria-current="page"] {
    color: var(--text);
  }
  @media (hover: hover) {
    nav a:hover {
      color: var(--text);
    }
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .lang {
      transition: none;
    }
    .lang:active:not([aria-disabled="true"]) {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .top.scrolled {
      background: Canvas;
    }
    .lang {
      border-color: ButtonText;
    }
  }
</style>
