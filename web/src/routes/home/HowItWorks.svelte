<script lang="ts">
  // Accueil v3, « Comment ça marche » (UI §9.1) : trois gestes, chacun avec une petite scène
  // animée en boucle (ambiance : pause hors écran et onglet caché ; image fixe en mouvement réduit).
  import { t } from "../../i18n/i18n.svelte";
  import { ambient, magnet, reveal } from "../../ui/attach";
  import SectionBg from "../../ui/SectionBg.svelte";
  import { Camera, KeyRound, Link2, Lock, Mic, Type } from "../../ui/Icon";

  // Capsule du logo à l'échelle de la scène (240 × 160), départ au milieu du bord haut.
  const CAP = "M120 30H170A30 30 0 0 1 200 60V100A30 30 0 0 1 170 130H70A30 30 0 0 1 40 100V60A30 30 0 0 1 70 30H120";
</script>

<section class="how" id="comment" aria-labelledby="how-title">
  <SectionBg kind="tide" />
  <div class="head rv" {@attach reveal}>
    <h2 id="how-title">{t("home.how.title")}</h2>
    <p>{t("home.how.lede")}</p>
  </div>
  <div class="story">
  <div class="rail" aria-hidden="true"><span></span></div>
  <ol class="steps">
    <li class="step rv" {@attach reveal} {@attach magnet}>
      <div class="ill add" aria-hidden="true" data-ambient {@attach ambient}>
        <svg viewBox="0 0 240 160" focusable="false"><path class="cap" d={CAP} pathLength="100" /></svg>
        <span class="floor"></span>
        <span class="sheet a"><Camera size={22} strokeWidth={1.75} /><i></i></span>
        <span class="sheet b"><Mic size={22} strokeWidth={1.75} /><i></i></span>
        <span class="sheet c"><Type size={22} strokeWidth={1.75} /><i></i></span>
      </div>
      <h3>{t("home.how.add.t")}</h3>
      <p>{t("home.how.add.p")}</p>
    </li>
    <li class="step rv" {@attach reveal} {@attach magnet}>
      <div class="ill seal" aria-hidden="true" data-ambient {@attach ambient}>
        <svg viewBox="0 0 240 160" focusable="false">
          <path class="cap" d={CAP} pathLength="100" />
          <path class="cap shut" d={CAP} pathLength="100" />
        </svg>
        <span class="floor"></span>
        <span class="txt plain">vacances.jpg</span>
        <span class="txt ciph">x9Qe+7bLr0/k</span>
        <span class="pad"><Lock size={14} strokeWidth={2.4} /></span>
      </div>
      <h3>{t("home.how.seal.t")}</h3>
      <p>{t("home.how.seal.p")}</p>
    </li>
    <li class="step rv" {@attach reveal} {@attach magnet}>
      <div class="ill go" aria-hidden="true" data-ambient {@attach ambient}>
        <svg viewBox="0 0 240 160" focusable="false"><path class="cap dots" d={CAP} pathLength="100" /></svg>
        <span class="floor"></span>
        <span class="chip link"><Link2 size={14} strokeWidth={2} />shhdrop.app/#…</span>
        <span class="chip key"><KeyRound size={14} strokeWidth={2} />••••••••</span>
        <span class="dust"><b></b><b></b><b></b><b></b><b></b><b></b></span>
      </div>
      <h3>{t("home.how.go.t")}</h3>
      <p>{t("home.how.go.p")}</p>
    </li>
  </ol>
  </div>
</section>

