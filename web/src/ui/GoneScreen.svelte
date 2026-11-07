<script lang="ts">
  // Écran de fin quand le partage disparaît pendant la lecture (spec §41.8, UI §9.8.9 ; E1).
  // L'interface est déjà fermée : seuls restent les enregistrements en cours au moment de la
  // fermeture, avec leur nom nettoyé (décision du propriétaire du 7 novembre), leur
  // progression et leur fin (« Terminé » ou « Téléchargement interrompu. »). Sans
  // enregistrement en cours : la page de fin ordinaire.
  import { followLink, href } from "../app/router.svelte";
  import type { GoneCause, Transfer } from "../flows/gone.svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import { Check, Download, TriangleAlert, Trash2 } from "./Icon";
  import StatusPage from "./StatusPage.svelte";

  type Props = { cause: GoneCause; finishing: Transfer[] };
  let { cause, finishing }: Props = $props();
  const lang = $derived(getLang());

  const title = $derived(
    cause === "countdown" ? t("gone.title.expired") : cause === "destroyed-here" ? t("gone.title.destroyed") : t("gone.title.removed"),
  );
  const lede = $derived(
    finishing.length === 0
      ? t("gone.body")
      : t("gone.finishing", { n: finishing.length, name: finishing[0]!.name }),
  );
  const pct = (x: Transfer) => (x.total > 0 ? Math.min(100, Math.floor((x.done / x.total) * 100)) : 100);

  // Une annonce par fin d'enregistrement (Terminé, interrompu), jamais à chaque octet.
  const seen = new Set<number>();
  $effect(() => {
    for (const x of finishing)
      if (x.state !== "running" && !seen.has(x.id)) {
        seen.add(x.id);
        announce(`${x.name} : ${x.state === "done" ? t("gone.item.done") : t("gone.item.failed")}`);
      }
  });
</script>

<div class="gone" data-gone={cause} data-finishing={finishing.length}>
  <StatusPage kind="gone" screen="gone" icon={finishing.length > 0 ? Download : Trash2} {title} {lede} level={2}>
    {#if finishing.length > 0}
      <ul class="list">
        {#each finishing as x (x.id)}
          <li class="tr" data-transfer={x.state}>
            <div class="top">
              <bdi class="name" translate="no">{x.name}</bdi>
              <span class={["st", x.state]}>
                {#if x.state === "done"}<Check size={16} strokeWidth={2.2} aria-hidden="true" />{t("gone.item.done")}
                {:else if x.state === "failed"}<TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />{t("gone.item.failed")}
                {:else}{t("gone.item.state")}{/if}
              </span>
            </div>
            {#if x.state === "running"}
              <progress max="100" value={pct(x)} aria-label={x.name}></progress>
              <span class="num small">{formatBytes(x.done, lang)} / {formatBytes(x.total, lang)} · {pct(x)}&#8239;%</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if finishing.some((x) => x.state === "running")}<p class="keep">{t("gone.keepOpen")}</p>{/if}
    {/if}
    {#snippet action()}<a href={href("/")} onclick={(e) => followLink(e, "/")}>{t("invalid.send")}</a>{/snippet}
  </StatusPage>
</div>

<style>
  .list {
    display: grid;
    gap: var(--sp-3);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tr {
    display: grid;
    gap: 6px;
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px var(--hair);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--sp-2);
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
  }
  .st {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .st.done {
    color: var(--accent);
  }
  .st.failed {
    color: var(--danger);
  }
  progress {
    width: 100%;
    height: 6px;
    accent-color: var(--accent);
  }
  .small {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .keep {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
</style>
