<script lang="ts">
  // Échéance en deux lignes (retours UI4), partout où une durée s'affiche (destinataire, « Lien
  // prêt », gestion) : 1) date et heure exactes de fin ; 2) dessous, le décompte vivant
  // (Countdown : à la seconde sous 1 h, à la minute au-delà ; annonces discrètes aux seuils
  // seulement, jamais chaque seconde). `lead` précède le décompte (« Disponible encore »).
  import { formatEndsAt } from "../i18n/format";
  import { getLang } from "../i18n/i18n.svelte";
  import Countdown from "./Countdown.svelte";

  type Props = { expiresInS: number; lead?: string; now?: () => number; onexpire?: () => void };
  let { expiresInS, lead, now, onexpire }: Props = $props();
  // Fixée à l'arrivée de l'échéance (Date.now() lu une fois par valeur reçue).
  const ends = $derived(formatEndsAt(Date.now() + Math.max(0, expiresInS) * 1000, getLang()));
</script>

<span class="deadline" data-deadline>
  <span class="ends num">{ends}</span>
  <span class="left num">{lead ? `${lead} ` : ""}<Countdown {expiresInS} {now} {onexpire} /></span>
</span>

<style>
  .deadline {
    display: inline-grid;
    gap: 1px;
    min-width: 0;
  }
  .ends {
    color: var(--text);
    font-weight: 560;
  }
  .left {
    color: var(--text-2);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
</style>
