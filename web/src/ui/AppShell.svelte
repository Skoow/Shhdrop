<script lang="ts">
  import type { Snippet } from "svelte";
  import { BUILD_ID } from "../app/build";
  import { followLink, href, navigate, router } from "../app/router.svelte";
  import { LICENSE_URL, SOURCE_URL } from "../routes/pages/content";
  import { t } from "../i18n/i18n.svelte";
  import Aurora from "./Aurora.svelte";
  import GearIcon from "./GearIcon.svelte";
  import { ChevronLeft } from "./Icon";
  import LiveRegion from "./LiveRegion.svelte";
  import Logo from "./Logo.svelte";
  import SettingsSheet from "./SettingsSheet.svelte";
  import TabBar from "./TabBar.svelte";

  type Props = {
    children: Snippet;
    /** Emplacement du bandeau de démo (vide hors démo). */
    banner?: Snippet;
    /** Vrai pendant un envoi : la langue ne change pas (UI §10, panneau Réglages). */
    langLocked?: boolean;
    /** Barre d'onglets du téléphone (app/tabbar.ts) ; rendue sous 900 px seulement (CSS). */
    tabs?: boolean;
    /** Pied de page (faux pendant la composition et l'envoi : l'écran de travail tient sans défilement). */
    foot?: boolean;
  };
  let { children, banner, langLocked = false, tabs = false, foot = true }: Props = $props();

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

  // Réglages (langue, Sécurité, Confidentialité, À propos) : entrée discrète de l'en-tête sur
  // ordinateur et sur les écrans du téléphone sans barre d'onglets ; sinon l'onglet Réglages.
  let settingsOpen = $state(false);
  // Téléphone : l'onglet Réglages suffit ; l'en-tête ne garde l'entrée que chez le destinataire
  // et sur la gestion (pas d'onglets, sinon plus aucun moyen de changer de langue).
  const gearOnPhone = $derived(router.current.name === "open" || router.current.name === "manage");

  const here = (name: string) => (router.current.name === name ? "page" : undefined);

  // Téléphone (< 900 px), en-tête d'écran natif : retour en haut à gauche sur les pages
  // secondaires de l'expéditeur, et le grand titre de l'écran qui se réduit dans la barre une
  // fois défilé (titre marqué data-large-title, sinon le h1 de l'écran). Sur ordinateur, rien ne change.
  const INFO: ReadonlySet<string> = new Set(["securite", "confidentialite", "conditions", "mentions", "signaler", "offres"]);
  const BACK: ReadonlySet<string> = new Set([...INFO, "notfound", "manage"]);
  // Pied de page (retours UI5) : partout sur ordinateur ; sur téléphone, en bas de l'accueil et
  // des pages d'information seulement (ailleurs, ces liens sont dans Réglages).
  const footOnPhone = $derived(router.current.name === "home" || router.current.name === "notfound" || INFO.has(router.current.name));
  type FootLink = { label: string; path?: string; url?: string; soon?: boolean };
  const footCols = $derived<{ id: string; title: string; links: FootLink[] }[]>([
    {
      id: "product",
      title: t("foot.product"),
      links: [
        { label: t("foot.send"), path: "/" },
        { label: t("foot.room"), soon: true },
        { label: t("foot.offers"), path: "/offres" },
      ],
    },
    {
      id: "trust",
      title: t("foot.trust"),
      links: [
        { label: t("shell.security"), path: "/securite" },
        { label: t("shell.privacy"), path: "/confidentialite" },
        { label: t("foot.source"), url: SOURCE_URL },
        { label: t("foot.report"), path: "/signaler" },
      ],
    },
    {
      id: "legal",
      title: t("foot.legal"),
      links: [
        { label: t("foot.terms"), path: "/conditions" },
        { label: t("foot.notice"), path: "/mentions-legales" },
        { label: t("foot.license"), url: LICENSE_URL },
      ],
    },
  ]);
  const pathHere = (p: string) => (router.current.name !== "notfound" && location.pathname === href(p) ? "page" : undefined);
  const back = $derived(BACK.has(router.current.name));
  let small = $state("");
  let raf = 0;
  function measure() {
    raf = 0;
    // Le premier titre affiché (un écran caché, comme le composeur pendant l'envoi, ne compte pas).
    const shown = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0);
    const marked = shown("main [data-large-title]");
    if (router.current.name === "home" && !marked) return void (small = "");
    const el = marked ?? shown("main h1");
    const bar = document.querySelector<HTMLElement>("header.top");
    const hidden = !!el && !!bar && el.getBoundingClientRect().bottom < bar.getBoundingClientRect().bottom;
    small = hidden ? (el!.textContent ?? "").trim() : "";
  }
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  $effect(() => {
    void router.current;
    queue();
    return () => cancelAnimationFrame(raf);
  });
  function goBack() {
    navigate("/", { back: true });
  }
</script>

<Aurora />

<a class="skip" href="#contenu" onclick={skip}>{t("shell.skip")}</a>

