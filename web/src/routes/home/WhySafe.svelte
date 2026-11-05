<script lang="ts">
  // Accueil v3/v4, « Pourquoi c'est sûr » (UI §9.1 ; spec §2, §9, §18, §26) : neuf affirmations
  // vraies, chacune avec sa phrase ; un lien d'exemple dont la partie secrète est surlignée ;
  // médaillon dont l'anse se ferme au défilement. Fond « coffre » (SectionBg). Aucun nom
  // d'algorithme (UI §20.8), jamais « 100 % ». Les limites sont dans Limits.svelte.
  import { followLink, href } from "../../app/router.svelte";
  import { t, type Key } from "../../i18n/i18n.svelte";
  import { magnet, reveal } from "../../ui/attach";
  import { rosette } from "../../ui/decor";
  import SectionBg from "../../ui/SectionBg.svelte";
  import { ArrowRight, CodeXml, EyeOff, HardDrive, Link2, Lock, Server, ShieldX, Timer, UserX } from "../../ui/Icon";
  import Schema from "../../ui/Schema.svelte";

  const CODE_URL = "https://github.com/Skoow/Shhdrop";
  const claims = [
    { k: "e2e", icon: Lock },
    { k: "link", icon: Link2 },
    { k: "ttl", icon: Timer },
    { k: "tries", icon: ShieldX },
    { k: "key", icon: Server },
    { k: "account", icon: UserX },
    { k: "ip", icon: HardDrive },
    { k: "track", icon: EyeOff },
    { k: "code", icon: CodeXml },
  ] as const;
  const outer = rosette(40, 2, 7, 64);
  const inner = rosette(44, 2, 5, 64, 1.03);
</script>

