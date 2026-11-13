<script lang="ts">
  // Lumière d'ambiance (UI §20.4 « Ambiance ») : trois nappes de 128 px, agrandies par
  // transform: scale() (K11) et animées en transform seulement ; vignette et grain fixes.
  // États par body[data-screen] (opacité seulement, 1,2 s) : « seal » (scellement), « destroyed »
  // (aurore × 0,55) ; éclat de fermeture par body[data-burst]. Pause quand l'onglet est caché.
  // Plafond de luminance K5 (0,050 derrière le texte), mesuré par ui-e2e/aurora.spec.ts.
  // Images importées : Vite les écrit sous /assets/ avec une empreinte (cache d'un an, A7).
  import inkUrl from "../assets/aurora-ink.png";
  import tideUrl from "../assets/aurora-tide.png";
  import mintUrl from "../assets/aurora-mint.png";

  /** Échelles horizontale et verticale : une nappe couvre 150 × 95 vmax, comme le prototype. */
  function scales(): { x: number; y: number } {
    const vmax = Math.max(innerWidth, innerHeight) / 100;
    return { x: (150 * vmax) / 128, y: (95 * vmax) / 128 };
  }
  let k = $state(scales());
  let hidden = $state(document.hidden);
</script>

<svelte:window onresize={() => (k = scales())} />
<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<!-- Refonte du 12 novembre : nuit bleue sous l'aurore, et « la trame » (grille de petites
     croix, signature de Shhgone, comme les points du logo) : CSS pur, ni image ni data:. -->
<div class="night" aria-hidden="true"></div>
<div class={["aurora", { paused: hidden }]} aria-hidden="true" data-ambient style:--kx={k.x} style:--ky={k.y}>
  <img class="aur ink" src={inkUrl} alt="" width="128" height="128" decoding="async" />
  <img class="aur tide" src={tideUrl} alt="" width="128" height="128" decoding="async" />
  <img class="aur mint" src={mintUrl} alt="" width="128" height="128" decoding="async" />
  <img class="aur bloom" src={mintUrl} alt="" width="128" height="128" decoding="async" />
</div>
<div class="grain" aria-hidden="true"></div>
<div class="sides" aria-hidden="true" data-sides></div>
<div class="trame" aria-hidden="true" data-trame><i></i></div>

