<script lang="ts">
  // Mot de passe de l'envoi (UI §9.3, spec §31) : toujours généré sur l'appareil, 10 caractères
  // (D41-15 : plus de mot de passe écrit à la main). Un seul champ, ses deux boutons dedans,
  // en fin de champ : « Générer un autre » et « Copier ». La copie lit l'état, jamais le DOM
  // animé (K9).
  import type { Options } from "../flows/options.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import { copyText } from "./clipboard";
  import { Check, Copy, RefreshCw } from "./Icon";

  type Props = { options: Options };
  let { options }: Props = $props();

  let generation = $state(0);
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));

  function regenerate() {
    options.regenerate();
    generation++;
    copied = false;
    announce(t("options.pw.regenerated"));
  }
  async function copy() {
    const r = await copyText(options.password);
    clearTimeout(timer);
    if (r === "copied") {
      copied = true;
      announce(t("copy.done", { label: t("options.pw.title") }));
      timer = setTimeout(() => (copied = false), 2000);
    } else announce(t("copy.manual"));
  }
</script>

<div class="pf">
  <span class="sr-only">{t("options.pw.generated")}</span>
  <div class="box">
    <p class="val">
      <span class="sr-only" translate="no">{options.password}</span>
      {#key generation}
        <span class="pw mono" aria-hidden="true" translate="no">
          {#each [...options.password] as ch, i (i)}<span class="ch" style:--i={i}>{ch}</span>{/each}
        </span>
      {/key}
    </p>
    <button type="button" class="ib" title={t("options.pw.regenerate")} aria-label={t("options.pw.regenerate")} onclick={regenerate}>
      <RefreshCw size={19} strokeWidth={1.9} aria-hidden="true" />
    </button>
    <button type="button" class={["ib", { done: copied }]} title={copied ? t("common.copied") : t("common.copy")} aria-label={copied ? t("common.copied") : t("common.copy")} onclick={copy}>
      {#if copied}<Check size={19} strokeWidth={2.2} aria-hidden="true" />{:else}<Copy size={19} strokeWidth={1.9} aria-hidden="true" />{/if}
    </button>
  </div>
  <span class="note">{t("options.pw.random")}</span>
</div>

<style>
  .pf {
    min-width: 0;
    display: grid;
    gap: 6px;
  }
  .box {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 60px;
    padding: 4px 6px 4px var(--sp-4);
    border-radius: 14px;
    background: rgb(5 7 10 / 0.5);
    box-shadow: inset 0 0 0 1px var(--hair-2);
  }
  .box:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .val {
    flex: 1;
    min-width: 0;
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .pw {
    display: flex;
    font-size: clamp(1.375rem, 1.1rem + 1.2vw, 1.75rem);
    font-weight: 560;
    letter-spacing: 0.06em;
    line-height: 1.2;
    color: var(--text);
    user-select: all;
  }
  .ch {
    display: inline-block;
  }
  @media (prefers-reduced-motion: no-preference) {
    .ch {
      animation: ch-in 340ms var(--ease-out) calc(var(--i) * 22ms) both;
    }
  }
  @keyframes ch-in {
    from {
      opacity: 0;
      transform: translateY(0.35em);
    }
  }
  /* Boutons dans le champ : 44 px de cible. */
  .ib {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .ib:active {
    transform: scale(0.9);
    background: rgb(255 255 255 / 0.08);
  }
  .ib.done {
    color: var(--accent);
  }
  @media (hover: hover) {
    .ib:hover {
      color: var(--text);
      background: rgb(255 255 255 / 0.07);
    }
    .ib:hover :global(.lucide-refresh-cw) {
      transform: rotate(90deg);
      transition: transform 420ms var(--ease-out);
    }
  }
  .note {
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  @media (prefers-reduced-motion: reduce) {
    .ib {
      transition: none;
    }
    .ib:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .box {
      border: 1px solid CanvasText;
    }
  }
</style>
