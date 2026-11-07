<script lang="ts">
  // Texte reçu (UI §9.8, §12.4) : texte brut, interpolation Svelte seulement (jamais de HTML,
  // jamais de lien cliquable), sens d'écriture automatique.
  type Props = { text: string; label: string; viewOnly: boolean };
  let { text, label, viewOnly }: Props = $props();
</script>

<!-- Bloc qui défile : atteignable au clavier pour le faire défiler (WCAG 2.1.1). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<pre class={["text", viewOnly && "guarded"]} dir="auto" translate="no" aria-label={label} tabindex="0">{text}</pre>

<style>
  .text {
    margin: 0;
    padding: var(--sp-4);
    max-height: 60vh;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--font-sans);
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    color: var(--text);
    background: var(--surface-1);
    border: 1px solid var(--hair-2);
    border-radius: var(--r-lg);
    max-width: 72ch;
  }
  .text:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .guarded {
    -webkit-touch-callout: none;
  }
</style>
