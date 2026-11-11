<script lang="ts">
  // Cadenas d'état d'un élément (D41-25), icône maison : gris fermé (en cours, encore chiffré),
  // vert fermé avec coche (envoyé et confirmé), vert OUVERT (reçu, déchiffré et vérifié), rouge
  // avec « ! » (échec). Le texte n'est pas écrit sur la ligne (retours UI4) : il est le nom du
  // bouton et le contenu de sa bulle (Tip) ; la couleur n'est jamais la seule information (la
  // forme change aussi). Le vert n'arrive qu'à l'événement réel (lock.ts). `badge` (UI5) :
  // pastille posée sur le coin bas-droit de l'icône de format ; depuis UI6, son bouton ne couvre
  // que ce coin (24 px) : le reste de l'icône ouvre l'aperçu, l'autre coin porte « Téléchargé ».
  import type { Snippet } from "svelte";
  import type { LockTone } from "./lock";
  import Tip from "./Tip.svelte";

  // `detail` (D41-34, retours UI7) : 2ᵉ ligne de la bulle, l'état du nettoyage du fichier ; elle
  // entre aussi dans le nom du bouton (tout reste dans les libellés).
  type Props = { tone: LockTone; text: string; detail?: string; role?: "alert"; badge?: boolean; children?: Snippet };
  let { tone, text, detail, role, badge = false, children }: Props = $props();
  const label = $derived(detail ? `${text}. ${detail}` : text);
</script>

{#snippet glyph(px: number)}
  <svg viewBox="0 0 16 16" width={px} height={px} aria-hidden="true" focusable="false">
    {#if tone === "open"}
      <!-- Ouvert : l'anse pivote vers la gauche, hors du corps. -->
      <path class="sh" d="M5 7.2V5.1a3 3 0 0 1 5.6-1.5" />
    {:else}
      <path class="sh" d="M5 7.2V5.1a3 3 0 0 1 6 0v2.1" />
    {/if}
    <rect class="body" x="2.75" y="7" width="10.5" height="7.25" rx="2.2" />
    {#if tone === "ok" || tone === "open"}
      <path class="mark" d="M5.7 10.7l1.6 1.5 3-3.1" />
    {:else if tone === "error"}
      <path class="mark" d="M8 9.1v1.9" /><circle class="dot" cx="8" cy="12.65" r="0.85" />
    {:else}
      <circle class="dot" cx="8" cy="10.6" r="1.05" />
    {/if}
  </svg>
{/snippet}

{#if badge}
  <!-- Pastille (UI5, UI6) : posée au coin bas-droit de l'icône de format (parent en position
       relative) ; bouton de 24 px (WCAG 2.5.8), au-dessus du bouton d'aperçu. -->
  <span class={["lock", tone, "badge"]} data-lock={tone}>
    <Tip {label} tip={text} {detail} class="pic-tip" data-corner="">
      <span class="pill">{@render glyph(11)}</span>
    </Tip>
    {#if role === "alert"}<span class="sr-only" role="alert">{text}</span>{/if}
  </span>
{:else}
  <span class={["lock", tone]} data-lock={tone}>
    <Tip {label} tip={text} {detail}>{@render glyph(15)}</Tip>
    {#if role === "alert"}<span class="sr-only" role="alert">{text}</span>{/if}
    {@render children?.()}
  </span>
{/if}

<style>
  .lock {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-2);
  }
  svg {
    flex: none;
    overflow: visible;
  }
  .sh,
  .mark {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .body {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  .dot {
    fill: currentColor;
  }
  .ok,
  .open {
    color: var(--accent);
  }
  /* Pastille (UI5) : disque de la surface sous le cadenas, posé sur le coin bas-droit de
     l'icône ; le bouton entier (icône comprise) fait 44 px. */
  /* Bouton de 24 px centré sur la pastille (18 px), qui RENTRE dans le coin bas-droit de la
     feuille (retours UI8) : elle en mord le coin et s'en détache par une découpe de la couleur
     du fond (--cut) ; le libellé et le pictogramme de l'icône restent libres. */
  .lock.badge {
    position: absolute;
    z-index: 1;
    /* Bouton décalé vers l'extérieur, pastille ramenée vers l'intérieur (translate) : le centre de
       l'icône (bouton d'aperçu) reste libre. */
    inset-inline-end: -3px;
    inset-block-end: -4px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    color: inherit;
  }
  .badge :global(.pic-tip) {
    position: relative;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 0;
    width: 24px;
    height: 24px;
    min-inline-size: 24px;
    min-block-size: 24px;
    border-radius: 50%;
    color: inherit;
  }
  /* Cible d'appui de 44 px (audit M21) : le bouton de 24 px s'agrandit seulement vers
     l'extérieur de l'icône (droite, bas), jamais sur le bouton d'aperçu ; le dessin ne change pas. */
  .badge :global(.pic-tip)::after {
    content: "";
    position: absolute;
    inset: 0 -20px -20px 0;
  }
  .pill {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    translate: -3px -2px;
    background: var(--surface-2);
    box-shadow:
      0 0 0 2px var(--cut, rgb(15 17 24)),
      inset 0 0 0 1px var(--hair-2);
  }
  .badge.wait .pill {
    color: var(--text-2);
  }
  .badge.ok .pill,
  .badge.open .pill {
    color: var(--accent);
  }
  .badge.error .pill {
    color: var(--danger);
  }

  /* Plein : le cadenas fermé se lit d'un coup d'œil ; la marque se détache en creux. */
  .ok .body,
  .open .body,
  .error .body {
    fill: currentColor;
  }
  .ok .mark,
  .open .mark,
  .error .mark {
    stroke: var(--bg);
    stroke-width: 1.7;
  }
  .error .dot {
    fill: var(--bg);
  }
  @media (prefers-reduced-motion: no-preference) {
    /* Un seul moment : l'anse se referme et la coche se trace quand la confirmation arrive. */
    .ok .sh {
      animation: lock-close var(--dur-slow) var(--ease-out) both;
    }
    .open .sh {
      animation: lock-open var(--dur-slow) var(--ease-out) both;
    }
    .ok .mark,
    .open .mark {
      stroke-dasharray: 8;
      animation: lock-tick var(--dur-slow) var(--ease-out) 120ms both;
    }
  }
  @keyframes lock-close {
    from {
      transform: translateY(-1.6px);
    }
  }
  @keyframes lock-open {
    from {
      transform: translateY(1.2px);
    }
  }
  @keyframes lock-tick {
    from {
      stroke-dashoffset: 8;
    }
  }
  @media (forced-colors: active) {
    .lock {
      color: CanvasText;
    }
    .pill {
      background: Canvas;
      box-shadow: 0 0 0 2px Canvas, inset 0 0 0 1px CanvasText;
    }
    .ok .mark,
    .open .mark,
    .error .mark {
      stroke: Canvas;
    }
  }
</style>
