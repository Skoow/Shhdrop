<script lang="ts">
  import type { Snippet } from "svelte";
  import { BUILD_ID } from "../app/build";
  import { chrome } from "../app/chrome.svelte";
  import { followLink, href, navigate, router } from "../app/router.svelte";
  import { LICENSE_URL, SOURCE_URL } from "../routes/pages/content";
  import { t } from "../i18n/i18n.svelte";
  import Aurora from "./Aurora.svelte";
  import { ChevronLeft } from "./Icon";
  import LiveRegion from "./LiveRegion.svelte";
  import Logo from "./Logo.svelte";
  import TabBar from "./TabBar.svelte";
  import TopNav from "./TopNav.svelte";

  type Props = {
    children: Snippet;
    /** Emplacement du bandeau de démo (vide hors démo). */
    banner?: Snippet;
    /** Vrai pendant un envoi : le pied reste affiché mais ses liens sont désactivés, pour
     *  qu'aucun clic ne quitte la page et coupe l'envoi. */
    busy?: boolean;
    /** Barre d'onglets du téléphone (app/tabbar.ts) ; rendue sous 768 px seulement (CSS). */
    tabs?: boolean;
  };
  let { children, banner, busy = false, tabs = false }: Props = $props();

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

  // Lien désactivé pendant l'envoi : annoncé comme tel, avec sa raison, et GARDÉ dans le parcours
  // clavier comme la langue et le nettoyage (audit M22 : sur « Lien prêt », Tab sautait les liens
  // mais pas les boutons ; un élément désactivé reste trouvable, sa raison se lit).
  const off = $derived(busy ? { "aria-disabled": "true" as const, "aria-describedby": "foot-busy" } : {});

  const here = (name: string) => (router.current.name === name ? "page" : undefined);

  // Téléphone (< 900 px), en-tête d'écran natif : retour en haut à gauche sur les pages
  // secondaires de l'expéditeur, et le grand titre de l'écran qui se réduit dans la barre une
  // fois défilé (titre marqué data-large-title, sinon le h1 de l'écran). Sur ordinateur, rien ne change.
  const INFO: ReadonlySet<string> = new Set(["securite", "confidentialite", "conditions", "mentions", "signaler", "offres"]);
  const BACK: ReadonlySet<string> = new Set([...INFO, "notfound", "manage", "envois"]);
  // Pied de page sur toutes les pages, ordinateur et téléphone, composeur compris (retours du
  // 11 novembre) ; sur ordinateur, le composeur tient dans l'écran et le pied est juste dessous.
  /** `tiers` : « Plus » et « Pro » du libellé au bleu de leur offre, le reste comme les autres liens. */
  type FootLink = { label: string; path?: string; url?: string; soon?: boolean; report?: boolean; tiers?: boolean };
  const footCols = $derived<{ id: string; title: string; links: FootLink[] }[]>([
    {
      id: "product",
      title: t("foot.product"),
      links: [
        { label: t("foot.send"), path: "/" },
        { label: t("foot.shares"), path: "/envois" },
        { label: t("foot.room"), soon: true },
        { label: t("foot.offers"), path: "/offres", tiers: true },
      ],
    },
    {
      id: "trust",
      title: t("foot.trust"),
      links: [
        { label: t("shell.security"), path: "/securite" },
        { label: t("shell.privacy"), path: "/confidentialite" },
        { label: t("foot.source"), url: SOURCE_URL },
        { label: t("foot.report"), path: "/signaler", report: true },
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
  // Libellé découpé : les mots « Plus » et « Pro » (noms d'offre, identiques en français et en anglais).
  const tierParts = (label: string) => label.split(/\b(Plus|Pro)\b/).map((text, i) => ({ text, tier: i % 2 === 1 ? text.toLowerCase() : null }));
  // « Envoyer » (/) n'est la page courante que sur l'accueil : un partage ouvert a aussi « / » pour chemin.
  const pathHere = (p: string) => (router.current.name !== "notfound" && location.pathname === href(p) && (p !== "/" || router.current.name === "home") ? "page" : undefined);
  // « Mes partages » est un onglet racine quand la barre d'onglets est là : pas de Retour.
  const back = $derived(BACK.has(router.current.name) && !(tabs && router.current.name === "envois"));
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
    <!-- Pendant un envoi et sur « Lien prêt » : désactivé comme le pied (audit I2). -->
    <a class="logo" href={href("/")} onclick={(e) => (busy ? e.preventDefault() : followLink(e, "/"))} aria-label={t("shell.home")} {...off}>
      <!-- Logo « Trame » (scripts/gen-logo.mjs) ; l'introduction ne se joue que sur l'accueil, une fois par chargement. -->
      <Logo />
    </a>
    <!-- Ordinateur et tablette (≥ 768 px, refonte du 12 novembre) : menus et actions. -->
    <TopNav {busy} />
  </div>
</header>

<main id="contenu" tabindex="-1" bind:this={main} class="wrap">
  {@render children()}
</main>

<footer class={["foot", { busy }]} data-foot>
  <div class="wrap foot-in">
    {#if busy}
      <!-- Envoi en cours : raison lisible des liens et réglages désactivés. -->
      <p id="foot-busy" class="busy-note" data-foot-busy>{t("foot.busy")}</p>
    {/if}
    <div class="brand">
      <a class="foot-logo" href={href("/")} aria-label={t("shell.home")} {...off} onclick={(e) => (busy ? e.preventDefault() : followLink(e, "/"))}><Logo /></a>
      <p class="tag">{t("foot.tagline")}</p>
    </div>
    <nav class="cols" aria-label={t("shell.nav")}>
      {#each footCols as col (col.id)}
        <div class="col">
          <p class="ch" id="foot-{col.id}">{col.title}</p>
          <ul aria-labelledby="foot-{col.id}">
            {#each col.links as l (l.label)}
              <li>
                {#if l.soon}
                  <span class="off">{l.label} <span class="soon">{t("foot.soon")}</span></span>
                {:else if busy}
                  <!-- Envoi en cours : lien aria-disabled, raison lue (foot-busy), toujours atteignable au clavier (audit M22) ; clic et Entrée sans effet (preventDefault), pointeur neutralisé en CSS. -->
                  <a class="fl" href={l.url ?? href(l.path ?? "/")} {...off} onclick={(e) => e.preventDefault()}>{l.report && chrome.report ? t("content.report") : l.label}</a>
                {:else if l.report && chrome.report}
                  <!-- Partage ouvert : la confirmation de signalement de CE partage (même action qu'avant). -->
                  <button type="button" class="fl" aria-haspopup="dialog" onclick={() => chrome.report?.()} data-report-share>{t("content.report")}</button>
                {:else if l.url}
                  <a class="fl" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<span class="sr-only"> {t("foot.external")}</span></a>
                {:else if l.path && l.tiers}
                  <a class="fl tiers" href={href(l.path)} aria-current={pathHere(l.path)} onclick={(e) => followLink(e, l.path!)} data-foot-offers
                    ><span>{#each tierParts(l.label) as p, i (i)}{#if p.tier}<span class="tier {p.tier}">{p.text}</span>{:else}{p.text}{/if}{/each}</span></a
                  >
                {:else if l.path}
                  <a class="fl" href={href(l.path)} aria-current={pathHere(l.path)} onclick={(e) => followLink(e, l.path!)}>{l.label}</a>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </nav>
    <!-- Ex-panneau Réglages : seul « À propos » reste (retours du propriétaire du 12 novembre) :
         la langue suit le navigateur (UI §10), plus de choix dans le pied ; plus de réglage
         « Nettoyage automatique » (le balai de chaque fichier, spec §35.2). -->
    <div class="prefs" data-foot-prefs>
      <section class="pref" aria-labelledby="foot-about">
        <p class="ch" id="foot-about">{t("settings.about")}</p>
        <p class="about">{t("settings.about.body")}</p>
      </section>
    </div>
    <div class="base">
      <!-- Retours UI9 : le nom en bas à gauche, « © 2026 » à côté (plus de mention « aucune publicité »). -->
      <p class="sig"><span class="wm" translate="no">Shhgone</span><span>{t("foot.copy")}</span></p>
      <p class="num" data-build>{t("foot.version", { v: BUILD_ID })}</p>
    </div>
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
  /* Retours UI5 : sur téléphone, un peu d'air au-dessus du logo, en plus de la
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
  .logo[aria-disabled="true"] {
    cursor: not-allowed;
  }
  main {
    min-height: 60dvh;
    padding-block: var(--sp-5);
  }
  main:focus {
    outline: none;
  }

  /* Pied de page (retours UI7) : lueur discrète de la DA sous un filet supérieur lumineux (le
     grain de l'aurore passe dessous), marque à gauche au même bord intérieur que l'en-tête,
     colonnes hiérarchisées, liens JAMAIS soulignés (retours UI8) : survol et focus par la couleur,
     anneau de focus au clavier. */
  .foot {
    position: relative;
    isolation: isolate;
    margin-block-start: var(--sp-8);
    padding-block: var(--sp-7) calc(var(--sp-6) + env(safe-area-inset-bottom));
    background:
      radial-gradient(60% 120% at 12% 0%, rgb(95 227 181 / 0.07), transparent 70%),
      radial-gradient(50% 90% at 88% 100%, rgb(85 150 248 / 0.05), transparent 70%),
      linear-gradient(to bottom, transparent, rgb(7 8 12 / 0.55));
  }
  .foot::before {
    content: "";
    position: absolute;
    inset-inline: 0;
    inset-block-start: 0;
    block-size: 1px;
    background: linear-gradient(90deg, transparent, rgb(95 227 181 / 0.45) 22%, rgb(233 236 242 / 0.16) 60%, transparent);
  }
  /* Papier peint maison (retours UI7) : petits pictos Shhgone répétés (cadenas, clé, fichier,
     onde, points de la Trame), fichier statique mis en cache (CSP : ni data: ni style inline),
     à très faible contraste et fondu vers le haut ; retiré en contraste renforcé ou forcé. */
  .foot::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: url(../assets/motif.svg) 0 0 / 180px 180px repeat;
    opacity: 0.045;
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 45%);
    mask-image: linear-gradient(to bottom, transparent, #000 45%);
  }
  .foot-in {
    display: grid;
    grid-template-columns: minmax(14rem, 1fr) minmax(0, 2.4fr);
    gap: var(--sp-7) var(--sp-6);
  }
  .brand {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: var(--sp-3);
  }
  .foot-logo {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--text);
    border-radius: var(--r-sm);
  }
  .tag {
    margin: 0;
    max-width: 30ch;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    text-wrap: pretty;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-5) var(--sp-6);
  }
  .ch {
    margin: 0 0 var(--sp-3);
    color: var(--text-3);
    font-size: var(--fs-micro);
    font-weight: 640;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .col ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fl,
  .off {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 40px;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .fl {
    position: relative;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--fs-small);
    text-align: start;
    text-decoration: none;
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-out),
      translate var(--dur-base) var(--ease-out);
  }
  /* Cible d'appui de 44 px (audit M21) : 40 px dessinés, 2 px de plus de chaque côté, invisibles. */
  .fl::after {
    content: "";
    position: absolute;
    inset: -2px 0;
  }
  .fl:hover,
  .fl:focus-visible {
    color: var(--text);
  }
  /* Page courante : couleur d'accent, sans trait. */
  .fl[aria-current="page"] {
    color: var(--accent);
  }
  /* Ligne des offres (retours TABLE, CLEAN2, CLEAN3) : « Offres » et « et » toujours en gris
     comme le reste du pied, même sur la page des offres ; seuls « Plus » et « Pro » prennent le
     bleu de leur offre ; jamais le vert d'accent. */
  .fl.tiers[aria-current="page"] {
    color: var(--text-2);
  }
  .tier.plus {
    color: var(--plus);
  }
  .tier.pro {
    color: var(--pro);
  }
  .fl.tiers[aria-current="page"] {
    font-weight: 600;
  }
  @media (forced-colors: active) {
    .tier {
      color: LinkText;
    }
  }
  @media (hover: hover) {
    .fl:hover {
      translate: 2px 0;
    }
  }
  /* Clavier : anneau net autour du lien (jamais de soulignement, retours UI8). */
  .fl:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 6px;
    padding-inline: 4px;
    margin-inline: -4px;
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
  /* Envoi en cours : liens et réglages désactivés (raison dite en tête du pied). */
  .busy-note {
    grid-column: 1 / -1;
    margin: 0;
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    background: rgb(255 255 255 / 0.04);
    box-shadow: inset 0 0 0 1px var(--hair);
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .foot [aria-disabled="true"] {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
  .foot a[aria-disabled="true"] {
    pointer-events: none;
  }
  .busy .tier {
    color: inherit;
  }
  /* Ex-panneau Réglages : « À propos » seulement. */
  .prefs {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-5) var(--sp-6);
    padding-block-start: var(--sp-5);
    border-block-start: 1px solid var(--hair);
  }
  .pref {
    display: grid;
    align-content: start;
    min-width: 0;
  }
  .about {
    margin: 0;
    max-width: 40ch;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    text-wrap: pretty;
  }
  .base {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-5);
    padding-block-start: var(--sp-5);
    border-block-start: 1px solid var(--hair);
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  .base p {
    margin: 0;
  }
  .sig {
    display: inline-flex;
    align-items: baseline;
    gap: var(--sp-2);
  }
  .wm {
    color: var(--text-2);
    font-weight: 600;
  }
  .base .num {
    margin-inline-start: auto;
  }
  @media (max-width: 899px) {
    .foot-in {
      grid-template-columns: 1fr;
      gap: var(--sp-6);
    }
  }
  @media (max-width: 599px) {
    .foot {
      padding-block-start: var(--sp-6);
    }
    .cols {
      grid-template-columns: 1fr 1fr;
      gap: var(--sp-5) var(--sp-4);
    }
    .cols .col:last-child {
      grid-column: 1 / -1;
    }
    .fl,
    .off {
      min-height: 44px;
    }
    .base {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--sp-1);
    }
    .base .num {
      margin-inline-start: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fl {
      transition: none;
    }
    .fl:hover {
      translate: none;
    }
  }
  @media (prefers-contrast: more), (forced-colors: active) {
    .foot {
      background: none;
      border-block-start: 1px solid var(--line-strong);
    }
    .foot::before,
    .foot::after {
      display: none;
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
      display: none;
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
    /* Téléphone seulement : la tablette a la barre du haut complète. */
    @media (max-width: 767px) {
      .small {
        display: block;
      }
    }
    .small.on ~ .logo {
      opacity: 0;
      pointer-events: none;
    }
    main {
      padding-block: var(--sp-3) var(--sp-6);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .small {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .top.scrolled {
      background: Canvas;
    }
  }
</style>
