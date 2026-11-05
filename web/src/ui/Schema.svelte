<script lang="ts">
  import { t } from "../i18n/i18n.svelte";
</script>

<!--
  UI §9.1 : le mécanisme en une ligne. Votre appareil — chiffré — serveur (ne voit rien) —
  chiffré — destinataire. Le trait menthe est tracé une fois (600 ms, immobile en mouvement
  réduit) ; il passe sous la capsule opaque du serveur : le serveur ne voit rien.
  Sans viewBox : les positions sont en % de la largeur et le texte garde sa taille réelle
  (rem), de 320 px à l'ordinateur. Le nom accessible est porté par aria-label (role="img" :
  les libellés visibles ne sont pas lus une seconde fois).
-->
<svg class="schema" role="img" aria-label={t("schema.label")} width="100%" height="96" overflow="visible">
  <line class="track" x1="16" y1="36" x2="100%" y2="36" />
  <line class="trace" x1="16" y1="36" x2="100%" y2="36" pathLength="100" />

  <text class="enc" x="25%" y="16" text-anchor="middle">{t("schema.encrypted")}</text>
  <text class="enc" x="75%" y="16" text-anchor="middle">{t("schema.encrypted")}</text>

  <!-- Votre appareil : le contenu (carré menthe) n'est en clair qu'ici. -->
  <rect class="device" x="0.75" y="22.75" width="15.5" height="26.5" rx="4" />
  <rect class="content" x="4" y="31" width="9" height="10" rx="2" />
  <text class="label" x="0" y="72">{t("schema.device")}</text>

  <!-- Serveur : capsule opaque, contenu masqué ; le trait passe dessous. -->
  <svg x="50%" overflow="visible">
    <rect class="box" x="-28" y="20" width="56" height="32" rx="16" />
    <circle class="mask" cx="-10" cy="36" r="2.5" />
    <circle class="mask" cx="0" cy="36" r="2.5" />
    <circle class="mask" cx="10" cy="36" r="2.5" />
    <text class="label strong" x="0" y="72" text-anchor="middle">{t("schema.server")}</text>
    <text class="label quiet" x="0" y="91" text-anchor="middle">{t("schema.blind")}</text>
  </svg>

  <!-- Destinataire : le trait y arrive, le contenu y redevient lisible. -->
  <svg x="100%" overflow="visible">
    <rect class="device" x="-15.75" y="22.75" width="15.5" height="26.5" rx="4" />
    <rect class="content arrive" x="-12" y="31" width="9" height="10" rx="2" />
    <text class="label" x="0" y="72" text-anchor="end">{t("schema.recipient")}</text>
  </svg>
</svg>

<style>
  .schema {
    display: block;
    width: 100%;
    height: 96px;
    margin-block-start: var(--sp-1);
    overflow: visible;
    font-family: var(--font-sans);
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
  .arrive {
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

  text {
    font-size: var(--fs-small);
    font-weight: var(--fw-small);
  }
  .enc {
    fill: var(--accent);
    font-size: var(--fs-micro);
    font-weight: var(--fw-micro);
  }
  .label {
    fill: var(--text-2);
  }
  .strong {
    fill: var(--text);
    font-weight: 560;
  }
  .quiet {
    fill: var(--text-3);
  }

  @media (prefers-reduced-motion: reduce) {
    .trace,
    .arrive {
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
    .box {
      stroke: CanvasText;
    }
    .box,
    .device {
      fill: Canvas;
    }
    .device {
      stroke: CanvasText;
    }
    .mask,
    .label {
      fill: CanvasText;
    }
    .trace {
      stroke: Highlight;
    }
    .content,
    .enc {
      fill: Highlight;
    }
  }
</style>