<section class="why" aria-labelledby="why-title">
  <SectionBg kind="vault" />
  <div class="intro">
    <div class="head rv" {@attach reveal}>
      <div class="medal" aria-hidden="true" {@attach reveal}>
        <svg viewBox="0 0 128 128" focusable="false">
          <path class="r1" d={outer} />
          <path class="r2" d={inner} />
          <circle class="disc" cx="64" cy="64" r="30" />
          <g class="lock">
            <path class="shackle" d="M55 60v-7a9 9 0 0 1 18 0v7" />
            <rect x="50" y="60" width="28" height="20" rx="4" />
            <path class="hole" d="M64 67v6" />
          </g>
        </svg>
      </div>
      <h2 id="why-title">{t("home.why.title")}</h2>
      <p class="lede">{t("home.why.lede")}</p>
    </div>
    <figure class="example rv" {@attach reveal}>
      <figcaption>{t("home.why.example")}</figcaption>
      <p class="url" translate="no"><span>https://shhdrop.app/</span><mark>#q3V9-kT0aZx7Lw2…</mark></p>
      <p class="note"><Lock size={15} strokeWidth={2} aria-hidden="true" />{t("home.why.example.note")}</p>
    </figure>
  </div>

  <div class="journey rv" {@attach reveal}><Schema /></div>

  <ul class="claims">
    {#each claims as { k, icon: Icon } (k)}
      <li class="claim rv" {@attach reveal} {@attach magnet}>
        <span class="ic"><Icon size={24} strokeWidth={1.6} aria-hidden="true" /></span>
        <div>
          <h3>{t(`home.why.${k}.t` as Key)}</h3>
          <p>
            {t(`home.why.${k}.p` as Key)}
            {#if k === "code"}<a href={CODE_URL} rel="noopener noreferrer">{t("home.why.code.link")}</a>{/if}
          </p>
        </div>
      </li>
    {/each}
  </ul>
  <a class="more" href={href("/securite")} onclick={(e) => followLink(e, "/securite")}>
    {t("home.why.more")}<ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
  </a>
</section>

<style>
  .why {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-7);
    padding-block: 120px;
  }
  .intro {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-6);
    align-items: end;
  }
  .head {
    display: grid;
    gap: var(--sp-4);
    align-content: start;
    min-width: 0;
  }
  /* Le trajet : une scène à part entière, dans un cadre en relief. */
  .journey {
    min-width: 0;
    padding: clamp(16px, 3vw, 40px) clamp(12px, 3vw, 48px) clamp(16px, 2.5vw, 32px);
    border: 1px solid transparent;
    border-radius: 28px;
    background:
      radial-gradient(60% 80% at 50% 40%, rgb(40 128 154 / 0.12), transparent 70%) padding-box,
      linear-gradient(180deg, rgb(14 17 23 / 0.94), rgb(9 11 15 / 0.94)) padding-box,
      linear-gradient(180deg, rgb(233 236 242 / 0.16), rgb(233 236 242 / 0.03) 60%) border-box;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.05),
      0 40px 80px -48px rgb(0 0 0 / 0.95);
  }
  h2 {
    min-width: 0;
    overflow-wrap: break-word;
    font-size: var(--fs-section);
    line-height: 1.04;
    font-weight: 620;
    font-stretch: 110%;
    letter-spacing: -0.03em;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    font-size: 1.125rem;
  }

  /* Médaillon : rosace guillochée, anse qui se ferme quand la section entre dans l'écran. */
  .medal {
    width: 112px;
    height: 112px;
    margin-bottom: var(--sp-2);
    color: var(--accent);
  }
  .medal svg {
    width: 100%;
    height: 100%;
    overflow: visible;
    fill: none;
  }
  .r1 {
    stroke: rgb(95 227 181 / 0.42);
    stroke-width: 0.6;
  }
  .r2 {
    stroke: rgb(95 227 181 / 0.2);
    stroke-width: 0.5;
  }
  .disc {
    fill: var(--accent-tint);
    stroke: rgb(95 227 181 / 0.45);
    stroke-width: 0.8;
  }
  .lock {
    stroke: var(--accent);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .shackle {
    transform-box: view-box;
    transform-origin: 73px 60px;
  }
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .medal {
        view-timeline: --medal;
      }
      .medal .shackle {
        animation: shackle-close linear both;
        animation-timeline: --medal;
        animation-range: entry 10% cover 45%;
      }
      .medal .r1,
      .medal .r2 {
        transform-box: view-box;
        transform-origin: 64px 64px;
        animation: rose-turn linear both;
        animation-timeline: --medal;
        animation-range: cover;
      }
      .medal .r2 {
        animation-direction: reverse;
      }
    }
    .medal:global(.rv-wait) .shackle {
      transition: transform 600ms var(--ease-settle) 300ms;
    }
    .medal:global(.rv-wait:not(.in)) .shackle {
      transform: translateY(-5px) rotate(-22deg);
    }
  }
  @keyframes shackle-close {
    from {
      transform: translateY(-5px) rotate(-22deg);
    }
    to {
      transform: none;
    }
  }
  @keyframes rose-turn {
    from {
      transform: rotate(-25deg);
    }
    to {
      transform: rotate(25deg);
    }
  }

  /* Lien d'exemple (benchmark motif 13) : la fin, après « # », surlignée. */
  .example {
    margin: 0;
    padding: var(--sp-4);
    border-radius: var(--r-lg);
    background: rgb(4 6 9 / 0.65);
    box-shadow:
      inset 0 0 0 1px var(--hair),
      inset 0 1px 0 rgb(255 255 255 / 0.04);
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }
  figcaption {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .url {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  mark {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--accent-tint);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px rgb(95 227 181 / 0.35);
  }
  .note {
    margin: 0;
    display: flex;
    gap: var(--sp-2);
    align-items: flex-start;
    font-size: var(--fs-small);
    color: var(--text);
  }
  .note :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    justify-self: start;
    min-height: 44px;
    color: var(--text);
    font-weight: 560;
    text-decoration: none;
  }
  .more :global(svg) {
    color: var(--accent);
    transition: transform 500ms var(--ease-settle);
  }
  @media (hover: hover) {
    .more:hover {
      text-decoration: underline;
      text-decoration-color: var(--accent);
      text-underline-offset: 0.3em;
    }
    .more:hover :global(svg) {
      transform: translateX(5px);
    }
  }

  /* Affirmations : cartes en relief, bord qui accroche la lumière, reflet sous le pointeur. */
  .claims {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-3);
  }
  .claim {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: var(--sp-4);
    padding: 22px 22px 24px;
    border: 1px solid transparent;
    border-radius: 20px;
    background:
      linear-gradient(180deg, rgb(20 24 32 / 0.92), rgb(13 16 22 / 0.92)) padding-box,
      linear-gradient(180deg, rgb(233 236 242 / 0.16), rgb(233 236 242 / 0.03) 60%) border-box;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.05),
      0 18px 40px -24px rgb(0 0 0 / 0.9);
    transition: translate 520ms var(--ease-settle);
  }
  .claim::before {
    content: "";
    position: absolute;
    z-index: -1;
    left: 0;
    top: 0;
    width: 280px;
    height: 280px;
    margin: -140px 0 0 -140px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.10), transparent);
    opacity: 0;
    transform: translate(var(--lx, 50%), var(--ly, 50%));
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .claim > div {
    min-width: 0;
    overflow-wrap: break-word;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    color: var(--accent);
    background: rgb(95 227 181 / 0.06);
    box-shadow: inset 0 0 0 1px rgb(95 227 181 / 0.22);
    transition: transform 520ms var(--ease-settle);
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .claim:hover {
      translate: 0 -3px;
    }
    .claim:hover::before {
      opacity: 1;
    }
    .claim:hover .ic {
      transform: scale(1.08) rotate(-4deg);
    }
  }
  .claim h3 {
    font-size: 1.125rem;
    line-height: 1.3;
    font-weight: 620;
    font-stretch: 104%;
  }
  .claim p {
    margin: 6px 0 0;
    color: var(--text-2);
    font-size: 0.9375rem;
  }
  .claim a {
    display: inline-block;
    min-height: 44px;
    padding-block: 10px;
    color: var(--text);
    text-decoration-color: var(--accent);
    text-underline-offset: 0.25em;
  }

  @media (min-width: 720px) {
    .claims {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1024px) {
    .why {
      gap: var(--sp-7);
      padding-block: 180px 160px;
    }
    .intro {
      grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);
      column-gap: 72px;
    }
    .claims {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .claim,
    .ic,
    .more :global(svg) {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .example,
    .ic,
    .claim {
      border: 1px solid CanvasText;
      box-shadow: none;
      background: Canvas;
    }
    .claim::before {
      display: none;
    }
    mark {
      background: Highlight;
      color: HighlightText;
    }
    .r1,
    .r2,
    .disc,
    .lock {
      stroke: CanvasText;
    }
  }
</style>
