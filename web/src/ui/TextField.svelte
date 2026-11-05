<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  type Props = Omit<HTMLInputAttributes, "value" | "class" | "id" | "aria-describedby" | "aria-invalid"> & {
    label: string;
    value?: string;
    hint?: string;
    /** Message d'erreur : relié au champ par aria-describedby, champ marqué invalide. */
    error?: string;
    /** Étiquette lue par les lecteurs d'écran seulement (le contexte visuel la remplace). */
    labelHidden?: boolean;
    el?: HTMLInputElement | undefined;
  };
  let { label, value = $bindable(""), hint, error, labelHidden = false, el = $bindable(), ...rest }: Props = $props();

  const uid = $props.id();
  const describedBy = $derived([hint ? `${uid}-hint` : "", error ? `${uid}-err` : ""].filter(Boolean).join(" ") || undefined);
</script>

<div class="field">
  <label for={uid} class={{ "sr-only": labelHidden }}>{label}</label>
  <input
    bind:this={el}
    bind:value
    {...rest}
    id={uid}
    class={["input", { invalid: !!error }]}
    aria-invalid={error ? "true" : undefined}
    aria-describedby={describedBy}
  />
  {#if hint}<p id="{uid}-hint" class="hint">{hint}</p>{/if}
  {#if error}<p id="{uid}-err" class="err" role="alert">{error}</p>{/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--sp-2);
  }
  label {
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    font-weight: 600;
    color: var(--text-2);
  }
  .input {
    width: 100%;
    min-height: 48px;
    padding: 0 var(--sp-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: max(1rem, 16px); /* jamais sous 16 px : iOS zoomerait au focus */
  }
  .input::placeholder {
    color: var(--text-3);
  }
  .input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .input.invalid {
    border-color: var(--danger);
  }
  .input:disabled {
    color: var(--text-disabled);
    background: var(--surface-2);
  }
  .hint,
  .err {
    margin: 0;
    font-size: var(--fs-small);
    line-height: var(--lh-small);
  }
  .hint {
    color: var(--text-3);
  }
  .err {
    color: var(--danger);
  }
</style>
