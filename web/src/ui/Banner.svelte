<script lang="ts">
  import type { Snippet } from "svelte";
  import { Info, TriangleAlert } from "./Icon";
  import Button from "./Button.svelte";

  type Props = {
    kind?: "info" | "warn" | "danger";
    children: Snippet;
    /** Un bouton au plus. */
    action?: { label: string; onpress: () => void | Promise<void> };
  };
  let { kind = "info", children, action }: Props = $props();
</script>

<div class={["banner", kind]} role={kind === "danger" ? "alert" : "status"}>
  <span class="ic" aria-hidden="true">
    {#if kind === "info"}
      <Info size={20} strokeWidth={1.75} />
    {:else}
      <TriangleAlert size={20} strokeWidth={1.75} />
    {/if}
  </span>
  <div class="text">{@render children()}</div>
  {#if action}
    <Button variant="secondary" dense onpress={action.onpress}>{action.label}</Button>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
  }
  .warn {
    background: var(--warn-tint);
  }
  .danger {
    background: var(--danger-tint);
  }
  .ic {
    display: inline-flex;
    padding-top: 1px;
  }
  .info .ic {
    color: var(--info);
  }
  .warn .ic {
    color: var(--warn);
  }
  .danger .ic {
    color: var(--danger);
  }
  .text {
    flex: 1 1 12rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .text :global(p) {
    margin: 0;
  }
</style>
