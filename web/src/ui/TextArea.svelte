<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";

  type Props = Omit<HTMLTextareaAttributes, "value" | "class" | "id" | "aria-describedby" | "aria-invalid"> & {
    label: string;
    value?: string;
    hint?: string;
    error?: string;
    labelHidden?: boolean;
    el?: HTMLTextAreaElement | undefined;
  };
  let { label, value = $bindable(""), hint, error, labelHidden = false, el = $bindable(), ...rest }: Props = $props();

  const uid = $props.id();
  const describedBy = $derived([hint ? `${uid}-hint` : "", error ? `${uid}-err` : ""].filter(Boolean).join(" ") || undefined);
</script>

<div class="field">
  <label for={uid} class={{ "sr-only": labelHidden }}>{label}</label>
  <textarea
    bind:this={el}
    bind:value
    {...rest}
    id={uid}
    class={["input", { invalid: !!error }]}
    aria-invalid={error ? "true" : undefined}
    aria-describedby={describedBy}
  ></textarea>
  {#if hint}<p id="{uid}-hint" class="hint">{hint}</p>{/if}
  {#if error}<p id="{uid}-err" class="err">{error}</p>{/if}
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
    min-height: 8rem;
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: max(1rem, 16px);
    resize: vertical;
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
