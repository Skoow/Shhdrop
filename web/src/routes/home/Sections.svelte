<script lang="ts">
  // Accueil, sous la carte de dépôt (refonte du 12 novembre) : « Comment ça marche » (trois
  // cartes), « Pensé pour la confidentialité » (quatre cartes) et « Offres » (Gratuit, Plus, Pro,
  // valeurs lues dans limits.ts par OffersStrip). Cartes à tuile d'icône teintée, marquée de la
  // trame du logo (trois points qui s'allument au survol) ; apparition au défilement (reveal),
  // jamais en mouvement réduit.
  import { followLink, href } from "../../app/router.svelte";
  import { getLang, t, type Key } from "../../i18n/i18n.svelte";
  import { limitParams } from "../../i18n/limit-params";
  import { reveal } from "../../ui/attach";
  import AddIcon from "../../ui/AddIcon.svelte";
  import { ArrowRight, Broom, EyeOff, KeyRound, Link2, Lock, UserX } from "../../ui/Icon";
  import OffersStrip from "../../ui/OffersStrip.svelte";
  import TabIcon from "../../ui/TabIcon.svelte";

  const how = [
    { k: "add", tint: "mint" },
    { k: "seal", tint: "blue" },
    { k: "go", tint: "cyan" },
  ] as const;
  const priv = [
    { k: "account", tint: "mint" },
    { k: "server", tint: "blue" },
    { k: "clean", tint: "cyan" },
    { k: "room", tint: "amber" },
  ] as const;
</script>

