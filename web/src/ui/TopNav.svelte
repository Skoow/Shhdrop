<script lang="ts">
  // Barre du haut, ordinateur et tablette (refonte du 12 novembre) : menus « Partager » et
  // « Sécurité » en motif disclosure (bouton aria-expanded qui montre une liste de liens ou de
  // boutons, pas un role="menu"), « Salon » bientôt, « Offres » ; à droite « Mes partages » et
  // « Partager ». Clavier : Entrée et Espace ouvrent, flèches haut et bas parcourent, Échap ferme
  // et rend le focus au bouton, Tab hors du menu le ferme ; un clic ailleurs le ferme aussi.
  // Téléphone (< 768 px) : rien de tout ça, la barre d'onglets du bas tient la navigation.
  import { flushSync, tick, type Component } from "svelte";
  import { chrome, type AddGesture } from "../app/chrome.svelte";
  import { followLink, href, navigate, router } from "../app/router.svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { CONTENT_MAX } from "../limits";
  import { announce } from "./announce";
  import AddIcon from "./AddIcon.svelte";
  import { ChevronDown, Compass, EyeOff, Flag, Server, ShieldCheck, Upload } from "./Icon";
  import { reducedMotion } from "./motion";
  import TabIcon from "./TabIcon.svelte";

  let { busy = false }: { busy?: boolean } = $props();

  type MenuId = "share" | "security";
  let open = $state<MenuId | null>(null);
  let wrap: HTMLElement | undefined = $state();
  const uid = $props.id();

  const off = $derived(busy ? { "aria-disabled": "true" as const, "aria-describedby": "foot-busy" } : {});
  const here = (p: string) => (location.pathname === href(p) ? "page" : undefined);

  function items(id: MenuId): HTMLElement[] {
    return [...(document.getElementById(`${uid}-${id}`)?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? [])];
  }
  function button(id: MenuId): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`[aria-controls="${uid}-${id}"]`);
  }
  function toggle(id: MenuId) {
    if (busy) return;
    open = open === id ? null : id;
  }
  function openAt(id: MenuId, which: "first" | "last") {
    if (busy) return;
    flushSync(() => (open = id));
    const list = items(id);
    (which === "first" ? list[0] : list[list.length - 1])?.focus();
  }
  function close(focusBack = false) {
    const was = open;
    open = null;
    if (focusBack && was) button(was)?.focus();
  }
  function onButtonKey(e: KeyboardEvent, id: MenuId) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openAt(id, "first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAt(id, "last");
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  }
  function onPanelKey(e: KeyboardEvent, id: MenuId) {
    const list = items(id);
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (k: number) => {
      e.preventDefault();
      list[(k + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? list.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
  }
  const keysOf = (id: MenuId) => (node: HTMLElement) => {
    const h = (e: KeyboardEvent) => onPanelKey(e, id);
    node.addEventListener("keydown", h);
    return () => node.removeEventListener("keydown", h);
  };
  function onFocusOut(e: FocusEvent, id: MenuId) {
    const next = e.relatedTarget as Node | null;
    const box = document.getElementById(`${uid}-${id}`)?.parentElement;
    if (open === id && (!next || !box?.contains(next))) open = null;
  }
  // Clic ailleurs : ferme, sans voler le focus.
  $effect(() => {
    if (!open) return;
    const down = (e: Event) => {
      if (!wrap?.contains(e.target as Node)) open = null;
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  });
  // Changement d'écran : menus fermés.
  $effect(() => {
    void router.current;
    open = null;
  });

  /** Geste du composeur : direct s'il est monté (accueil, page d'envoi), sinon par la page d'envoi. */
  function share(g: AddGesture) {
    close();
    if (chrome.add) chrome.add(g);
    else {
      chrome.pending = g;
      navigate("/envoyer");
    }
  }
  /** Section de l'accueil, sans « # » dans l'adresse (le « # » est réservé aux clés). */
  async function section(id: string, faq = false) {
    close();
    if (router.current.name !== "home") {
      navigate("/");
      await tick();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    const el = document.getElementById(id);
    if (!el) return;
    if (faq && el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    const target = faq ? el.querySelector<HTMLElement>("summary") : el.querySelector<HTMLElement>("h2");
    target?.focus({ preventScroll: true });
  }

  type Item = { id: string; icon: Component<{ size?: number; strokeWidth?: number }> | null; add?: "media" | "voice" | "note"; tint: string; title: string; desc: string; run?: () => void; path?: string };
  const shareItems = $derived<Item[]>([
    { id: "fichiers", icon: Upload, tint: "mint", title: t("nav.share.fichiers.t"), desc: t("nav.share.fichiers.d", { size: formatBytes(CONTENT_MAX, getLang()) }), run: () => share("fichiers") },
    { id: "texte", icon: null, add: "note", tint: "blue", title: t("nav.share.texte.t"), desc: t("nav.share.texte.d"), run: () => share("texte") },
    { id: "vocal", icon: null, add: "voice", tint: "cyan", title: t("nav.share.vocal.t"), desc: t("nav.share.vocal.d"), run: () => share("vocal") },
    { id: "media", icon: null, add: "media", tint: "amber", title: t("nav.share.media.t"), desc: t("nav.share.media.d"), run: () => share("media") },
  ]);
  const secItems = $derived<Item[]>([
    { id: "how", icon: Compass, tint: "mint", title: t("nav.sec.how.t"), desc: t("nav.sec.how.d"), run: () => void section("comment") },
    { id: "server", icon: Server, tint: "blue", title: t("nav.sec.server.t"), desc: t("nav.sec.server.d"), run: () => void section("faq-server", true) },
    { id: "page", icon: ShieldCheck, tint: "cyan", title: t("nav.sec.page.t"), desc: t("nav.sec.page.d"), path: "/securite" },
    { id: "privacy", icon: EyeOff, tint: "blue", title: t("nav.sec.privacy.t"), desc: t("nav.sec.privacy.d"), path: "/confidentialite" },
    { id: "report", icon: Flag, tint: "amber", title: t("nav.sec.report.t"), desc: t("nav.sec.report.d"), path: "/signaler" },
  ]);
</script>

{#snippet entry(it: Item)}
  <span class="it-ic {it.tint}" aria-hidden="true">
    {#if it.icon}<it.icon size={18} strokeWidth={1.9} />{:else if it.add}<AddIcon id={it.add} size={18} />{/if}
  </span>
  <span class="it-tx"><span class="it-t">{it.title}</span><span class="it-d">{it.desc}</span></span>
{/snippet}

{#snippet menu(id: MenuId, label: string, list: Item[])}
  <div class="dd" onfocusout={(e) => onFocusOut(e, id)}>
    <button
      type="button"
      class={["nl", "dd-b", { on: open === id }]}
      aria-expanded={open === id}
      aria-controls="{uid}-{id}"
      onclick={() => toggle(id)}
      onkeydown={(e) => onButtonKey(e, id)}
      {...off}
    >
      {label}<ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
    </button>
    <div class={["panel", id]} id="{uid}-{id}" hidden={open !== id}>
      <!-- Flèches, Début, Fin, Échap : délégués à la liste (les entrées sont des liens et des boutons). -->
      <ul {@attach keysOf(id)}>
        {#each list as it (it.id)}
          <li>
            {#if it.path}
              <a class="it" href={href(it.path)} aria-current={here(it.path)} data-nav-item {...off} onclick={(e) => {
                  close();
                  followLink(e, it.path!);
                }}>{@render entry(it)}</a
              >
            {:else}
              <button type="button" class="it" data-nav-item onclick={it.run}>{@render entry(it)}</button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/snippet}

<nav class="topnav" aria-label={t("nav.label")} bind:this={wrap}>
  <ul class="main">
    <li>{@render menu("share", t("nav.share"), shareItems)}</li>
    <li>
      <button type="button" class="nl room" aria-disabled="true" aria-describedby="{uid}-room" onclick={() => announce(t("tabs.soon.chat"))}>
        {t("nav.room")}<span class="soon">{t("foot.soon")}</span>
      </button>
      <span id="{uid}-room" class="sr-only">{t("tabs.soon.chat")}</span>
    </li>
    <li>{@render menu("security", t("nav.security"), secItems)}</li>
    <li>
      <a class="nl" href={href("/offres")} aria-current={here("/offres")} onclick={(e) => (busy ? e.preventDefault() : followLink(e, "/offres"))} {...off}>{t("nav.offers")}</a>
    </li>
  </ul>
  <div class="acts">
    <a class="btn ghost" href={href("/envois")} aria-current={here("/envois")} onclick={(e) => (busy ? e.preventDefault() : followLink(e, "/envois"))} {...off}>{t("nav.shares")}</a>
    <a class="btn solid" href={href("/envoyer")} onclick={(e) => (busy ? e.preventDefault() : followLink(e, "/envoyer"))} {...off}>{t("nav.cta")}</a>
  </div>
</nav>

<style>
  .topnav {
    display: none;
  }
  @media (min-width: 768px) {
    .topnav {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-4);
      min-width: 0;
      margin-inline-start: var(--sp-5);
    }
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .main {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .main > li {
    position: relative;
  }
  .nl {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 560;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .nl:hover,
  .nl.on {
    color: var(--text);
    background: rgb(255 255 255 / 0.05);
  }
  .nl[aria-current="page"] {
    color: var(--text);
  }
  .dd-b :global(svg) {
    color: var(--text-3);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .dd-b.on :global(svg) {
    transform: rotate(180deg);
    color: var(--accent);
  }
  .room {
    cursor: not-allowed;
    color: var(--text-3);
  }
  .soon {
    padding: 1px 7px;
    border-radius: var(--r-pill);
    background: rgb(95 227 181 / 0.1);
    box-shadow: inset 0 0 0 1px rgb(95 227 181 / 0.28);
    color: var(--accent);
    font-size: 0.6875rem;
    font-weight: 600;
  }
  .nl:focus-visible,
  .btn:focus-visible,
  .it:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  [aria-disabled="true"] {
    cursor: not-allowed;
  }
  a[aria-disabled="true"] {
    color: var(--text-disabled);
  }

  /* Panneau : verre sombre, entrées à tuile teintée. */
  .panel {
    position: absolute;
    inset-block-start: calc(100% + 10px);
    inset-inline-start: -8px;
    z-index: 30;
    width: 360px;
    padding: 8px;
    border-radius: 18px;
    background: #0c1222;
    box-shadow:
      inset 0 0 0 1px rgb(150 175 255 / 0.16),
      inset 0 1px 0 rgb(255 255 255 / 0.06),
      0 24px 48px -24px rgb(0 0 0 / 0.7);
    transform-origin: 24px 0;
  }
  .panel:not([hidden]) {
    animation: drop 220ms var(--ease-out) both;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
  }
  .panel ul {
    display: grid;
    gap: 2px;
  }
  .it {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: start;
    text-decoration: none;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .it:hover,
  .it:focus-visible {
    background: rgb(255 255 255 / 0.05);
  }
  .it-ic {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    transition: transform 360ms var(--ease-settle);
  }
  .it:hover .it-ic {
    transform: translateY(-1px) scale(1.05);
  }
  .it-tx {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .it-t {
    font-size: 0.9375rem;
    font-weight: 620;
  }
  .it-d {
    color: var(--text-2);
    font-size: 0.8125rem;
    line-height: 1.35;
  }
  .mint {
    background: rgb(95 227 181 / 0.12);
    color: var(--accent);
  }
  .blue {
    background: rgb(92 128 255 / 0.16);
    color: #9db4ff;
  }
  .cyan {
    background: rgb(62 193 245 / 0.13);
    color: #7fd6f8;
  }
  .amber {
    background: rgb(245 185 64 / 0.13);
    color: #f5c96b;
  }

  .acts {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 16px;
    border-radius: 12px;
    font-size: 0.9375rem;
    font-weight: 620;
    text-decoration: none;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .btn.ghost {
    border: 1px solid rgb(150 175 255 / 0.26);
    color: var(--text);
  }
  .btn.ghost:hover {
    border-color: rgb(150 175 255 / 0.5);
    background: rgb(255 255 255 / 0.04);
  }
  .btn.solid {
    background: var(--sig-blue);
    color: #fff;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.2),
      0 8px 24px -10px rgb(51 102 255 / 0.8);
  }
  .btn.solid:hover {
    background: var(--sig-blue-hover);
  }
  .btn:active {
    transform: scale(0.97);
  }
  .btn[aria-disabled="true"] {
    background: transparent;
    border: 1px solid var(--hair-2);
    box-shadow: none;
    pointer-events: none;
  }
  /* Tablette : tout tient sur une ligne ; la pastille « bientôt » devient un point (la raison
     reste lue, aria-describedby). */
  @media (max-width: 1023px) {
    .nl {
      padding: 0 8px;
      font-size: 0.875rem;
    }
    .btn {
      padding: 0 12px;
      font-size: 0.875rem;
    }
    .soon {
      width: 7px;
      height: 7px;
      padding: 0;
      overflow: hidden;
      color: transparent;
      background: var(--accent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel:not([hidden]) {
      animation: none;
    }
    .nl,
    .it,
    .it-ic,
    .btn,
    .dd-b :global(svg) {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .panel {
      border: 1px solid CanvasText;
    }
    .btn {
      border: 1px solid ButtonText;
    }
  }
</style>
