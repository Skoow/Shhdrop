<script lang="ts">
  // État d'un partage (UI §9.6.3, benchmark M11) : icône ET mot, jamais la couleur seule ;
  // souligné en couleurs forcées.
  import { t } from "../i18n/i18n.svelte";
  import { Hourglass, Lock, Timer, Trash2 } from "./Icon";

  type Props = { state: "ready" | "draining" | "gone" | "expired"; destroyedHere?: boolean; id?: string };
  let { state, destroyedHere = false, id }: Props = $props();
  const word = $derived(
    state === "ready"
      ? t("hist.state.ready")
      : state === "draining"
        ? t("hist.state.draining")
        : state === "expired"
          ? t("hist.state.expired")
          : destroyedHere
            ? t("hist.state.gone")
            : t("hist.state.erased"),
  );
</script>

<span class={["chip", state]} {id} data-state-chip={state}>
  {#if state === "ready"}<Lock size={14} strokeWidth={2.2} aria-hidden="true" />
  {:else if state === "draining"}<Hourglass size={14} strokeWidth={2.2} aria-hidden="true" />
  {:else if state === "expired"}<Timer size={14} strokeWidth={2.2} aria-hidden="true" />
  {:else}<Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />{/if}
  <span class="w">{word}</span>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: var(--r-pill);
    font-size: var(--fs-small);
    font-weight: 600;
    line-height: 1.6;
    white-space: nowrap;
    background: var(--surface-2);
    color: var(--text-2);
  }
  .ready {
    background: var(--accent-tint);
    color: var(--accent);
  }
  .draining {
    background: var(--warn-tint);
    color: var(--warn);
  }
  @media (forced-colors: active) {
    .chip {
      border: 1px solid CanvasText;
    }
    .w {
      text-decoration: underline;
    }
  }
</style>
