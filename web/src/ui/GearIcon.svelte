<script lang="ts">
  // Engrenage maison (24 × 24, trait 1,75 comme le jeu Lucide de l'UI §6) : huit dents courtes
  // et arrondies, moyeu plein en petit point (le même détail « scellé » que les icônes d'ajout).
  let { size = 22 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path
    d="M10.4 3.2h3.2l.5 2.3 1.6.9 2.2-.8 1.6 2.8-1.7 1.6v1.9l1.7 1.6-1.6 2.8-2.2-.8-1.6.9-.5 2.3h-3.2l-.5-2.3-1.6-.9-2.2.8-1.6-2.8 1.7-1.6v-1.9L4.4 8.4 6 5.6l2.2.8 1.6-.9z"
  />
  <circle cx="12" cy="12" r="3" />
  <circle cx="12" cy="12" r="0.7" fill="currentColor" stroke="none" />
</svg>
