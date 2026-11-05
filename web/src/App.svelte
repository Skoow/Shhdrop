<script lang="ts">
  import { router } from "./app/router.svelte";
  import NotFound from "./routes/NotFound.svelte";
  import AppShell from "./ui/AppShell.svelte";
</script>

<AppShell>
  {#if router.current.name === "notfound"}
    <NotFound />
  {:else}
    <!-- Écrans des tâches suivantes : accueil, ouverture, gestion, sécurité, confidentialité. -->
    <h1 tabindex="-1">Shhdrop</h1>
  {/if}
</AppShell>
