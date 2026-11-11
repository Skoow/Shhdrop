<script lang="ts">
  // « Vos envois » (/envois) : tableau de bord de l'historique local (spec §33, §33.1 ; UI §9.6.2).
  // D'abord l'état LOCAL (lecture d'IndexedDB, aucune requête) ; puis, page visible, une relecture
  // des partages actifs dont l'état date de plus de 5 min, l'un après l'autre, chacun après une
  // gigue de 0,5 à 4 s (history/poll.ts). Jamais en arrière-plan, aucune boucle.
  import { untrack } from "svelte";
  import { followLink, href, navigate } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import {
    clearHistory,
    destroyFromHistory,
    forgetShare,
    loadHistory,
    refreshAll,
    refreshShare,
    setHistoryEnabled,
    shares,
    stopRefresh,
  } from "../history/live.svelte";
  import { isActive } from "../history/store";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { Plus, Trash2 } from "../ui/Icon";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import ShareCard from "../ui/ShareCard.svelte";

  let now = $state(Date.now());
  $effect(() => {
    untrack(() =>
      void loadHistory(true).then(async (h) => {
        if (h && document.visibilityState === "visible") await refreshAll();
      }),
    );
    const id = setInterval(() => (now = Date.now()), 30_000);
    const back = () => {
      if (document.visibilityState === "visible") now = Date.now();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      stopRefresh();
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
    };
  });

  type Filter = "active" | "ended" | "all";
  let filter = $state<Filter>("all");
  const filters = $derived([
    { value: "active" as const, label: t("hist.filter.active") },
    { value: "ended" as const, label: t("hist.filter.ended") },
    { value: "all" as const, label: t("hist.filter.all") },
  ]);
  const activeCount = $derived(shares.entries.filter((e) => isActive(e, now)).length);
  const endedCount = $derived(shares.entries.length - activeCount);
  const shown = $derived(shares.entries.filter((e) => filter === "all" || (filter === "active") === isActive(e, now)));

  let title: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (title) untrack(() => title?.focus({ preventScroll: true }));
  });

  async function clear() {
    await clearHistory();
    announce(t("hist.cleared"));
  }
  async function enable() {
    await setHistoryEnabled(true);
    announce(t("hist.on.done"));
  }
</script>

<section class="hist" aria-labelledby="h-title" aria-busy={shares.status === "loading" || shares.status === "idle" ? "true" : undefined}>
  <div class="top">
    <div class="tt">
      <h1 id="h-title" class="title" tabindex="-1" data-large-title bind:this={title}>{t("hist.title")}</h1>
      {#if shares.status === "ready" && shares.entries.length > 0}
        <p class="counts num" data-counts>{t("hist.count.active", { n: activeCount })} · {t("hist.count.ended", { n: endedCount })}</p>
      {/if}
    </div>
    <Button variant="primary" onpress={() => navigate("/envoyer")}>
      {#snippet icon()}<Plus size={20} strokeWidth={2} />{/snippet}
      {t("hist.new")}
    </Button>
  </div>

  {#if shares.status === "unavailable"}
    <div class="empty" data-history-unavailable>
      <h2 class="et">{t("hist.unavailable.title")}</h2>
      <p class="sub">{t("hist.unavailable.body")}</p>
    </div>
  {:else if shares.status !== "ready"}
    <ul class="list" role="list" aria-label={t("hist.loading")}>
      {#each [0, 1] as k (k)}<li class="skel" aria-hidden="true"></li>{/each}
    </ul>
  {:else if shares.entries.length === 0}
    <div class="empty" data-history-empty>
      <svg class="art" viewBox="0 0 64 80" width="64" height="80" aria-hidden="true">
        <path d="M8 4h32l16 16v52a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M40 4v16h16" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
      {#if shares.enabled}
        <h2 class="et">{t("hist.empty.title")}</h2>
        <p class="sub">{t("hist.empty.body")}</p>
        <p class="sub">{t("hist.honest")}</p>
        <a class="cta" href={href("/envoyer")} onclick={(e) => followLink(e, "/envoyer")}>{t("hist.empty.cta")}</a>
      {:else}
        <h2 class="et">{t("hist.off.title")}</h2>
        <p class="sub">{t("hist.off.body")}</p>
        <Button variant="secondary" onpress={enable}>{t("hist.off.cta")}</Button>
      {/if}
    </div>
  {:else}
    <div class="filters"><Segmented label={t("hist.filter")} options={filters} bind:value={filter} /></div>
    {#if shown.length === 0}
      <p class="sub">{t("hist.empty.filter")}</p>
    {:else}
      <ul class="list" role="list">
        {#each shown as e (e.id)}
          <ShareCard
            entry={e}
            {now}
            info={shares.info[e.id]}
            onrefresh={async () => void (await refreshShare(e.id))}
            ondestroy={() => destroyFromHistory(e.id)}
            onremove={() => void forgetShare(e.id)}
          />
        {/each}
      </ul>
    {/if}
    {#if !shares.enabled}
      <div class="off">
        <p class="sub">{t("hist.off.title")}. {t("hist.off.body")}</p>
        <Button variant="ghost" dense onpress={enable}>{t("hist.off.cta")}</Button>
      </div>
    {/if}
    <div class="foot">
      <p class="sub">{t("hist.honest")}</p>
      <InlineConfirm label={t("hist.clear")} message={t("hist.clear.confirm")} confirmLabel={t("hist.clear.yes")} kind="danger" triggerVariant="ghost" onconfirm={clear}>
        {#snippet icon()}<Trash2 size={18} strokeWidth={1.75} />{/snippet}
      </InlineConfirm>
    </div>
  {/if}
</section>

<style>
  .hist {
    width: min(100%, 1120px);
    margin-inline: auto;
    padding: var(--sp-6) var(--sp-4) var(--sp-8);
    display: grid;
    gap: var(--sp-5);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--sp-4);
  }
  .tt {
    display: grid;
    gap: var(--sp-1);
  }
  .title {
    margin: 0;
    font-size: var(--fs-screen);
    font-stretch: var(--wd-screen);
    line-height: 1.1;
  }
  .title:focus {
    outline: none;
  }
  .counts {
    margin: 0;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .filters {
    width: min(100%, 420px);
  }
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  @media (min-width: 960px) {
    .list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .skel {
    height: 150px;
    border-radius: var(--r-xl);
    background: var(--surface-1);
  }
  .empty {
    display: grid;
    justify-items: start;
    gap: var(--sp-3);
    padding: var(--sp-6) 0;
    max-width: 62ch;
  }
  .art {
    color: var(--text-2);
  }
  .et {
    margin: 0;
    font-size: var(--fs-h2, 1.5rem);
  }
  .sub {
    margin: 0;
    color: var(--text-2);
    max-width: 62ch;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent);
    font-weight: 600;
    text-underline-offset: 0.2em;
  }
  .off,
  .foot {
    display: grid;
    justify-items: start;
    gap: var(--sp-2);
  }
  .foot {
    padding-top: var(--sp-4);
    border-top: 1px solid var(--line);
  }
  .foot :global(button.ghost) {
    color: var(--danger);
  }
  @media (max-width: 899px) {
    .hist {
      padding: var(--sp-2) 0 var(--sp-6);
      gap: var(--sp-4);
    }
    .top :global(.btn) {
      width: 100%;
      justify-content: center;
    }
  }
</style>
