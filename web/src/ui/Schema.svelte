<script module lang="ts">
  // UI §9.1 : le trait est tracé une fois par chargement de page, pas à chaque retour sur l'accueil.
  let played = false;
</script>

<script lang="ts">
  import { t } from "../i18n/i18n.svelte";

  const draw = !played;
  played = true;
</script>

<!--
  UI §9.1 : le mécanisme en une ligne. Votre appareil — chiffré — serveur (ne lit rien) —
  chiffré — destinataire. Le trait menthe passe sous la capsule opaque du serveur.
  Le SVG ne porte que le dessin et le nom accessible (role="img", aria-label). Les libellés
  visibles sont en HTML, en unités relatives : ils grandissent avec la taille de texte et
  passent à la ligne au lieu de se chevaucher (WCAG 1.4.4). Ils sont cachés aux lecteurs
  d'écran, qui lisent l'aria-label.
-->
<div class="schema">
  <div class="enc" aria-hidden="true">
    <span data-label>{t("schema.encrypted")}</span>
    <span data-label>{t("schema.encrypted")}</span>
  </div>

  <svg class={["drawing", draw && "draw"]} role="img" aria-label={t("schema.label")} width="100%" height="32" overflow="visible">
    <line class="track" x1="16" y1="16" x2="100%" y2="16" />
    <line class="trace" x1="16" y1="16" x2="100%" y2="16" pathLength="100" />

    <!-- Votre appareil : le contenu (carré menthe) n'est en clair qu'ici. -->
    <rect class="device" x="0.75" y="2.75" width="15.5" height="26.5" rx="4" />
    <rect class="content" x="4" y="11" width="9" height="10" rx="2" />

    <!-- Serveur : capsule opaque, contenu masqué ; le trait passe dessous. -->
    <svg x="50%" overflow="visible">
      <rect class="box" x="-28" y="0" width="56" height="32" rx="16" />
      <circle class="mask" cx="-10" cy="16" r="2.5" />
      <circle class="mask" cx="0" cy="16" r="2.5" />
      <circle class="mask" cx="10" cy="16" r="2.5" />
    </svg>

    <!-- Destinataire : le trait y arrive, le contenu y redevient lisible. -->
    <svg x="100%" overflow="visible">
      <rect class="device" x="-15.75" y="2.75" width="15.5" height="26.5" rx="4" />
      <rect class="content arrive" x="-12" y="11" width="9" height="10" rx="2" />
    </svg>
  </svg>

  <div class="nodes" aria-hidden="true">
    <span class="node start"><span data-label>{t("schema.device")}</span></span>
    <span class="node mid">
      <span data-label class="strong">{t("schema.server")}</span>
      <span data-label class="quiet">{t("schema.blind")}</span>
    </span>
    <span class="node end"><span data-label>{t("schema.recipient")}</span></span>
  </div>
</div>

<style>
  .schema {
    container-type: inline-size;
    display: grid;
    gap: var(--sp-2);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    font-weight: var(--fw-small);
  }

  [data-label] {
    overflow-wrap: anywhere;
    hyphens: auto;
  }

  /* « chiffré » centré au-dessus de chaque moitié du trait (25 % et 75 %). */
  .enc {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-items: center;
    text-align: center;
    color: var(--accent);
    font-size: var(--fs-micro);
    line-height: var(--lh-micro);
    font-weight: var(--fw-micro);
  }

  /* Sous les trois nœuds : début, milieu, fin. Colonnes latérales égales : le milieu est centré. */
  .nodes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: var(--sp-2);
    color: var(--text-2);
  }
  .node {
    min-width: 0;
  }
  .end {
    text-align: end;
  }
  .mid {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .strong {
    color: var(--text);
    font-weight: 560;
  }
  .quiet {
    color: var(--text-3);
  }

  /* Texte agrandi (ou écran très étroit) : les libellés passent en liste, dans l'ordre du trait. */
  @container (max-width: 17.5rem) {
    .nodes {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--sp-1);
    }
    .end {
      text-align: start;
    }
    .mid {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 0.4em;
      text-align: start;
    }
  }

  .drawing {
    display: block;
    width: 100%;
    height: 32px;
    overflow: visible;
  }

  .track {
    stroke: var(--line);
    stroke-width: 1.5;
  }
  .trace {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 100;
    stroke-dashoffset: 0;
  }
  .draw .trace {
    animation: draw 600ms var(--ease-out) both;
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 100;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  .device {
    fill: var(--bg);
    stroke: var(--text-2);
    stroke-width: 1.5;
  }
  .content {
    fill: var(--accent);
  }
  .draw .arrive {
    transform-box: fill-box;
    transform-origin: center;
    animation: arrive var(--dur-fast) var(--ease-out) 540ms both;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
  }

  .box {
    fill: var(--surface-2);
    stroke: var(--line-strong);
    stroke-width: 1.5;
  }
  .mask {
    fill: var(--text-3);
  }

  @media (prefers-reduced-motion: reduce) {
    .draw .trace,
    .draw .arrive {
      animation: none;
    }
  }
  @media (prefers-contrast: more) {
    .track {
      stroke: var(--line-strong);
    }
  }
  @media (forced-colors: active) {
    .track,
    .box,
    .device {
      stroke: CanvasText;
    }
    .box,
    .device {
      fill: Canvas;
    }
    .mask {
      fill: CanvasText;
    }
    .trace {
      stroke: Highlight;
    }
    .content {
      fill: Highlight;
    }
  }
</style>
