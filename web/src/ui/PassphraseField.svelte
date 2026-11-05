<script lang="ts">
  // Mot de passe de l'envoi (UI §9.3, spec §31) : un seul champ, ses boutons dedans, en fin de
  // champ (« Générer un autre », « Copier », et Afficher/Masquer pour un mot de passe écrit).
  // Par défaut, 10 caractères générés sur l'appareil ; « Écrire mon propre mot de passe » sous
  // le champ ; « Générer un autre » rend un mot de passe généré. Attributs de UI §12.3, hors
  // de tout <form>. La copie lit l'état, jamais le DOM animé (K9).
  import { tick } from "svelte";
  import type { PwCheck } from "../index";
  import type { Options } from "../flows/options.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import { copyText } from "./clipboard";
  import { Check, Copy, Eye, EyeOff, RefreshCw } from "./Icon";
  import PasswordChecklist from "./PasswordChecklist.svelte";

  type Props = { options: Options; min: number; result: PwCheck | null; describedby?: string };
  let { options, min, result, describedby }: Props = $props();

  let generation = $state(0);
  let copied = $state(false);
  let masked = $state(false);
  let input: HTMLInputElement | undefined = $state();
  let ownBtn: HTMLButtonElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));
  const custom = $derived(options.mode === "custom");

  function regenerate() {
    options.useGenerated();
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
  async function own() {
    options.setCustom(options.custom);
    await tick();
    input?.focus();
  }
</script>

<div class="pf">
  {#if custom}<label class="fl" for="shh-own">{t("options.pw.field")}</label>{:else}<span class="sr-only">{t("options.pw.generated")}</span>{/if}
  <div class={["box", { custom }]}>
    {#if custom}
      <input
        bind:this={input}
        id="shh-own"
        name="shh-own"
        type="text"
        class={["in", "mono", { masked }]}
        value={options.custom}
        oninput={(e) => options.setCustom(e.currentTarget.value)}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        translate="no"
        enterkeyhint="done"
        aria-invalid={result !== null && !result.ok && options.custom !== "" ? "true" : undefined}
        aria-describedby={["pw-rules", describedby].filter(Boolean).join(" ")}
      />
      <button type="button" class="ib" title={masked ? t("options.pw.show") : t("options.pw.hide")} aria-label={masked ? t("options.pw.show") : t("options.pw.hide")} aria-pressed={masked} onclick={() => (masked = !masked)}>
        {#if masked}<Eye size={19} strokeWidth={1.9} aria-hidden="true" />{:else}<EyeOff size={19} strokeWidth={1.9} aria-hidden="true" />{/if}
      </button>
    {:else}
      <p class="val">
        <span class="sr-only" translate="no">{options.generated}</span>
        {#key generation}
          <span class="pw mono" aria-hidden="true" translate="no">
            {#each [...options.generated] as ch, i (i)}<span class="ch" style:--i={i}>{ch}</span>{/each}
          </span>
        {/key}
      </p>
    {/if}
    <button type="button" class="ib" title={t("options.pw.regenerate")} aria-label={t("options.pw.regenerate")} onclick={regenerate}>
      <RefreshCw size={19} strokeWidth={1.9} aria-hidden="true" />
    </button>
    <button type="button" class={["ib", { done: copied }]} title={copied ? t("common.copied") : t("common.copy")} aria-label={copied ? t("common.copied") : t("common.copy")} onclick={copy}>
      {#if copied}<Check size={19} strokeWidth={2.2} aria-hidden="true" />{:else}<Copy size={19} strokeWidth={1.9} aria-hidden="true" />{/if}
    </button>
  </div>
  {#if custom}
    <PasswordChecklist id="pw-rules" value={options.custom} {result} {min} />
    <button type="button" class="link" onclick={regenerate}>{t("options.pw.useGenerated")}</button>
  {:else}
    <div class="under">
      <span class="note">{t("options.pw.random")}</span>
      <button bind:this={ownBtn} type="button" class="link" onclick={own}>{t("options.pw.own")}</button>
    </div>
  {/if}
</div>

<style>
  .pf {
    display: grid;
    gap: 6px;
  }
  .fl {
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .box {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 60px;
    padding: 4px 6px 4px var(--sp-4);
    border-radius: 14px;
    background: rgb(5 7 10 / 0.5);
    box-shadow: inset 0 0 0 1px var(--hair-2);
  }
  .box.custom {
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px var(--line-strong);
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
  .in {
    flex: 1;
    min-width: 0;
    height: 50px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: max(1.0625rem, 16px);
    outline: none;
  }
  /* Masquer sans type="password" : aucun gestionnaire ne propose d'enregistrer (UI §12.3). */
  .in.masked {
    -webkit-text-security: disc;
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
  .under {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    column-gap: var(--sp-3);
  }
  .note {
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  .link {
    min-height: 44px;
    padding: 0 2px;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 560;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: rgb(95 227 181 / 0.45);
    cursor: pointer;
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
