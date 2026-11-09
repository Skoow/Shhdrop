<script lang="ts">
  // Rendu d'un glyphe maison (glyphs.ts) : décoratif par défaut (aria-hidden), le nom accessible
  // est porté par le bouton ou le texte voisin. Mêmes propriétés qu'avant (size, strokeWidth).
  import { GLYPHS, type GlyphName, type IconProps } from "./glyphs";

  let { name, size = 24, strokeWidth = 1.75, class: cls, ...rest }: IconProps & { name: GlyphName } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  class={["ic", `ic-${name}`, cls]}
  {...rest}
>
  {#each GLYPHS[name] as el, i (i)}
    {#if "d" in el}
      <path d={el.d} />
    {:else if "c" in el}
      <circle cx={el.c[0]} cy={el.c[1]} r={el.c[2]} fill={"dot" in el ? "currentColor" : undefined} stroke={"dot" in el ? "none" : undefined} />
    {:else}
      <rect x={el.r[0]} y={el.r[1]} width={el.r[2]} height={el.r[3]} rx={el.r[4]} />
    {/if}
  {/each}
</svg>
