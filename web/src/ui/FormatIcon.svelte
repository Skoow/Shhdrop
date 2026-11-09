<script lang="ts">
  // Icône de format maison (listes du composeur et du destinataire) : une feuille à coin plié,
  // trait fin, un petit pictogramme et une pastille de couleur avec le libellé du format,
  // toujours écrit (« PDF », « DOC », « ZIP », « IMG »…) : la couleur n'est jamais la seule
  // information (retours UI6). Couleurs : jetons --fmt-* (tokens.css). Aucun logo de marque.
  // Décorative : le type est dit en texte dans la ligne (aria-hidden ici).
  import { t } from "../i18n/i18n.svelte";
  import type { Family, Format } from "./formats";

  type Props = { format: Format; size?: number };
  let { format, size = 28 }: Props = $props();
  const glyph = $derived(
    format.family === "image" || format.family === "video" || format.family === "audio" || format.family === "note" || format.family === "archive" || format.family === "exec"
      ? format.family
      : null,
  );
  // Famille de couleur (neuf teintes) : Word et texte en bleu, archives et images disque en ambre.
  const TONE: Record<Family, string> = {
    pdf: "pdf",
    doc: "doc",
    text: "doc",
    book: "doc",
    note: "doc",
    sheet: "sheet",
    slides: "slides",
    archive: "archive",
    disk: "archive",
    image: "image",
    video: "video",
    audio: "audio",
    code: "other",
    exec: "other",
    font: "other",
    file: "other",
  };
  const label = $derived(format.label || t(`format.short.${format.family}`));
</script>

<svg class="fi" viewBox="0 0 32 40" width={size} height={Math.round(size * 1.25)} aria-hidden="true" focusable="false" data-format={format.label || format.family} data-tone={TONE[format.family]} style:--c="var(--fmt-{TONE[format.family]})">
  <path class="pg" d="M6 1.5h14.5l8 8V36a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 36V4A2.5 2.5 0 0 1 6 1.5Z" />
  <path class="fd" d="M20.5 1.5V7a2.5 2.5 0 0 0 2.5 2.5h5.5" />
  <!-- Pastille du libellé en haut (le cadenas occupe le coin bas-droit de l'icône dans les
       listes) ; elle déborde à gauche de la feuille, comme une étiquette. -->
  <rect class="tag" x="0.5" y="11" width="27" height="11" rx="3" />
  <text x="14" y="19.1" text-anchor="middle" class={["lb", label.length > 3 && "long"]}>{label}</text>
  <!-- Pictogramme en bas à gauche, hors du coin du cadenas ; sinon deux lignes de texte. -->
  <g class={["gl", glyph ?? "lines"]} transform="translate(12 29.5) scale(0.6) translate(-16 -17.5)">
    {#if glyph === "image"}
      <path d="M9 23l4.5-5 3.5 3.5 2.5-2.5 3.5 4" />
      <circle cx="20" cy="14.5" r="1.6" />
    {:else if glyph === "video"}
      <path class="solid" d="M13 13.5v9l7.5-4.5Z" />
    {:else if glyph === "audio"}
      <path d="M10 18v2M13 15.5v7M16 13v12M19 15.5v7M22 17.5v3" />
    {:else if glyph === "note"}
      <path d="M9.5 14h13M9.5 18h13M9.5 22h8" />
    {:else if glyph === "archive"}
      <path d="M16 9.5v2M16 13.5v2M16 17.5v2" />
      <rect x="13.8" y="20.5" width="4.4" height="4" rx="1" />
    {:else if glyph === "exec"}
      <path d="M10 15l3.5 3-3.5 3M15.5 22h6" />
    {:else}
      <path d="M9.5 14h13M9.5 18h13M9.5 22h8" />
    {/if}
  </g>
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
    stroke: var(--c);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .gl circle,
  .gl .solid {
    fill: var(--c);
    stroke: none;
  }
  .gl.lines {
    stroke: var(--text-3);
  }
  .tag {
    fill: var(--c);
  }
  .lb {
    font-family: var(--font-sans);
    font-size: 8px;
    font-weight: 760;
    letter-spacing: 0.02em;
    fill: var(--on-fmt);
  }
  .lb.long {
    font-size: 6.6px;
    letter-spacing: 0;
  }
  @media (forced-colors: active) {
    .pg,
    .fd,
    .gl {
      stroke: CanvasText;
    }
    .tag {
      fill: CanvasText;
    }
    .lb,
    .gl circle,
    .gl .solid {
      fill: Canvas;
    }
    .gl circle,
    .gl .solid {
      fill: CanvasText;
    }
  }
</style>
