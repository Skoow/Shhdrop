<script lang="ts">
  // Icônes maison de la feuille « Ajouter » (24 × 24, trait 1,75 comme le jeu maison de l'UI §6).
  // Dessinées pour Shhgone : chaque glyphe porte un petit détail « scellé » (point, verrou).
  import type { AddId } from "../flows/add-actions";
  let { id, size = 24 }: { id: AddId | "gallery"; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  {#if id === "media"}
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.3-2h5.2l1.3 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.5" r="3.4" />
    <circle cx="17" cy="9" r="0.6" fill="currentColor" stroke="none" />
  {:else if id === "voice"}
    <path d="M4 12h1.5M8 8.5v7M11.5 5.5v13M15 9v6M18.5 11v2" />
    <circle cx="20.6" cy="12" r="0.6" fill="currentColor" stroke="none" />
  {:else if id === "note"}
    <path d="M6.5 3.5h8L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M14 3.5V8h5M8.5 12.5h7M8.5 16h4.5" />
  {:else if id === "gallery"}
    <rect x="3" y="7" width="14" height="13" rx="2.5" />
    <path d="M7 4h11.5A2.5 2.5 0 0 1 21 6.5V16" />
    <path d="m3.5 17.5 4-4 3 3 2-2 4 4" />
    <circle cx="12.5" cy="11" r="1.2" />
  {:else}
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <path d="M12 11v5M9.5 13.5 12 11l2.5 2.5" />
  {/if}
</svg>
