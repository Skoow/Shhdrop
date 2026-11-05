<script lang="ts">
  import { onAnnounce } from "./announce";

  // Une seule région polie par page (UI §8, §11). Vidée puis remplie : un texte identique
  // à la précédente annonce est quand même lu.
  let message = $state("");

  $effect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onAnnounce((text) => {
      message = "";
      clearTimeout(timer);
      timer = setTimeout(() => (message = text), 50);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  });
</script>

<div class="live" role="status" aria-live="polite" aria-atomic="true">{message}</div>

<style>
  .live {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
</style>
