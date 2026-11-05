<script lang="ts">
  // Le trajet d'un partage (UI §9.1, §20.11) : sur votre appareil, le texte se condense en une
  // capsule scellée ; la capsule traverse le serveur, un coffre opaque dont l'intérieur n'est que
  // du bruit ; chez le destinataire, elle se rouvre en texte lisible. La clé fait le trajet à part,
  // par un chemin en pointillés qui contourne le serveur (le « # » du lien) : l'idée à retenir.
  // Dessin fixe en SVG ; tout ce qui bouge est en HTML, en transform et opacity seulement (unités
  // cqw du cadre), boucle de 8 s rangée dans l'ambiance (pause hors écran et onglet caché). Mouvement
  // réduit : image fixe à mi-parcours. Le sens est porté par role="img" + aria-label ; les libellés
  // visibles sont en HTML, cachés aux lecteurs d'écran.
  import { t } from "../i18n/i18n.svelte";
  import { ambient } from "./attach";
  import { KeyRound, Lock } from "./Icon";
</script>

<div class="schema">
  <div class="stage" role="img" aria-label={t("schema.label")} data-ambient {@attach ambient}>
    <svg class="art" viewBox="0 0 1000 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sch-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#232937" />
          <stop offset="1" stop-color="#151922" />
        </linearGradient>
        <linearGradient id="sch-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0d1218" />
          <stop offset="1" stop-color="#090c11" />
        </linearGradient>
      </defs>
      <!-- Chemins : la capsule passe par le serveur ; la clé le contourne, en pointillés. -->
      <path class="road" d="M232 104 C 290 60, 350 60, 404 104" />
      <path class="road" d="M596 104 C 650 60, 712 60, 812 104" />
      <path class="keyway" d="M140 196 C 260 300, 740 300, 868 214" />

      <!-- Votre appareil : ordinateur portable. -->
      <g class="device">
        <rect x="44" y="36" width="188" height="128" rx="12" fill="url(#sch-metal)" />
        <rect x="54" y="46" width="168" height="108" rx="6" fill="url(#sch-screen)" />
        <path d="M24 170 H252 L240 184 H36 Z" fill="url(#sch-metal)" />
        <rect x="116" y="170" width="44" height="5" rx="2.5" fill="#0b0e13" />
      </g>

      <!-- Serveur : un coffre opaque, cadran à droite. -->
      <g class="vault">
        <rect x="404" y="26" width="192" height="156" rx="24" fill="url(#sch-metal)" />
        <rect x="418" y="40" width="164" height="128" rx="16" fill="#0a0d12" />
        <g class="wheel">
          <circle cx="0" cy="0" r="16" />
          <path d="M0 -16 V16 M-16 0 H16 M-11.3 -11.3 L11.3 11.3 M-11.3 11.3 L11.3 -11.3" />
          <circle cx="0" cy="0" r="5" class="hub" />
        </g>
        <rect x="404" y="182" width="192" height="8" rx="4" fill="#0e1117" />
      </g>

      <!-- Destinataire : téléphone. -->
      <g class="device">
        <rect x="812" y="20" width="112" height="184" rx="22" fill="url(#sch-metal)" />
        <rect x="822" y="30" width="92" height="164" rx="14" fill="url(#sch-screen)" />
        <rect x="852" y="36" width="32" height="6" rx="3" fill="#151922" />
      </g>
    </svg>

    <!-- Texte en clair à l'écran de l'expéditeur, qui se condense. -->
    <span class="lines from" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <!-- Bruit à l'intérieur du coffre : le serveur ne garde que de l'illisible. -->
    <span class="noise" aria-hidden="true"><span></span></span>
    <!-- Texte rendu lisible chez le destinataire. -->
    <span class="lines to" aria-hidden="true"><i></i><i></i><i></i><i></i></span>

    <span class="packet" aria-hidden="true"><Lock size={14} strokeWidth={2.4} /></span>
    <span class="key" aria-hidden="true"><KeyRound size={14} strokeWidth={2.2} /><b>#</b></span>
  </div>

  <div class="labels" aria-hidden="true">
    <span class="lab"><span data-label class="name">{t("schema.device")}</span><span data-label class="state">{t("schema.encrypted")}</span></span>
    <span class="lab"><span data-label class="name">{t("schema.server")}</span><span data-label class="state dim">{t("schema.blind")}</span></span>
    <span class="lab"><span data-label class="name">{t("schema.recipient")}</span><span data-label class="state">{t("schema.decrypted")}</span></span>
  </div>
  <p class="keynote" aria-hidden="true"><span class="dash"></span><span data-label>{t("schema.key")}</span></p>
</div>

