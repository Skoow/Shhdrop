<script lang="ts">
  // Signaler (UI §9.10, benchmark M10) : feuille sans choix de motif ni champ libre ; le
  // serveur n'en garde aucun. Le seul effet est la destruction du partage pour tout le monde.
  import { t } from "../i18n/i18n.svelte";
  import Button from "./Button.svelte";
  import { Flag } from "./Icon";
  import Sheet from "./Sheet.svelte";

  type Props = {
    open: boolean;
    /** Signaler et détruire ; rend un message d'erreur, ou null si la feuille peut se fermer. */
    onconfirm: () => Promise<string | null>;
  };
  let { open = $bindable(false), onconfirm }: Props = $props();
  let error = $state("");

  async function confirm() {
    error = "";
    const e = await onconfirm();
    if (e === null) open = false;
    else error = e;
  }
</script>

<Sheet bind:open title={t("report.title")} onclose={() => (error = "")}>
  <div class="report">
    <p class="body">{t("report.body")}</p>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="actions">
      <Button variant="danger" onpress={confirm}>
        {#snippet icon()}<Flag size={18} />{/snippet}
        {t("report.confirm")}
      </Button>
      <Button variant="ghost" onpress={() => void (open = false)}>{t("common.cancel")}</Button>
    </div>
  </div>
</Sheet>

<style>
  .report {
    display: grid;
    gap: var(--sp-4);
  }
  .body {
    margin: 0;
    color: var(--text-2);
    max-width: 60ch;
  }
  .err {
    margin: 0;
    color: var(--danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
  }
</style>