{#if banner}
  <div class="banner-slot" bind:clientHeight={bannerH}>{@render banner()}</div>
{/if}

<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>

<svelte:window onscroll={queue} onresize={queue} />

<header class={["top", { scrolled, tabs, "has-back": back }]} style:--banner-h={banner ? `${bannerH}px` : undefined}>
  <div class="bar wrap">
    {#if back}
      <button type="button" class="back" onclick={goBack}><ChevronLeft size={24} strokeWidth={2} aria-hidden="true" /><span class="back-t">{t("shell.back")}</span></button>
    {/if}
    <p class={["small", { on: small !== "" }]} aria-hidden="true">{small}</p>
    <a class="logo" href={href("/")} onclick={(e) => followLink(e, "/")} aria-label={t("shell.home")}>
      <!-- Logo « Trame » (scripts/gen-logo.mjs) ; l'introduction ne se joue que sur l'accueil, une fois par chargement. -->
      <Logo />
    </a>
    <button type="button" class={["gear", { phone: gearOnPhone }]} aria-label={t("settings.title")} title={t("settings.title")} aria-haspopup="dialog" aria-expanded={settingsOpen} onclick={() => (settingsOpen = true)}>
      <GearIcon size={26} />
    </button>
  </div>
</header>

<main id="contenu" tabindex="-1" bind:this={main} class="wrap">
  {@render children()}
</main>

{#if foot}
<footer class={["foot", { phone: footOnPhone }]} data-foot>
  <div class="wrap foot-in">
    <nav class="cols" aria-label={t("shell.nav")}>
      {#each footCols as col (col.id)}
        <div class="col">
          <p class="ch" id="foot-{col.id}">{col.title}</p>
          <ul aria-labelledby="foot-{col.id}">
            {#each col.links as l (l.label)}
              <li>
                {#if l.soon}
                  <span class="off">{l.label} <span class="soon">{t("foot.soon")}</span></span>
                {:else if l.url}
                  <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<span class="sr-only"> {t("foot.external")}</span></a>
                {:else if l.path}
                  <a href={href(l.path)} aria-current={pathHere(l.path)} onclick={(e) => followLink(e, l.path!)}>{l.label}</a>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </nav>
    <div class="base">
      <p>{t("foot.notrack")}</p>
      <p>{t("foot.copy")}</p>
      <p class="num" data-build>{t("foot.version", { v: BUILD_ID })}</p>
    </div>
  </div>
</footer>
{/if}

{#if tabs}<TabBar />{/if}

<SettingsSheet bind:open={settingsOpen} locked={langLocked} />

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
  /* Retours UI5 : sur téléphone, un peu d'air au-dessus du logo et de Réglages, en plus de la
     zone sûre (sur ordinateur, la barre de 64 px les centre déjà). */
  @media (max-width: 899px) {
    .top,
    .banner-slot ~ .top {
      padding-top: calc(env(safe-area-inset-top, 0px) + var(--sp-2));
    }
    .banner-slot ~ .top {
      padding-top: var(--sp-2);
    }
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
  /* Réglages : discret, une icône seule (nom accessible « Réglages »), sans cadre. */
  /* Réglages (retours UI5) : icône de 26 px, cible de 48 px, sur ordinateur aussi. */
  .gear {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    margin-inline-start: auto;
    margin-inline-end: -8px;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .gear:active {
    transform: scale(0.94);
  }
  .gear[aria-expanded="true"] {
    color: var(--text);
  }
  @media (hover: hover) {
    .gear:hover {
      color: var(--text);
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
    padding-block: var(--sp-6) calc(var(--sp-6) + env(safe-area-inset-bottom));
  }
  /* Téléphone : seulement sur l'accueil et les pages d'information (ailleurs : Réglages). */
  @media (max-width: 899px) {
    .foot:not(.phone) {
      display: none;
    }
  }
  .foot-in {
    display: grid;
    gap: var(--sp-6);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--sp-5) var(--sp-6);
  }
  .ch {
    margin: 0 0 var(--sp-2);
    color: var(--text);
    font-size: var(--fs-small);
    font-weight: 640;
  }
  .col ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .col a,
  .off {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    color: var(--text-2);
    font-size: var(--fs-small);
    text-underline-offset: 0.2em;
  }
  .col a[aria-current="page"] {
    color: var(--text);
  }
  .off {
    color: var(--text-3);
  }
  .soon {
    padding: 1px 8px;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: var(--fs-micro);
  }
  @media (hover: hover) {
    .col a:hover {
      color: var(--text);
    }
  }
  .base {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-5);
    padding-block-start: var(--sp-4);
    border-block-start: 1px solid var(--hair);
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  .base p {
    margin: 0;
  }
  @media (max-width: 599px) {
    .cols {
      grid-template-columns: 1fr 1fr;
    }
    .cols .col:last-child {
      grid-column: 1 / -1;
    }
  }

  .back,
  .small {
    display: none;
  }
  /* ---------- Téléphone : en-tête d'écran natif ---------- */
  @media (max-width: 899px) {
    .bar {
      position: relative;
      flex-wrap: nowrap;
      min-height: 52px;
    }
    /* Retour à la place du logo. */
    .has-back .logo {
      display: none;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-height: 44px;
      margin-inline-start: -10px;
      padding: 0 var(--sp-2) 0 4px;
      border: 0;
      border-radius: var(--r-md);
      background: transparent;
      color: var(--accent);
      font: inherit;
      font-size: var(--fs-body);
      font-weight: 560;
      cursor: pointer;
    }
    .back:active {
      opacity: 0.6;
    }
    .back:focus-visible {
      outline: 2px solid var(--accent);
    }
    .small {
      display: block;
      position: absolute;
      inset-inline: 104px;
      margin: 0;
      overflow: hidden;
      font-size: var(--fs-body);
      font-weight: 620;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0;
      transform: translateY(6px);
      transition:
        opacity 180ms var(--ease-out),
        transform 220ms var(--ease-out);
      pointer-events: none;
    }
    .small.on {
      opacity: 1;
      transform: none;
    }
    .small.on ~ .logo {
      opacity: 0;
      pointer-events: none;
    }
    /* Téléphone : rien en haut à droite, sauf chez le destinataire et sur la gestion. */
    .gear:not(.phone) {
      display: none;
    }
    main {
      padding-block: var(--sp-3) var(--sp-6);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .small {
      transition: none;
    }
    .gear {
      transition: none;
    }
    .gear:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .top.scrolled {
      background: Canvas;
    }
    .gear {
      color: ButtonText;
    }
  }
</style>
