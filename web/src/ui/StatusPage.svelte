<script lang="ts">
  // Page d'état du site (tâche UP) : introuvable, hors ligne, lien invalide ou incomplet,
  // erreur du serveur, trop de demandes, navigateur non pris en charge, maintenance. Même
  // facture partout (Nuit chiffrée) : la marque du logo dans un halo, l'icône de la situation,
  // un titre, une explication honnête, une action claire. Le titre de l'onglet est celui de
  // l'état (jamais un nom, un lien ni une clé) et revient à celui d'avant quand la page s'en va.
  // Focus et annonce sur le titre à l'arrivée (UI §11).
  import type { Component, Snippet } from "svelte";
  import { claimScreenTitle, type TitleScreen } from "../app/title";
  import { getLang } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import Logo from "./Logo.svelte";

  type Props = {
    /** Repère pour les tests et les captures (data-status). */
    kind: string;
    /** Titre de l'onglet ; absent : celui de la route reste. */
    screen?: TitleScreen;
    icon?: Component<{ size?: number; strokeWidth?: number; "aria-hidden"?: "true" }>;
    title: string;
    lede?: string;
    /** Lignes en plus (compte à rebours, note de démo…). */
    children?: Snippet;
    /** Action principale (lien ou bouton). */
    action?: Snippet;
    /** Niveau du titre : h1 pour une page entière, h2 dans un écran qui a déjà son h1. */
    level?: 1 | 2;
  };
  let { kind, screen, icon: Icon, title, lede, children, action, level = 1 }: Props = $props();

  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (!heading) return;
    heading.focus({ preventScroll: true });
    announce(heading.textContent ?? "");
  });
  $effect(() => {
    if (!screen || typeof document === "undefined") return;
    void getLang();
    return claimScreenTitle(screen);
  });
</script>

<section class="status" aria-labelledby="status-title" data-status={kind}>
  <div class="visual" aria-hidden="true">
    <span class="halo"><span class="mark"><Logo variant="mark" /></span></span>
    {#if Icon}<span class="badge"><Icon size={20} strokeWidth={1.9} aria-hidden="true" /></span>{/if}
  </div>
  <svelte:element this={level === 1 ? "h1" : "h2"} id="status-title" class="title" tabindex="-1" bind:this={heading}>{title}</svelte:element>
  {#if lede}<p class="lede">{lede}</p>{/if}
  {@render children?.()}
  {#if action}<div class="act">{@render action()}</div>{/if}
</section>

<style>
  .status {
    width: min(100%, 640px);
    margin-inline: auto;
    padding: var(--sp-8) var(--sp-4);
    display: grid;
    justify-items: start;
    gap: var(--sp-4);
    min-width: 0;
  }
  .visual {
    position: relative;
    margin-bottom: var(--sp-2);
  }
  .halo {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 40%, rgb(95 227 181 / 0.16), rgb(95 227 181 / 0.03) 62%, transparent 70%);
    box-shadow: inset 0 0 0 1px var(--hair);
  }
  .mark {
    display: block;
    height: 40px;
    opacity: 0.9;
  }
  .mark :global(svg) {
    height: 100%;
    width: auto;
  }
  .badge {
    position: absolute;
    right: -6px;
    bottom: -4px;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--accent);
  }
  .title {
    margin: 0;
    font-size: var(--fs-screen);
    font-stretch: var(--wd-screen);
    line-height: 1.1;
    letter-spacing: -0.02em;
    text-wrap: balance;
    max-width: 22ch;
  }
  .title:focus {
    outline: none;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    max-width: 60ch;
    text-wrap: pretty;
  }
  .act {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
    align-items: center;
  }
  .act :global(a) {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent);
    text-underline-offset: 0.2em;
  }
  @media (hover: hover) {
    .act :global(a:hover) {
      color: var(--accent-hover);
    }
  }
  @media (forced-colors: active) {
    .halo,
    .badge {
      border: 1px solid CanvasText;
      background: Canvas;
    }
  }
</style>