<section class="sec how" id="comment" aria-labelledby="how-title">
  <div class="head rv" {@attach reveal}>
    <h2 id="how-title" tabindex="-1">{t("home.how.title")}</h2>
    <p>{t("home.how.lede")}</p>
  </div>
  <ol class="cards three">
    {#each how as c, i (c.k)}
      <li class="card rv" data-how-card style:--i="{i * 80}ms" {@attach reveal}>
        <span class="num" aria-hidden="true">{i + 1}</span>
        <span class="tile-ic {c.tint}" aria-hidden="true">
          {#if c.k === "add"}<AddIcon id="files" size={22} />{:else if c.k === "seal"}<Lock size={22} strokeWidth={1.8} />{:else}<Link2 size={22} strokeWidth={1.8} />{/if}
        </span>
        <h3>{t(`home.how.${c.k}.t` as Key)}</h3>
        <p>{t(`home.how.${c.k}.p` as Key, limitParams(getLang()))}</p>
      </li>
    {/each}
  </ol>
</section>

<section class="sec priv" aria-labelledby="priv-title">
  <div class="head rv" {@attach reveal}>
    <h2 id="priv-title" tabindex="-1">{t("home.priv.title")}</h2>
    <p>{t("home.priv.lede")}</p>
  </div>
  <ul class="cards four">
    {#each priv as c, i (c.k)}
      <li class={["card", "rv", { soon: c.k === "room" }]} data-priv-card style:--i="{i * 70}ms" {@attach reveal}>
        <span class="tile-ic {c.tint}" aria-hidden="true">
          {#if c.k === "account"}<UserX size={22} strokeWidth={1.8} />{:else if c.k === "server"}<EyeOff size={22} strokeWidth={1.8} />{:else if c.k === "clean"}<Broom size={22} strokeWidth={1.8} />{:else}<TabIcon id="chat" size={22} />{/if}
        </span>
        <h3>{t(`home.priv.${c.k}.t` as Key)}{#if c.k === "room"}{" "}<span class="pill">{t("foot.soon")}</span>{/if}</h3>
        <p>{t(`home.priv.${c.k}.p` as Key)}</p>
      </li>
    {/each}
  </ul>
  <!-- La clé après le « # » (spec §5.3) : les navigateurs n'envoient pas le fragment d'une adresse. -->
  <p class="key rv" data-key-note {@attach reveal}><KeyRound size={18} strokeWidth={1.8} aria-hidden="true" /><span>{t("home.priv.key")}</span></p>
  <a class="more" href={href("/securite")} onclick={(e) => followLink(e, "/securite")}>{t("home.why.more")}<ArrowRight size={18} strokeWidth={1.9} aria-hidden="true" /></a>
</section>

<section class="sec offers" aria-labelledby="offers-title">
  <div class="head rv" {@attach reveal}>
    <h2 id="offers-title">{t("home.offers.title")}</h2>
    <p>{t("home.offers.lede")}</p>
  </div>
  <OffersStrip cards />
</section>

<style>
  .sec {
    display: grid;
    justify-items: center;
    gap: var(--sp-7);
    padding-block: 96px 24px;
    scroll-margin-top: 72px;
  }
  .head > * {
    max-width: 100%;
  }
  .head {
    display: grid;
    justify-items: center;
    width: 100%;
    gap: var(--sp-3);
    max-width: 40rem;
    text-align: center;
  }
  h2 {
    margin: 0;
    min-width: 0;
    overflow-wrap: break-word;
    font-size: clamp(2rem, 1.4rem + 2vw, 3rem);
    line-height: 1.05;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: -0.035em;
    text-wrap: balance;
  }
  h2:focus {
    outline: none;
  }
  .head p {
    margin: 0;
    color: #aab6d3;
    font-size: 1.0625rem;
    line-height: 1.55;
    text-wrap: pretty;
  }
  .cards {
    display: grid;
    gap: var(--sp-4);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .offers :global([data-offer-cards]) {
    width: 100%;
  }
  @media (min-width: 760px) {
    .three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .four {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1180px) {
    .four {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .card {
    position: relative;
    isolation: isolate;
    display: grid;
    align-content: start;
    gap: var(--sp-3);
    min-width: 0;
    padding: 26px 24px 28px;
    border-radius: 20px;
    background: linear-gradient(180deg, rgb(15 22 42 / 0.88), rgb(10 15 30 / 0.88));
    box-shadow:
      inset 0 0 0 1px rgb(150 175 255 / 0.13),
      inset 0 1px 0 rgb(255 255 255 / 0.04);
    transition:
      translate 420ms var(--ease-settle),
      box-shadow var(--dur-base) var(--ease-out);
  }
  /* Lumière du haut, qui s'allume au survol (opacité seulement). */
  .card::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(80% 60% at 30% 0%, rgb(95 227 181 / 0.09), transparent 70%);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .card:hover {
      translate: 0 -3px;
      box-shadow:
        inset 0 0 0 1px rgb(150 175 255 / 0.26),
        inset 0 1px 0 rgb(255 255 255 / 0.06),
        0 24px 48px -28px rgb(0 0 0 / 0.9);
    }
    .card:hover::before {
      opacity: 1;
    }
    .card:hover .tile-ic::after {
      opacity: 1;
    }
  }
  .num {
    position: absolute;
    inset-block-start: 22px;
    inset-inline-end: 24px;
    color: rgb(150 175 255 / 0.55);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
  }
  .tile-ic {
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    margin-bottom: var(--sp-2);
    border-radius: 14px;
  }
  /* La trame du logo : trois points en coin, qui s'allument au survol. */
  .tile-ic::after {
    content: "";
    position: absolute;
    inset-block-start: 4px;
    inset-inline-end: 4px;
    width: 4px;
    height: 14px;
    background:
      radial-gradient(circle, currentColor 1.2px, transparent 1.6px) 50% 0 / 4px 4px no-repeat,
      radial-gradient(circle, currentColor 1.2px, transparent 1.6px) 50% 5px / 4px 4px no-repeat,
      radial-gradient(circle, currentColor 1.2px, transparent 1.6px) 50% 10px / 4px 4px no-repeat;
    opacity: 0.35;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .mint {
    background: rgb(95 227 181 / 0.12);
    box-shadow: inset 0 0 0 1px rgb(95 227 181 / 0.22);
    color: var(--accent);
  }
  .blue {
    background: rgb(92 128 255 / 0.15);
    box-shadow: inset 0 0 0 1px rgb(92 128 255 / 0.3);
    color: #9db4ff;
  }
  .cyan {
    background: rgb(62 193 245 / 0.12);
    box-shadow: inset 0 0 0 1px rgb(62 193 245 / 0.26);
    color: #7fd6f8;
  }
  .amber {
    background: rgb(245 185 64 / 0.12);
    box-shadow: inset 0 0 0 1px rgb(245 185 64 / 0.26);
    color: #f5c96b;
  }
  h3 {
    margin: 0;
    font-size: 1.1875rem;
    line-height: 1.3;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .card p {
    margin: 0;
    color: #aab6d3;
    font-size: 0.9375rem;
    line-height: 1.55;
  }
  .pill {
    display: inline-block;
    margin-inline-start: 4px;
    padding: 1px 8px;
    border-radius: var(--r-pill);
    background: rgb(95 227 181 / 0.1);
    box-shadow: inset 0 0 0 1px rgb(95 227 181 / 0.28);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 600;
    vertical-align: 2px;
  }
  .key {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    max-width: 62ch;
    margin: 0;
    color: var(--text-2);
    text-align: left;
  }
  .key :global(svg) {
    flex: none;
    margin-top: 0.15em;
    color: var(--accent);
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
  }
  .more :global(svg) {
    color: var(--accent);
    transition: transform 420ms var(--ease-settle);
  }
  .more:hover :global(svg) {
    transform: translateX(4px);
  }
  .more:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 6px;
  }
  @media (max-width: 599px) {
    .sec {
      padding-block-start: 72px;
      gap: var(--sp-6);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card,
    .card::before,
    .tile-ic::after,
    .more :global(svg) {
      transition: none;
    }
    .card:hover,
    .more:hover :global(svg) {
      translate: none;
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .card {
      border: 1px solid CanvasText;
    }
    .card::before,
    .tile-ic::after {
      display: none;
    }
  }
</style>
