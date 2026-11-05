<script lang="ts">
  import type { Snippet } from "svelte";
  import { followLink, href, router } from "../app/router.svelte";
  import { getLang, setLang, t } from "../i18n/i18n.svelte";
  import { Languages } from "./Icon";
  import LiveRegion from "./LiveRegion.svelte";

  type Props = {
    children: Snippet;
    /** Emplacement du bandeau de démo (vide hors démo). */
    banner?: Snippet;
    /** Vrai pendant un envoi : la bascule de langue est inerte (UI §10). */
    langLocked?: boolean;
  };
  let { children, banner, langLocked = false }: Props = $props();

  let main: HTMLElement | undefined = $state();
  let sentinel: HTMLElement | undefined = $state();
  let scrolled = $state(false);

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

<a class="skip" href="#contenu" onclick={skip}>{t("shell.skip")}</a>

{#if banner}
  <div class="banner-slot">{@render banner()}</div>
{/if}

<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>

<header class="top" class:scrolled>
  <div class="bar wrap">
    <a class="logo" href={href("/")} onclick={(e) => followLink(e, "/")} aria-label={t("shell.home")}>
      <svg class="mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <!-- Même dessin que public/logo.svg (UI §6) : capsule, trait ouvert de 300° depuis le milieu du haut. -->
        <path d="M12 6H16A6 6 0 0 1 16 18H8A6 6 0 0 1 8 6H12" pathLength="100" stroke-dasharray="83.33 100" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      </svg>
      <span class="word">shhdrop</span>
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
    <p class="note">{t("shell.footer")}</p>
    <nav aria-label={t("shell.nav")}>
      <a href={href("/securite")} aria-current={here("securite")} onclick={(e) => followLink(e, "/securite")}>{t("shell.security")}</a>
      <a href={href("/confidentialite")} aria-current={here("confidentialite")} onclick={(e) => followLink(e, "/confidentialite")}>{t("shell.privacy")}</a>
    </nav>
  </div>
</footer>

<LiveRegion />

<style>
  .wrap {
    width: 100%;
    max-width: 1120px;
    margin-inline: auto;
    padding-inline: max(var(--sp-4), env(safe-area-inset-left)) max(var(--sp-4), env(safe-area-inset-right));
  }
  @media (min-width: 600px) {
    .wrap {
      padding-inline: max(var(--sp-5), env(safe-area-inset-left)) max(var(--sp-5), env(safe-area-inset-right));
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

  .sentinel {
    position: absolute;
    inset-block-start: 0;
    height: 1px;
    width: 1px;
  }

  .top {
    position: sticky;
    inset-block-start: 0;
    z-index: 10;
    border-block-end: 1px solid transparent;
  }
  .top.scrolled {
    background: var(--glass);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    border-block-end-color: var(--line);
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
      border-block-end-color: var(--line-strong);
    }
  }
  @media (max-height: 500px) and (orientation: landscape) {
    .top {
      position: static;
    }
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 64px;
    gap: var(--sp-3);
  }

  .logo {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    color: var(--text);
    text-decoration: none;
  }
  .mark {
    color: var(--accent);
  }
  .word {
    font-weight: 650;
    font-stretch: 112%;
    font-size: 1.25rem;
    letter-spacing: 0.01em;
  }

  .lang {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    min-width: 44px;
    padding-inline: var(--sp-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
  }
  .lang[aria-disabled="true"] {
    color: var(--text-disabled);
    border-color: var(--line);
    cursor: not-allowed;
  }
  @media (hover: hover) {
    .lang:not([aria-disabled="true"]):hover {
      background: var(--surface-2);
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
    border-block-start: 1px solid var(--line);
    margin-block-start: var(--sp-7);
    padding-block: var(--sp-5) calc(var(--sp-5) + env(safe-area-inset-bottom));
  }
  .foot-in {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3) var(--sp-5);
  }
  .note {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
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

  @media (forced-colors: active) {
    .top.scrolled {
      background: Canvas;
    }
  }
</style>