<style>
  .schema {
    container-type: inline-size;
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
    font-size: var(--fs-small);
    line-height: var(--lh-small);
  }

  /* Scène : 1000 × 300 unités ; 1 unité = 0,1cqw. */
  .stage {
    position: relative;
    aspect-ratio: 10 / 3;
    overflow: clip;
  }
  .art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .road {
    fill: none;
    stroke: rgb(95 227 181 / 0.32);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .keyway {
    fill: none;
    stroke: rgb(242 196 109 / 0.5);
    stroke-width: 2;
    stroke-dasharray: 2 9;
    stroke-linecap: round;
  }
  .wheel {
    transform: translate(560px, 104px);
    fill: none;
    stroke: #3a4253;
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .hub {
    fill: #1a1f2a;
  }
  .device rect:first-child,
  .vault rect:first-child {
    stroke: rgb(233 236 242 / 0.12);
    stroke-width: 1.5;
  }

  /* Lignes de texte des écrans (HTML, au-dessus du dessin). */
  .lines {
    position: absolute;
    display: grid;
    align-content: center;
    gap: 1.1cqw;
  }
  .from {
    left: 7.4cqw;
    top: 6.8cqw;
    width: 13cqw;
    height: 8cqw;
  }
  .to {
    left: 83.6cqw;
    top: 5.4cqw;
    width: 7.2cqw;
    height: 12cqw;
  }
  .lines i {
    display: block;
    height: 0.9cqw;
    border-radius: 1cqw;
    background: rgb(233 236 242 / 0.7);
    transform-origin: left;
  }
  .lines i:nth-child(2) {
    width: 80%;
  }
  .lines i:nth-child(3) {
    width: 92%;
  }
  .lines i:nth-child(4) {
    width: 55%;
  }

  /* Intérieur du coffre : grain de chiffré qui défile, jamais le contenu. */
  .noise {
    position: absolute;
    left: 42.8cqw;
    top: 4.4cqw;
    width: 13.4cqw;
    height: 12.4cqw;
    overflow: clip;
    border-radius: 1.4cqw;
  }
  .noise span {
    position: absolute;
    inset: -50% 0 0;
    background-image:
      radial-gradient(circle at 1px 1px, rgb(95 227 181 / 0.55) 1px, transparent 1.6px),
      radial-gradient(circle at 1px 1px, rgb(233 236 242 / 0.25) 1px, transparent 1.6px);
    background-size: 7px 9px, 11px 6px;
    background-position: 0 0, 3px 2px;
    opacity: 0.35;
  }

  /* Capsule scellée et clé : position de l'image fixe (mouvement réduit) = mi-parcours. */
  .packet,
  .key {
    position: absolute;
    left: 0;
    top: 0;
    display: grid;
    place-items: center;
  }
  .packet {
    width: 6.4cqw;
    height: 3.6cqw;
    margin: -1.8cqw 0 0 -3.2cqw;
    border-radius: 2cqw;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow:
      0 0 0 0.5cqw rgb(95 227 181 / 0.14),
      0 0.8cqw 1.6cqw -0.6cqw rgb(0 0 0 / 0.9);
    transform: translate(31.8cqw, 7.2cqw);
  }
  .key {
    grid-auto-flow: column;
    gap: 0.4cqw;
    height: 3.2cqw;
    padding: 0 1cqw;
    margin: -1.6cqw 0 0 -3cqw;
    border-radius: 1.6cqw;
    background: var(--warn-tint);
    color: var(--warn);
    box-shadow: inset 0 0 0 1px rgb(242 196 109 / 0.4);
    transform: translate(50cqw, 27.4cqw);
  }
  .key b {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: max(10px, 1.4cqw);
  }
  .packet :global(svg),
  .key :global(svg) {
    width: max(11px, 1.6cqw);
    height: max(11px, 1.6cqw);
  }

  @media (prefers-reduced-motion: no-preference) {
    .packet {
      animation: travel 8s var(--ease-in-out) infinite both;
    }
    .key {
      animation: key 8s var(--ease-in-out) infinite both;
    }
    .from i {
      animation: condense 8s var(--ease-in-out) infinite both;
    }
    .to i {
      animation: unseal 8s var(--ease-out) infinite both;
    }
    .from i:nth-child(2),
    .to i:nth-child(2) {
      animation-delay: 60ms;
    }
    .from i:nth-child(3),
    .to i:nth-child(3) {
      animation-delay: 120ms;
    }
    .from i:nth-child(4),
    .to i:nth-child(4) {
      animation-delay: 180ms;
    }
    .noise span {
      animation: churn 8s linear infinite both;
    }
    .stage:global(.still) * {
      animation-play-state: paused;
    }
  }
  /* 0–14 % le texte se condense et la capsule naît ; 14–40 % vers le coffre ; 40–52 % dedans
     (cachée) ; 52–78 % vers le téléphone ; 78–88 % la capsule s'ouvre ; 88–100 % repos. */
  @keyframes travel {
    0%,
    6% {
      transform: translate(18cqw, 10cqw) scale(0.3);
      opacity: 0;
    }
    14% {
      transform: translate(23.6cqw, 10cqw) scale(1);
      opacity: 1;
    }
    27% {
      transform: translate(31.8cqw, 7.2cqw) scale(1);
    }
    38% {
      transform: translate(40cqw, 10cqw) scale(1);
      opacity: 1;
    }
    42%,
    50% {
      transform: translate(50cqw, 10cqw) scale(0.85);
      opacity: 0;
    }
    54% {
      transform: translate(59.6cqw, 10cqw) scale(1);
      opacity: 1;
    }
    66% {
      transform: translate(70.4cqw, 7.2cqw) scale(1);
    }
    78% {
      transform: translate(80.8cqw, 10cqw) scale(1);
      opacity: 1;
    }
    86%,
    100% {
      transform: translate(86.8cqw, 10cqw) scale(1.4);
      opacity: 0;
    }
  }
  @keyframes key {
    0%,
    10% {
      transform: translate(14cqw, 19.6cqw);
      opacity: 0;
    }
    16% {
      opacity: 1;
    }
    30% {
      transform: translate(30cqw, 25.6cqw);
    }
    46% {
      transform: translate(50cqw, 27.4cqw);
    }
    62% {
      transform: translate(70cqw, 25.6cqw);
    }
    78% {
      transform: translate(86.8cqw, 21.4cqw);
      opacity: 1;
    }
    86%,
    100% {
      transform: translate(86.8cqw, 15cqw) scale(0.6);
      opacity: 0;
    }
  }
  @keyframes condense {
    0%,
    4% {
      transform: scaleX(1);
      opacity: 1;
    }
    13% {
      transform: scaleX(0.08);
      opacity: 0;
    }
    90% {
      transform: scaleX(0.08);
      opacity: 0;
    }
    100% {
      transform: scaleX(1);
      opacity: 1;
    }
  }
  @keyframes unseal {
    0%,
    80% {
      transform: scaleX(0);
      opacity: 0;
    }
    90%,
    96% {
      transform: scaleX(1);
      opacity: 1;
    }
    100% {
      transform: scaleX(1);
      opacity: 0;
    }
  }
  @keyframes churn {
    0%,
    38% {
      transform: translateY(0);
      opacity: 0.35;
    }
    46% {
      opacity: 1;
    }
    56%,
    100% {
      transform: translateY(33%);
      opacity: 0.35;
    }
  }

  /* Libellés : trois colonnes centrées sous les trois objets (13 %, 50 %, 87 %). */
  .labels {
    display: grid;
    grid-template-columns: 26fr 48fr 26fr;
    gap: var(--sp-2);
    text-align: center;
  }
  .lab {
    display: grid;
    justify-items: center;
    min-width: 0;
  }
  [data-label] {
    min-width: 0;
    overflow-wrap: break-word;
  }
  .name {
    color: var(--text);
    font-weight: 560;
  }
  .state {
    color: var(--accent);
    font-size: var(--fs-micro);
    font-weight: var(--fw-micro);
  }
  .state.dim {
    color: var(--text-2);
  }
  .keynote {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    max-width: none;
    margin: 0;
    color: var(--warn);
    font-size: var(--fs-micro);
    font-weight: var(--fw-micro);
    text-align: center;
  }
  .dash {
    flex: none;
    width: 28px;
    height: 2px;
    background: repeating-linear-gradient(90deg, rgb(242 196 109 / 0.7) 0 3px, transparent 3px 8px);
  }

  /* Téléphone : libellés plus petits, sur une ligne quand c'est possible. */
  @container (max-width: 30rem) {
    .name {
      font-size: var(--fs-micro);
      line-height: var(--lh-micro);
    }
  }
  /* Texte agrandi : les libellés passent en liste, dans l'ordre du trajet. */
  @container (max-width: 17.5rem) {
    .labels {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--sp-1);
      text-align: start;
    }
    .lab {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 0.4em;
    }
  }

  @media (forced-colors: active) {
    .road,
    .keyway {
      stroke: CanvasText;
    }
    .packet {
      background: Highlight;
      color: HighlightText;
      box-shadow: none;
    }
    .key {
      background: Canvas;
      color: CanvasText;
      border: 1px solid CanvasText;
    }
    .lines i {
      background: CanvasText;
    }
    .noise {
      display: none;
    }
  }
</style>
