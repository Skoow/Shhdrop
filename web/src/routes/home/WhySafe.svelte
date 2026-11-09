<script lang="ts">
  // Accueil, « Pourquoi c'est sûr » (UI §9.1 ; spec §2, §9, §18) : quatre points forts en
  // « bento » (retours HOME5) — une grande carte (chiffrement : le trajet et un lien d'exemple
  // dont la partie secrète est surlignée), trois petites (autodestruction, rien sur vous, code
  // ouvert). Aucun nom d'algorithme (UI §20.8), jamais « 100 % ». Les limites, dont l'historique
  // du navigateur, sont dans la page Sécurité, vers laquelle pointe le lien final.
  import { followLink, href } from "../../app/router.svelte";
  import { t } from "../../i18n/i18n.svelte";
  import { magnet, reveal } from "../../ui/attach";
  import SectionBg from "../../ui/SectionBg.svelte";
  import { ArrowRight, CodeXml, Hourglass, Lock, UserX } from "../../ui/Icon";
  import Schema from "../../ui/Schema.svelte";

  const CODE_URL = "https://github.com/Skoow/shhdrop";
</script>

<section class="why" aria-labelledby="why-title">
  <SectionBg kind="vault" />
  <div class="head rv" {@attach reveal}>
    <h2 id="why-title">{t("home.why.title")}</h2>
    <p class="lede">{t("home.why.lede")}</p>
  </div>

  <ul class="bento">
    <li class="card big claim rv" {@attach reveal} {@attach magnet}>
      <div class="txt">
        <span class="ic" aria-hidden="true"><Lock size={22} strokeWidth={1.8} /></span>
        <h3>{t("home.why.e2e.t")}</h3>
        <p>{t("home.why.e2e.p")}</p>
      </div>
      <div class="journey"><Schema /></div>
      <figure class="example">
        <figcaption>{t("home.why.example")}</figcaption>
        <p class="url" translate="no"><span>https://shhdrop.app/</span><mark>#q3V9-kT0aZx7Lw2…</mark></p>
        <p class="note"><Lock size={15} strokeWidth={2} aria-hidden="true" />{t("home.why.example.note")}</p>
      </figure>
    </li>
    <li class="card claim ttl rv" {@attach reveal} {@attach magnet}>
      <span class="vis dial" aria-hidden="true">
        <svg viewBox="0 0 64 64" focusable="false"><circle class="trk" cx="32" cy="32" r="27" /><circle class="arc" cx="32" cy="32" r="27" pathLength="100" /></svg>
        <Hourglass size={22} strokeWidth={1.8} />
      </span>
      <h3>{t("home.why.ttl.t")}</h3>
      <p>{t("home.why.ttl.p")}</p>
      <span class="pips" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b></span>
    </li>
    <li class="card claim you rv" {@attach reveal} {@attach magnet}>
      <span class="vis rings" aria-hidden="true"><UserX size={22} strokeWidth={1.8} /></span>
      <h3>{t("home.why.you.t")}</h3>
      <p>{t("home.why.you.p")}</p>
    </li>
    <li class="card claim code rv" {@attach reveal} {@attach magnet}>
      <span class="vis rings" aria-hidden="true"><CodeXml size={22} strokeWidth={1.8} /></span>
      <h3>{t("home.why.code.t")}</h3>
      <p>{t("home.why.code.p")} <a href={CODE_URL} rel="noopener noreferrer">{t("home.why.code.link")}</a></p>
    </li>
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
    gap: var(--sp-6);
    padding-block: 120px;
  }
  .head {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
  }
  .lede {
    max-width: 40rem;
  }
  h2 {
    min-width: 0;
    overflow-wrap: break-word;
    font-size: var(--fs-section);
    line-height: 1;
    font-weight: 680;
    font-stretch: 116%;
    letter-spacing: -0.04em;
    text-wrap: balance;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    font-size: 1.125rem;
  }

  /* Bento : verre sombre, contour qui accroche la lumière (masque), reflet sous le pointeur. */
  .bento {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-3);
  }
  .card {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    align-content: start;
    gap: var(--sp-3);
    min-width: 0;
    padding: 24px;
    border-radius: 24px;
    background: rgb(16 20 27 / 0.62);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
    backdrop-filter: blur(14px) saturate(140%);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.06),
      0 30px 60px -40px rgb(0 0 0 / 0.95);
    transition: translate 520ms var(--ease-settle);
  }
  .card::after {
    content: "";
    position: absolute;
    inset: 0;
    padding: 1px;
    border-radius: inherit;
    background: linear-gradient(160deg, rgb(201 251 232 / 0.28), rgb(233 236 242 / 0.06) 40%, rgb(233 236 242 / 0.03) 70%, rgb(95 227 181 / 0.16));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    pointer-events: none;
  }
  .card::before {
    content: "";
    position: absolute;
    z-index: -1;
    left: 0;
    top: 0;
    width: 320px;
    height: 320px;
    margin: -160px 0 0 -160px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.11), transparent);
    opacity: 0;
    transform: translate(var(--lx, 50%), var(--ly, 50%));
    transition: opacity var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .card:hover {
      translate: 0 -3px;
    }
    .card:hover::before {
      opacity: 1;
    }
    .card:hover .vis,
    .card:hover .ic {
      transform: scale(1.06) rotate(-4deg);
    }
  }
  .txt {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
  }
  h3 {
    min-width: 0;
    overflow-wrap: break-word;
    font-size: 1.3125rem;
    line-height: 1.2;
    font-weight: 660;
    font-stretch: 108%;
    letter-spacing: -0.015em;
  }
  .big h3 {
    font-size: clamp(1.5rem, 1.1rem + 1.4vw, 2.125rem);
    line-height: 1.08;
    letter-spacing: -0.03em;
    font-stretch: 112%;
  }
  .card p {
    margin: 0;
    min-width: 0;
    overflow-wrap: break-word;
    color: var(--text-2);
    font-size: 0.9375rem;
    line-height: 1.55;
  }
  .card a {
    color: var(--text);
    text-decoration-color: var(--accent);
    text-underline-offset: 0.25em;
    /* Cible de 44 px sans gonfler la ligne. */
    display: inline-block;
    padding-block: 10px;
  }
  .journey {
    min-width: 0;
    margin-inline: -8px;
  }

  /* Visuels maison des petites cartes : médaillon de verre, anneaux, cadran. */
  .ic,
  .vis {
    position: relative;
    display: grid;
    place-items: center;
    color: var(--accent);
    transition: transform 520ms var(--ease-settle);
  }
  .ic {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: rgb(95 227 181 / 0.08);
    box-shadow:
      inset 0 0 0 1px rgb(95 227 181 / 0.28),
      0 0 28px -6px var(--seal-halo);
  }
  .vis {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.14), rgb(95 227 181 / 0.03));
    box-shadow:
      inset 0 0 0 1px rgb(95 227 181 / 0.3),
      0 0 0 8px rgb(95 227 181 / 0.04),
      0 0 0 16px rgb(95 227 181 / 0.02),
      0 0 32px -4px var(--seal-halo);
    margin: 8px 0 var(--sp-2) 8px;
  }
  .dial svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
    transform: rotate(-90deg);
  }
  .trk {
    stroke: rgb(95 227 181 / 0.14);
    stroke-width: 3;
  }
  .arc {
    stroke: var(--accent);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 34 100;
  }
  .pips {
    display: flex;
    gap: 6px;
    margin-top: var(--sp-1);
  }
  .pips b {
    width: 22px;
    height: 4px;
    border-radius: 2px;
    background: rgb(233 236 242 / 0.16);
  }
  .pips b:last-child {
    background: var(--danger);
  }
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .dial .arc {
        animation: arc-down linear both;
        animation-timeline: view();
        animation-range: entry 20% cover 60%;
      }
      .bento > :nth-child(2) {
        animation-range: entry 8% entry 78%;
      }
      .bento > :nth-child(3) {
        animation-range: entry 16% entry 86%;
      }
      .bento > :nth-child(4) {
        animation-range: entry 24% entry 94%;
      }
    }
  }
  @keyframes arc-down {
    from {
      stroke-dasharray: 100 100;
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

  @media (min-width: 720px) {
    .bento {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .big {
      grid-column: 1 / -1;
    }
  }
  @media (min-width: 1024px) {
    .why {
      gap: var(--sp-7);
      padding-block: 180px 160px;
    }
    .bento {
      grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
      grid-template-rows: repeat(3, auto);
      gap: var(--sp-4);
    }
    .big {
      grid-column: 1;
      grid-row: 1 / span 3;
      padding: 36px;
      gap: var(--sp-5);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card,
    .ic,
    .vis,
    .more :global(svg) {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .example,
    .ic,
    .vis,
    .card {
      border: 1px solid CanvasText;
      box-shadow: none;
      background: Canvas;
    }
    .card::before,
    .card::after {
      display: none;
    }
    mark {
      background: Highlight;
      color: HighlightText;
    }
    .trk,
    .arc {
      stroke: CanvasText;
    }
    .pips b {
      background: CanvasText;
    }
  }
</style>
