<script lang="ts">
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

  // Un tic par seconde ; annonces aux seuils 1 h, 15 min, 5 min, 1 min et à l'expiration (UI §11).
  $effect(() => {
    const c = cd;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tickNow = () => {
      tickCount++;
      const at = c.announceAt();
      if (at === 0) announce(t("countdown.expired"));
      else if (at !== null) announce(t("countdown.at", { duration: formatDuration(c.remaining(), getLang(), { coarse: true }) }));
      if (c.remaining() === 0) {
        clearInterval(timer);
        onexpire?.();
      }
    };
    timer = setInterval(tickNow, 1000);
    if (c.remaining() === 0) tickNow();
    return () => clearInterval(timer);
  });
</script>

<span class="cd num">{text}</span>

<style>
  .cd {
    font-variant-numeric: tabular-nums;
  }
</style>
