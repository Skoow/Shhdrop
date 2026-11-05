<script lang="ts">
  // Mot de passe de l'envoi (UI §9.3, spec §31) : 8 caractères générés sur l'appareil, en grand
  // et en chasse fixe ; « Générer un autre » sans limite ; « Copier » ; ou un mot de passe écrit
  // soi-même, contrôlé en direct. Attributs de saisie de UI §12.3, hors de tout <form>.
  // La copie lit l'état, jamais le DOM animé (K9).
  import { tick } from "svelte";
  import type { PwCheck } from "../index";
  import type { Options } from "../flows/options.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import { copyText } from "./clipboard";
  import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw } from "./Icon";
  import PasswordChecklist from "./PasswordChecklist.svelte";

  type Props = { options: Options; min: number; result: PwCheck | null; describedby?: string };
  let { options, min, result, describedby }: Props = $props();

  let generation = $state(0);
  let copied = $state(false);
  let manual = $state(false);
  let masked = $state(false);
  let input: HTMLInputElement | undefined = $state();
  let ownBtn: HTMLButtonElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));

  function regenerate() {
    options.regenerate();
    generation++;
    copied = false;
    manual = false;
    announce(t("options.pw.regenerated"));
  }
  async function copy() {
    const r = await copyText(options.password);
    clearTimeout(timer);
    if (r === "copied") {
      copied = true;
      manual = false;
      announce(t("copy.done", { label: t("options.pw.title") }));
      timer = setTimeout(() => (copied = false), 2000);
    } else {
      manual = true;
      announce(t("copy.manual"));
    }
  }
  async function own() {
    options.setCustom(options.custom);
    await tick();
    input?.focus();
  }
  async function useGenerated() {
    options.useGenerated();
    await tick();
    ownBtn?.focus();
  }
</script>

<div class="pf">
  {#if options.mode === "generated"}
    <div class="gen">
      <span class="gl"><KeyRound size={16} strokeWidth={1.9} aria-hidden="true" />{t("options.pw.generated")}</span>
      <p class="pw-wrap">
        <span class="sr-only" translate="no">{options.generated}</span>
        {#key generation}
          <span class={["pw", "mono", { manual }]} aria-hidden="true" translate="no">
            {#each [...options.generated] as ch, i (i)}<span class="ch" style:--i={i}>{ch}</span>{/each}
          </span>
        {/key}
      </p>
      <div class="acts">
        <button type="button" class="act" onclick={regenerate}>
          <RefreshCw size={18} strokeWidth={1.9} aria-hidden="true" /><span>{t("options.pw.regenerate")}</span>
        </button>
        <button type="button" class={["act", { done: copied }]} onclick={copy}>
          {#if copied}<Check size={18} strokeWidth={2.2} aria-hidden="true" /><span>{t("common.copied")}</span>
          {:else}<Copy size={18} strokeWidth={1.9} aria-hidden="true" /><span>{t("common.copy")}</span>{/if}
        </button>
      </div>
      <p class="note">{t("options.pw.random")}</p>
    </div>
    <button bind:this={ownBtn} type="button" class="link" onclick={own}>{t("options.pw.own")}</button>
  {:else}
    <div class="own">
      <label for="shh-own" class="fl">{t("options.pw.field")}</label>
      <span class="field">
        <input
          bind:this={input}
          id="shh-own"
          name="shh-own"
          type="text"
          class={["mono", { masked }]}
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
        <button type="button" class="eye" aria-pressed={masked} aria-label={masked ? t("options.pw.show") : t("options.pw.hide")} onclick={() => (masked = !masked)}>
          {#if masked}<Eye size={18} strokeWidth={1.9} aria-hidden="true" />{:else}<EyeOff size={18} strokeWidth={1.9} aria-hidden="true" />{/if}
        </button>
      </span>
      <PasswordChecklist id="pw-rules" value={options.custom} {result} {min} />
      {#if options.custom !== ""}
        <button type="button" class={["act", "copy-own", { done: copied }]} onclick={copy}>
          {#if copied}<Check size={18} strokeWidth={2.2} aria-hidden="true" /><span>{t("common.copied")}</span>
          {:else}<Copy size={18} strokeWidth={1.9} aria-hidden="true" /><span>{t("common.copy")}</span>{/if}
        </button>
      {/if}
    </div>
    <button type="button" class="link" onclick={useGenerated}>{t("options.pw.useGenerated")}</button>
  {/if}
</div>

<style>
  .pf {
    display: grid;
    gap: var(--sp-2);
  }
  .gen {
    display: grid;
    gap: var(--sp-3);
    padding: var(--sp-4);
    border-radius: 18px;
    background: rgb(5 7 10 / 0.42);
    box-shadow: inset 0 0 0 1px var(--hair-2);
  }
  .gl {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .gl :global(svg) {
    color: var(--accent);
  }
  .pw-wrap {
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .pw {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    font-size: clamp(1.75rem, 1.2rem + 2vw, 2.25rem);
    font-weight: 560;
    letter-spacing: 0.04em;
    line-height: 1.15;
    color: var(--text);
    user-select: all;
  }
  .ch {
    display: inline-block;
    min-width: 0.62em;
    text-align: center;
  }
  /* Régénérer : les caractères montent et se posent, décalés (520 ms en tout, K9). */
  @media (prefers-reduced-motion: no-preference) {
    .ch {
      animation: ch-in 360ms var(--ease-out) calc(var(--i) * 22ms) both;
    }
  }
  @keyframes ch-in {
    from {
      opacity: 0;
      transform: translateY(0.35em);
    }
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--hair-2);
    border-radius: 10px;
    background: rgb(255 255 255 / 0.045);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 560;
    cursor: pointer;
    touch-action: manipulation;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .act:active {
    transform: scale(0.97);
  }
  .act :global(svg) {
    flex: none;
  }
  .act.done {
    color: var(--accent);
    border-color: rgb(95 227 181 / 0.35);
  }
  @media (hover: hover) {
    .act:hover {
      background: rgb(255 255 255 / 0.08);
    }
    .act:hover :global(.lucide-refresh-cw) {
      transform: rotate(90deg);
      transition: transform 420ms var(--ease-out);
    }
  }
  .note {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .link {
    justify-self: start;
    min-height: 44px;
    padding: 0 4px;
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
  .own {
    display: grid;
    gap: var(--sp-2);
  }
  .fl {
    font-size: var(--fs-small);
    font-weight: 600;
    color: var(--text-2);
  }
  .field {
    display: flex;
    align-items: center;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface-1);
  }
  .field:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .field input {
    flex: 1;
    min-width: 0;
    height: 52px;
    padding: 0 var(--sp-4);
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: max(1.0625rem, 16px);
    outline: none;
  }
  .field input[aria-invalid="true"] {
    color: var(--text);
  }
  /* Masquer sans type="password" : aucun gestionnaire de mots de passe ne propose d'enregistrer (UI §12.3). */
  .field input.masked {
    -webkit-text-security: disc;
  }
  .eye {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-inline-end: 4px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }
  @media (hover: hover) {
    .eye:hover {
      color: var(--text);
      background: rgb(255 255 255 / 0.06);
    }
  }
  .copy-own {
    justify-self: start;
  }
  @media (prefers-reduced-motion: reduce) {
    .act {
      transition: none;
    }
    .act:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .gen,
    .act {
      border: 1px solid CanvasText;
    }
  }
</style>
