<script lang="ts">
  // Lien invalide, lien incomplet (UI §9.11) : message unique (spec §5.2), retour à l'envoi,
  // dans la facture commune des pages d'état (StatusPage, tâche UP). En démo seulement, une
  // phrase explique pourquoi un lien de démo ouvert ailleurs est invalide (crochet getDemo,
  // jamais une chaîne du dictionnaire de production).
  import { getDemo } from "../app/demo-hooks";
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { Link2 } from "../ui/Icon";
  import StatusPage from "../ui/StatusPage.svelte";

  type Props = { kind: "invalid" | "incomplete" };
  let { kind }: Props = $props();
  const demo = getDemo();
</script>

<div class="invalid" data-invalid={kind}>
  <StatusPage kind={kind} screen={kind} icon={Link2} title={t(kind === "invalid" ? "invalid" : "incomplete")} lede={kind === "incomplete" ? t("incomplete.hint") : undefined}>
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
