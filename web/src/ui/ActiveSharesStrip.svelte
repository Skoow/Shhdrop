<script lang="ts">
  // Accueil : « Vos partages actifs » (spec §33.1, UI §9.6.1). Lecture LOCALE seulement au
  // chargement (aucune requête) ; une relecture n'a lieu que sur « Actualiser ». Rien n'est
  // rendu sans partage actif (historique vide, désactivé, indisponible ou tout terminé).
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { destroyFromHistory, forgetShare, loadHistory, refreshShare, shares } from "../history/live.svelte";
  import { isActive } from "../history/store";
  import { ArrowRight } from "./Icon";
  import ShareCard from "./ShareCard.svelte";

  $effect(() => {
    void loadHistory();
  });

  // Une minuterie pour toutes les cartes (comptes à rebours, « il y a ») ; aucune requête.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    const back = () => {
      if (document.visibilityState === "visible") now = Date.now();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
    };
  });

  const active = $derived(shares.entries.filter((e) => isActive(e, now)));
</script>

{#if active.length > 0}
  <section class="strip" aria-labelledby="strip-title" data-active-shares>
    <div class="top">
      <h2 id="strip-title" class="ttl">{t("hist.strip.title")}</h2>
      <a class="all" href={href("/envois")} onclick={(e) => followLink(e, "/envois")}>
        {t("hist.strip.all", { n: shares.entries.length })}<ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
      </a>
    </div>
    <ul class="list" role="list">
      {#each active.slice(0, 3) as e (e.id)}
        <ShareCard
          entry={e}
          {now}
          compact
          info={shares.info[e.id]}
          onrefresh={async () => void (await refreshShare(e.id))}
          ondestroy={() => destroyFromHistory(e.id)}
          onremove={() => void forgetShare(e.id)}
        />
      {/each}
    </ul>
  </section>
{/if}

<style>
  .strip {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-2);
  }
  .ttl {
    margin: 0;
    font-size: var(--fs-h3);
    line-height: var(--lh-h3);
  }
  .all {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    color: var(--accent);
    font-weight: 600;
    text-underline-offset: 0.2em;
  }
  .list {
    display: grid;
    gap: var(--sp-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
