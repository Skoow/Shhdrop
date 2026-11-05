<script lang="ts">
  import { untrack } from "svelte";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import { createCountdown } from "./countdown";

  type Props = {
    expiresInS: number;
    /** Horloge en ms (tests). */
    now?: () => number;
    /** Appelé une fois, à zéro. */
    onexpire?: () => void;
  };
  let { expiresInS, now, onexpire }: Props = $props();

  const cd = $derived(createCountdown(expiresInS, now));
  let tickCount = $state(0);
  const text = $derived((void tickCount, cd.display(getLang())));

  let fired = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  // Un tic par seconde ; annonces aux seuils 1 h, 15 min, 5 min, 1 min et à l'expiration (UI §11).
  // Appelée aussi au retour de l'onglet : les minuteurs dorment en arrière-plan.
  function tick() {
    const c = cd;
    tickCount++;
    const at = c.announceAt();
    if (at === 0) announce(t("countdown.expired"));
    else if (at !== null) announce(t("countdown.at", { duration: formatDuration(c.remaining(), getLang(), { coarse: true }) }));
    if (c.remaining() === 0) {
      clearInterval(timer);
      timer = undefined;
      if (!fired) {
        fired = true;
        onexpire?.();
      }
    }
  }

  $effect(() => {
    const c = cd; // seule dépendance suivie : un nouveau décompte relance tout
    untrack(() => {
      fired = false;
      timer = setInterval(tick, 1000);
      if (c.remaining() === 0) tick(); // déjà expiré à l'affichage : une fois, sans boucle d'effet
    });
    return () => {
      clearInterval(timer);
      timer = undefined;
    };
  });

  function visible() {
    if (document.visibilityState === "visible") tick();
  }
</script>

<svelte:document onvisibilitychange={visible} />

<span class="cd num">{text}</span>

<style>
  .cd {
    font-variant-numeric: tabular-nums;
  }
</style>