<style>
  .aurora {
    position: fixed;
    inset: 0;
    z-index: -2;
    overflow: hidden;
    pointer-events: none;
    contain: strict;
    view-transition-name: aurora;
    transition: opacity 1.2s var(--ease-in-out);
  }
  /* Vignette fixe : les bords retombent vers --bg-deep. */
  .aurora::after {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(130% 90% at 50% 10%, transparent 45%, var(--bg-deep) 100%);
  }

  /*
   * Image de 128 px centrée sur le centre de la nappe du prototype, agrandie par scale()
   * (jamais par width/height : K11). Ordre : agrandie, tournée, puis déplacée.
   */
  .aur {
    position: absolute;
    display: block;
    width: 128px;
    height: 128px;
    max-width: none;
    margin: -64px 0 0 -64px;
    transform-origin: 50% 50%;
    will-change: transform;
    backface-visibility: hidden;
    transition: opacity 1.2s var(--ease-in-out);
    animation-timing-function: var(--ease-in-out);
    animation-iteration-count: infinite;
    animation-direction: alternate;
  }
  .mint {
    top: -10.5vmax;
    left: 33vmax;
    opacity: var(--aur-mint-o);
    transform: translate3d(-4vmax, -2vmax, 0) rotate(-6deg) scale(var(--kx), var(--ky));
    animation-name: drift-a;
    animation-duration: var(--dur-ambient);
  }
  .tide {
    top: 1.5vmax;
    left: 81vmax;
    opacity: var(--aur-tide-o);
    transform: translate3d(6vmax, 0, 0) rotate(8deg) scale(calc(var(--kx) * 1.05), calc(var(--ky) * 1.05));
    animation-name: drift-b;
    animation-duration: var(--dur-ambient-2);
  }
  .ink {
    top: calc(34vh + 47.5vmax);
    left: 5vmax;
    opacity: var(--aur-ink-o);
    transform: scale(var(--kx), var(--ky));
    animation-name: drift-c;
    animation-duration: var(--dur-ambient-3);
  }
  /* Éclat de la fermeture du sceau (UI §20.4, K3) : opacité et échelle, une fois, jamais en boucle. */
  .bloom {
    top: 17.5vmax;
    left: 50vmax;
    opacity: 0;
    transform: scale(calc(var(--kx) * 0.7), calc(var(--ky) * 0.7));
    animation: none;
    will-change: auto;
  }
  @keyframes drift-a {
    from {
      transform: translate3d(-4vmax, -2vmax, 0) rotate(-6deg) scale(var(--kx), var(--ky));
    }
    to {
      transform: translate3d(14vmax, 5vmax, 0) rotate(7deg) scale(calc(var(--kx) * 1.14), calc(var(--ky) * 1.14));
    }
  }
  @keyframes drift-b {
    from {
      transform: translate3d(6vmax, 0, 0) rotate(8deg) scale(calc(var(--kx) * 1.05), calc(var(--ky) * 1.05));
    }
    to {
      transform: translate3d(-12vmax, 6vmax, 0) rotate(-5deg) scale(calc(var(--kx) * 0.92), calc(var(--ky) * 0.92));
    }
  }
  @keyframes drift-c {
    from {
      transform: translate3d(0, 0, 0) rotate(0deg) scale(var(--kx), var(--ky));
    }
    to {
      transform: translate3d(22vmax, -8vmax, 0) rotate(10deg) scale(calc(var(--kx) * 1.1), calc(var(--ky) * 1.1));
    }
  }
  /* Pic à 1 000 ms après le début de la fermeture (560 ms de délai + 27,5 % de 1 600 ms). Opacité
     du pic : 0,12 et non 0,55 (prototype), abaissée pour tenir le plafond K5 (K4, aurora.spec.ts). */
  @keyframes -global-aurora-burst {
    from {
      opacity: 0;
      transform: scale(calc(var(--kx) * 0.7), calc(var(--ky) * 0.7));
      animation-timing-function: var(--ease-out);
    }
    27.5% {
      opacity: 0.12;
      transform: scale(var(--kx), var(--ky));
      animation-timing-function: var(--ease-out);
    }
    to {
      opacity: 0;
      transform: scale(calc(var(--kx) * 1.15), calc(var(--ky) * 1.15));
    }
  }
  .paused .aur {
    animation-play-state: paused;
  }

  /* États par écran : opacité seulement. K4 : chaque état passe le test de luminance ; le
     scellement passe à 0,22 (et non 0,26 du prototype) pour que l'éclat tienne sous 0,050. */
  :global(body[data-screen="seal"]) .mint,
  :global(body[data-screen="seal"]) .tide {
    opacity: 0.22;
  }
  :global(body[data-screen="destroyed"]) .aurora {
    opacity: 0.55;
  }
  /* Posé à la fermeture du sceau (Task 17) : 560 → 2 160 ms après son début. */
  :global(body[data-burst]) .bloom {
    animation: aurora-burst 1600ms linear 560ms both;
  }

  .night {
    position: fixed;
    inset: 0;
    z-index: -3;
    pointer-events: none;
    background: linear-gradient(180deg, #070C1F 0%, #060A1A 45%, #05070F 100%);
  }
  /* Croix de 9 px tous les 32 px, en trois masques : le calque fond la grille vers le bas,
     <i> découpe un disque par case, <i>::before peint les deux traits d'un pixel (union : le
     centre n'est pas plus clair que les bras). Plafond K5 tenu, centre compris (aurora.spec.ts). */
  .trame,
  .trame i,
  .trame i::before {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }
  .trame {
    z-index: -1;
    -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.35), #000 260px, rgb(0 0 0 / 0.5) 65%, transparent);
    mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.35), #000 260px, rgb(0 0 0 / 0.5) 65%, transparent);
  }
  .trame i {
    -webkit-mask-image: radial-gradient(circle at center, #000 0 4.5px, transparent 5px);
    mask-image: radial-gradient(circle at center, #000 0 4.5px, transparent 5px);
    -webkit-mask-size: 32px 32px;
    mask-size: 32px 32px;
    -webkit-mask-position: center top;
    mask-position: center top;
  }
  .trame i::before {
    content: "";
    background: rgb(150 175 255 / 0.07);
    -webkit-mask-image:
      linear-gradient(90deg, transparent calc(50% - 0.5px), #000 calc(50% - 0.5px), #000 calc(50% + 0.5px), transparent calc(50% + 0.5px)),
      linear-gradient(0deg, transparent calc(50% - 0.5px), #000 calc(50% - 0.5px), #000 calc(50% + 0.5px), transparent calc(50% + 0.5px));
    mask-image:
      linear-gradient(90deg, transparent calc(50% - 0.5px), #000 calc(50% - 0.5px), #000 calc(50% + 0.5px), transparent calc(50% + 0.5px)),
      linear-gradient(0deg, transparent calc(50% - 0.5px), #000 calc(50% - 0.5px), #000 calc(50% + 0.5px), transparent calc(50% + 0.5px));
    -webkit-mask-size: 32px 32px;
    mask-size: 32px 32px;
    -webkit-mask-position: center top;
    mask-position: center top;
  }
  .grain {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image: url(../assets/grain.png);
    background-size: 128px;
    opacity: 0.035;
  }

  /* Papier peint maison sur les côtés (retours UI9) : les pictos de assets/motif.svg (fichier
     statique, CSP sans data:), masqués sur la colonne de contenu (≈ 800 px au centre) ; sur
     téléphone, à peine un voile vers les bords. Très faible contraste : le texte garde son AA. */
  .sides {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: url(../assets/motif.svg) 0 0 / 180px 180px repeat;
    /* Plafond K5 (luminance ≤ 0,050 des fonds, home.spec) : 0,024 (mesuré : 0,028 dépasse). */
    opacity: 0.024;
    --col: 400px;
    -webkit-mask-image: linear-gradient(to right, #000, #000 calc(50% - var(--col) - 160px), transparent calc(50% - var(--col)), transparent calc(50% + var(--col)), #000 calc(50% + var(--col) + 160px));
    mask-image: linear-gradient(to right, #000, #000 calc(50% - var(--col) - 160px), transparent calc(50% - var(--col)), transparent calc(50% + var(--col)), #000 calc(50% + var(--col) + 160px));
  }
  @media (max-width: 899px) {
    .sides {
      opacity: 0.014;
      -webkit-mask-image: linear-gradient(to right, #000, transparent 18%, transparent 82%, #000);
      mask-image: linear-gradient(to right, #000, transparent 18%, transparent 82%, #000);
    }
  }

  /* Mouvement réduit : nappes immobiles, sans éclat. */
  @media (prefers-reduced-motion: reduce) {
    .aur,
    :global(body[data-burst]) .bloom {
      animation: none;
    }
  }
  /* Contraste renforcé ou forcé : ni aurore ni grain (UI §20.7). */
  @media (prefers-contrast: more), (forced-colors: active) {
    .aurora,
    .grain,
    .sides,
    .trame {
      display: none;
    }
  }
</style>
