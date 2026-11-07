<script lang="ts">
  // Icône de format maison (listes du composeur et du destinataire) : une feuille à coin plié,
  // trait fin, avec l'étiquette du format (« PDF », « DOC », « ZIP »…) et, pour les images,
  // vidéos, sons, notes, archives et programmes, un petit pictogramme. Aucun logo de marque.
  // Décorative : le type est dit en texte dans la ligne (aria-hidden ici).
  import type { Format } from "./formats";

  type Props = { format: Format; size?: number };
  let { format, size = 28 }: Props = $props();
  const glyph = $derived(
    format.family === "image" || format.family === "video" || format.family === "audio" || format.family === "note" || format.family === "archive" || format.family === "exec"
      ? format.family
      : null,
  );
  const label = $derived(format.label);
  // Avec étiquette : pictogramme en haut ; sans : pictogramme centré.
  const gy = $derived(label ? 0 : 5);
</script>

<svg class={["fi", format.family]} viewBox="0 0 32 40" width={size} height={Math.round(size * 1.25)} aria-hidden="true" focusable="false" data-format={label || format.family}>
  <path class="pg" d="M6 1.5h14.5l8 8V36a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 36V4A2.5 2.5 0 0 1 6 1.5Z" />
  <path class="fd" d="M20.5 1.5V7a2.5 2.5 0 0 0 2.5 2.5h5.5" />
  <g class="gl" transform="translate(0 {gy})">
    {#if glyph === "image"}
      <path d="M9 23l4.5-5 3.5 3.5 2.5-2.5 3.5 4" />
      <circle cx="20" cy="14.5" r="1.6" />
    {:else if glyph === "video"}
      <path d="M13 13.5v9l7.5-4.5Z" />
    {:else if glyph === "audio"}
      <path d="M10 18v2M13 15.5v7M16 13v12M19 15.5v7M22 17.5v3" />
    {:else if glyph === "note"}
      <path d="M9.5 14h13M9.5 18h13M9.5 22h8" />
    {:else if glyph === "archive"}
      <path d="M16 9.5v2M16 13.5v2M16 17.5v2" />
      <rect x="13.8" y="20.5" width="4.4" height="4" rx="1" />
    {:else if glyph === "exec"}
      <path d="M10 15l3.5 3-3.5 3M15.5 22h6" />
    {/if}
  </g>
  {#if label}
    <text x="16" y={glyph ? 34 : 27} text-anchor="middle" class={["lb", label.length > 3 && "long"]}>{label}</text>
  {/if}
</svg>

<style>
  .fi {
    flex: none;
    display: block;
    overflow: visible;
  }
  .pg {
    fill: var(--surface-2);
    stroke: var(--line-strong);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
  .fd {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
  .gl {
    fill: none;
    stroke: var(--text-2);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .gl circle {
    fill: var(--text-2);
    stroke: none;
  }
  .video .gl path {
    fill: var(--text-2);
    stroke: none;
  }
  .lb {
    font-family: var(--font-sans);
    font-size: 8.5px;
    font-weight: 720;
    letter-spacing: 0.02em;
    fill: var(--text-2);
  }
  .lb.long {
    font-size: 7px;
  }
  /* Une teinte discrète par famille, sur l'étiquette seulement (jetons existants). */
  .pdf .lb,
  .exec .lb,
  .exec .gl {
    fill: var(--danger);
  }
  .exec .gl {
    fill: none;
    stroke: var(--danger);
  }
  .doc .lb,
  .text .lb,
  .book .lb {
    fill: var(--info);
  }
  .sheet .lb {
    fill: var(--accent);
  }
  .slides .lb,
  .archive .lb,
  .disk .lb {
    fill: var(--warn);
  }
  @media (forced-colors: active) {
    .pg,
    .fd,
    .gl {
      stroke: CanvasText;
    }
    .lb,
    .gl circle,
    .video .gl path {
      fill: CanvasText;
    }
  }
</style>
