<script lang="ts" generics="T extends string | number">
  type Option = { value: T; label: string };
  type Props = {
    /** Nom accessible du groupe (« Durée »). */
    label: string;
    options: readonly Option[];
    value: T;
  };
  let { label, options, value = $bindable() }: Props = $props();

  // Vrais boutons radio natifs : flèches, tabulation unique sur le groupe et lecteurs d'écran
  // viennent du navigateur ; role="radiogroup" nomme le groupe.
  const group = $props.id();
</script>

<div class="seg" role="radiogroup" aria-label={label}>
  {#each options as o (o.value)}
    <label class="opt">
      <input type="radio" class="sr-only" name={group} value={o.value} bind:group={value} />
      <span class="face num">{o.label}</span>
    </label>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    gap: var(--sp-1);
    padding: var(--sp-1);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface-1);
  }
  .opt {
    flex: 1;
    position: relative;
    display: block;
  }
  .face {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    min-width: 44px;
    padding: 0 var(--sp-3);
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }
  input:checked + .face {
    background: var(--accent);
    color: var(--on-accent);
  }
  input:focus-visible + .face {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    input:not(:checked) + .face:hover {
      background: var(--surface-3);
      color: var(--text);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .face {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    input:checked + .face {
      outline: 2px solid Highlight;
      forced-color-adjust: none;
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