<style>
  .how {
    position: relative;
    isolation: isolate;
    padding-block-end: 120px;
    grid-template-columns: minmax(0, 1fr);
    display: grid;
    gap: var(--sp-7);
    padding-block-start: 120px;
    scroll-margin-top: 80px;
  }
  .head {
    display: grid;
    gap: var(--sp-3);
    max-width: 40rem;
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
  .head p,
  .step p {
    margin: 0;
    color: var(--text-2);
  }
  .head p {
    font-size: 1.125rem;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-7);
  }
  .story {
    position: relative;
    min-width: 0;
  }
  /* Carte en relief : bord dégradé qui accroche la lumière, lumière intérieure, reflet au pointeur. */
  .step {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    gap: var(--sp-3);
    align-content: start;
    min-width: 0;
    padding: 12px 12px 24px;
    border: 1px solid transparent;
    border-radius: 28px;
    background:
      linear-gradient(180deg, rgb(19 24 31 / 0.94), rgb(12 15 20 / 0.94)) padding-box,
      linear-gradient(180deg, rgb(233 236 242 / 0.18), rgb(233 236 242 / 0.03) 55%) border-box;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.06),
      0 30px 60px -36px rgb(0 0 0 / 0.95);
    transition: translate 520ms var(--ease-settle);
  }
  .step::before {
    content: "";
    position: absolute;
    z-index: -1;
    left: 0;
    top: 0;
    width: 360px;
    height: 360px;
    margin: -180px 0 0 -180px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.09), transparent);
    opacity: 0;
    transform: translate(var(--lx, 50%), var(--ly, 50%));
    transition: opacity var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .step:hover {
      translate: 0 -4px;
    }
    .step:hover::before {
      opacity: 1;
    }
  }
  .step h3,
  .step p {
    padding-inline: 12px;
  }
  /* Fil qui relie les trois gestes, tracé au défilement (scaleX, composé). */
  .rail {
    display: none;
  }
  .floor {
    left: 50%;
    bottom: 14%;
    width: 64%;
    height: 22%;
    margin-left: -32%;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.16), transparent);
  }
  .sheet i {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 9px;
    height: 3px;
    border-radius: 2px;
    background: rgb(233 236 242 / 0.18);
    box-shadow: 0 -6px 0 rgb(233 236 242 / 0.1);
  }
  h3 {
    margin-top: var(--sp-2);
    font-size: 1.375rem;
    font-weight: 620;
    font-stretch: 106%;
    letter-spacing: -0.01em;
  }

  /* Scène : verre statique, réglure fine, capsule du logo. */
  .ill {
    position: relative;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    border-radius: var(--r-xl);
    background:
      radial-gradient(70% 80% at 50% 62%, rgb(40 128 154 / 0.18), transparent 70%),
      radial-gradient(circle at 1px 1px, rgb(233 236 242 / 0.08) 1px, transparent 1.5px) 0 0 / 16px 16px,
      #0a0d12;
    box-shadow:
      inset 0 0 0 1px var(--hair),
      var(--edge-hi);
  }
  .ill svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
  }
  .cap {
    stroke: rgb(233 236 242 / 0.38);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 83.33 100;
  }
  .ill > span {
    position: absolute;
  }

  /* Ajoutez : trois feuillets tombent dans la capsule ouverte. */
  .sheet {
    left: 50%;
    top: 50%;
    width: 48px;
    height: 60px;
    margin: -30px 0 0 -24px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--surface-3);
    color: var(--text);
    box-shadow:
      0 0 0 1px var(--hair-2),
      var(--e-2);
    transform: translate(var(--x), 6px) rotate(var(--r));
  }
  .a {
    --x: -56px;
    --r: -10deg;
  }
  .b {
    --x: 0px;
    --r: 3deg;
  }
  .c {
    --x: 56px;
    --r: 12deg;
  }

  /* Scellez : le nom devient illisible, la capsule se referme, le cadenas apparaît. */
  .shut {
    stroke: var(--accent);
    stroke-dasharray: 100 100;
  }
  .txt {
    left: 0;
    right: 0;
    top: 50%;
    margin-top: -11px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    line-height: 22px;
  }
  .plain {
    color: var(--text);
    opacity: 0;
  }
  .ciph {
    color: var(--accent);
  }
  .pad {
    left: 50%;
    top: 18px;
    width: 26px;
    height: 26px;
    margin-left: -13px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
  }

  /* Partagez : le lien et le mot de passe partent par deux chemins, puis la capsule se défait. */
  .dots {
    stroke-dasharray: 1.2 2.2;
    stroke: rgb(233 236 242 / 0.4);
  }
  .chip {
    left: 50%;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--surface-3);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    white-space: nowrap;
    box-shadow: 0 0 0 1px var(--hair-2);
    transform: translateX(-50%);
  }
  .chip :global(svg) {
    color: var(--accent);
  }
  .link {
    top: 44px;
  }
  .key {
    top: 88px;
  }
  .dust {
    inset: 0;
  }
  .dust b {
    position: absolute;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text);
    opacity: 0;
  }
  .dust b:nth-child(1) { left: 22%; top: 30%; }
  .dust b:nth-child(2) { left: 40%; top: 78%; }
  .dust b:nth-child(3) { left: 60%; top: 22%; background: var(--accent); }
  .dust b:nth-child(4) { left: 78%; top: 64%; }
  .dust b:nth-child(5) { left: 30%; top: 60%; background: var(--accent); }
  .dust b:nth-child(6) { left: 70%; top: 40%; }

  @media (prefers-reduced-motion: no-preference) {
    .add .sheet {
      animation: fall 6s var(--ease-settle) infinite both;
    }
    .add .b {
      animation-delay: 0.15s;
    }
    .add .c {
      animation-delay: 0.3s;
    }
    .shut {
      animation: shut 6s var(--ease-in-out) infinite both;
    }
    .plain {
      animation: plain 6s linear infinite both;
    }
    .ciph {
      animation: ciph 6s linear infinite both;
    }
    .pad {
      animation: pad 6s var(--ease-settle) infinite both;
    }
    .dots {
      animation: fade 6s var(--ease-in-out) infinite both;
    }
    .link {
      animation: go 6s var(--ease-in-out) infinite both;
    }
    .key {
      animation: go 6s var(--ease-in-out) 0.25s infinite both;
    }
    .dust b {
      animation: dust 6s var(--ease-out) infinite both;
    }
    .dust b:nth-child(2) { animation-delay: 0.12s; }
    .dust b:nth-child(3) { animation-delay: 0.2s; }
    .dust b:nth-child(4) { animation-delay: 0.3s; }
    .dust b:nth-child(5) { animation-delay: 0.4s; }
    .dust b:nth-child(6) { animation-delay: 0.5s; }
    .ill:global(.still) * {
      animation-play-state: paused;
    }
    .step {
      transition: translate 520ms var(--ease-settle);
    }
  }
  @keyframes fall {
    0% { transform: translate(var(--x), -96px) rotate(0deg); opacity: 0; }
    14% { opacity: 1; }
    26%, 84% { transform: translate(var(--x), 6px) rotate(var(--r)); opacity: 1; }
    96%, 100% { transform: translate(var(--x), 6px) rotate(var(--r)); opacity: 0; }
  }
  @keyframes shut {
    0%, 20% { stroke-dasharray: 0 100; opacity: 1; }
    52%, 86% { stroke-dasharray: 100 100; opacity: 1; }
    100% { stroke-dasharray: 100 100; opacity: 0; }
  }
  @keyframes plain {
    0%, 30% { opacity: 1; filter: blur(0); }
    42%, 100% { opacity: 0; filter: blur(3px); }
  }
  @keyframes ciph {
    0%, 34% { opacity: 0; }
    46%, 88% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes pad {
    0%, 44% { opacity: 0; transform: scale(0.5); }
    56%, 86% { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(1); }
  }
  @keyframes fade {
    0%, 40% { opacity: 1; }
    70%, 85% { opacity: 0; }
    100% { opacity: 1; }
  }
  @keyframes go {
    0%, 18% { transform: translateX(-50%); opacity: 1; }
    42% { transform: translateX(60%); opacity: 0; }
    43%, 88% { transform: translateX(-50%); opacity: 0; }
    100% { transform: translateX(-50%); opacity: 1; }
  }
  @keyframes dust {
    0%, 44% { opacity: 0; transform: translateY(0); }
    52% { opacity: 0.9; }
    80%, 100% { opacity: 0; transform: translateY(-26px); }
  }

  @media (min-width: 720px) {
    .steps {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--sp-5);
    }
    .rail {
      display: block;
      position: absolute;
      z-index: -1;
      left: 16%;
      right: 16%;
      top: 34%;
      height: 2px;
      border-radius: 2px;
      background: var(--hair-2);
    }
    .rail span {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--seal-light));
      box-shadow: 0 0 12px var(--seal-halo);
      transform-origin: left;
      transform: scaleX(1);
    }
    @media (prefers-reduced-motion: no-preference) {
      @supports (animation-timeline: view()) {
        .rail span {
          animation: rail linear both;
          animation-timeline: view();
          animation-range: entry 60% cover 55%;
        }
        /* Les trois gestes entrent l'un après l'autre au fil du défilement. */
        .step:nth-child(2) {
          animation-range: entry 10% entry 90%;
        }
        .step:nth-child(3) {
          animation-range: entry 20% entry 100%;
        }
      }
    }
  }
  @keyframes rail {
    from {
      transform: scaleX(0);
    }
  }
  @media (min-width: 1024px) {
    .how {
      padding-block: 168px 150px;
    }
  }
  @media (forced-colors: active) {
    .ill {
      background: Canvas;
      border: 1px solid CanvasText;
    }
    .cap,
    .shut,
    .dots {
      stroke: CanvasText;
    }
    .sheet,
    .chip {
      border: 1px solid CanvasText;
      box-shadow: none;
    }
    .pad {
      background: Highlight;
      color: HighlightText;
    }
    .dust {
      display: none;
    }
  }
</style>
