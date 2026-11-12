<script lang="ts">
  // Lien invalide, lien incomplet, retour impossible (UI §9.11, D42-22) : message unique pour
  // un lien inconnu (spec §5.2, avec la limite des retours : même navigateur seulement), retour à l'envoi,
  // dans la facture commune des pages d'état (StatusPage, tâche UP). En démo seulement, une
  // phrase explique pourquoi un lien de démo ouvert ailleurs est invalide (crochet getDemo,
  // jamais une chaîne du dictionnaire de production).
  import { getDemo } from "../app/demo-hooks";
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { Link2 } from "../ui/Icon";
  import StatusPage from "../ui/StatusPage.svelte";

  /** limit : retour refusé par la limite des retours (20), sans ouverture restante. */
  type Props = { kind: "invalid" | "incomplete" | "return_lost"; limit?: boolean };
  let { kind, limit = false }: Props = $props();
  const demo = getDemo();
</script>

<div class="invalid" data-invalid={kind}>
  <StatusPage
    {kind}
    screen={kind === "incomplete" ? "incomplete" : "invalid"}
    icon={Link2}
    title={t(kind === "invalid" ? "invalid" : kind === "incomplete" ? "incomplete" : "lost")}
    lede={t(kind === "invalid" ? "invalid.hint" : kind === "incomplete" ? "incomplete.hint" : limit ? "lost.limit" : "lost.hint")}
  >
    {#if kind === "invalid" && demo}<p class="lede demo-note">{demo.invalidLinkNote}</p>{/if}
    {#snippet action()}<a class="send" href={href("/")} onclick={(e) => followLink(e, "/")}>{t("invalid.send")}</a>{/snippet}
  </StatusPage>
</div>

<style>
  .lede {
    margin: 0;
    color: var(--text-2);
    max-width: 60ch;
  }
</style>
