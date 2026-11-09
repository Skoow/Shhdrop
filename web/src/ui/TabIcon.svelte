<script lang="ts">
  // Icônes maison de la barre d'onglets (24 × 24, trait 1,8, retours UI7) ; Réglages reprend
  // l'engrenage de l'en-tête (GearIcon) : une seule icône pour une seule feuille.
  import type { TabId } from "../app/tabbar";
  import GearIcon from "./GearIcon.svelte";
  let { id, size = 22 }: { id: TabId; size?: number } = $props();
</script>

{#if id === "settings"}
  <GearIcon {size} />
{:else}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    {#if id === "send"}
      <path d="M20.5 3.5 3.5 10.4l6.9 3.2 3.2 6.9z" />
      <path d="m20.5 3.5-10.1 10.1" />
    {:else if id === "shares"}
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    {:else}
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v4a2.5 2.5 0 0 1-2.5 2.5H9.5L6 16v-3.1a2.5 2.5 0 0 1-2-2.4z" />
      <path d="M19 9a2.5 2.5 0 0 1 1 2v3.5a2.5 2.5 0 0 1-2 2.4V20l-3.5-3H12a2.5 2.5 0 0 1-2.2-1.3" />
    {/if}
  </svg>
{/if}
