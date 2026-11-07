<script lang="ts">
  // Repère des quatre phases visibles (UI §9.4.1) : à venir, en cours ou faite, en texte et
  // icône (jamais la couleur seule).
  import { t } from "../i18n/i18n.svelte";
  import { Check, Minus } from "./Icon";

  type State = "todo" | "doing" | "done";
  type Props = { phases: { label: string; state: State }[] };
  let { phases }: Props = $props();
</script>

<ol class="phases" aria-label={t("seal.phases.label")}>
  {#each phases as ph (ph.label)}
    <li class={ph.state} aria-current={ph.state === "doing" ? "step" : undefined}>
      <span class="ic" aria-hidden="true">
        {#if ph.state === "done"}<Check size={18} strokeWidth={2} />{:else if ph.state === "doing"}<span class="pt"></span>{:else}<Minus size={18} strokeWidth={2} />{/if}
      </span>
      <span>{ph.label}</span><span class="sr-only"> · {t(`seal.state.${ph.state}`)}</span>
    </li>
  {/each}
</ol>

<style>
  .phases {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--sp-2);
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    color: var(--text-3);
  }
  .done {
    color: var(--text-2);
  }
  .done .ic {
    color: var(--accent);
  }
  .doing {
    color: var(--text);
    font-weight: 600;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 20px;
  }
  .pt {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
  }
  @media (prefers-reduced-motion: no-preference) {
    .pt {
      animation: seal-pulse 1.6s ease-in-out infinite;
    }
  }
</style>
