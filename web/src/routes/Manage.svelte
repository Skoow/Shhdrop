<script lang="ts">
  // Gestion par l'expéditeur (UI §9.6), version minimale de la Task 19 : état, ouvertures,
  // compte à rebours, Supprimer maintenant. Le lien de gestion (S_gestion) est pris une fois
  // (take, qui nettoie aussi la barre d'adresse) et ne vit que dans cette fermeture.
  // Relecture toutes les 60 s tant que la page est visible ; « Actualiser » à la demande.
  import { tick, untrack } from "svelte";
  import type { LinkState } from "../app/link";
  import { followLink, href } from "../app/router.svelte";
  import { formatClock, formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { LimitError, NotFoundError, destroyShare, shareStatus } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import Deadline from "../ui/Deadline.svelte";
  import { RefreshCw, Trash2 } from "../ui/Icon";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import DestroyedArt from "../ui/DestroyedArt.svelte";
  import Logo from "../ui/Logo.svelte";
  import TimeRim from "../ui/TimeRim.svelte";
  import Invalid from "./Invalid.svelte";

  /** Relecture automatique (UI §9.6.4) : toutes les 60 s tant que la page est visible. */
  const REFRESH_MS = 60_000;
  type Props = { take: () => LinkState | null };
  let { take }: Props = $props();
  const lang = $derived(getLang());

  const got = untrack(() => take());
  let secret: string | null = got?.kind === "m" ? got.link : null;

  type Status = { opensUsed: number; maxOpens: number; expiresInS: number; state: string };
  let status = $state.raw<Status | null>(null);
  let total = $state(0); // durée de référence du contour : la première mesure de la session
  let phase = $state<"loading" | "ready" | "gone" | "incomplete">(secret === null ? "incomplete" : "loading");
  let error = $state("");
  let pausedUntil = 0;
  let reads = $state(0); // nouvelle lecture → nouveau compte à rebours

  // Heure de la dernière lecture réussie (UI §9.6.5, audit M13).
  let readAt = $state<number | null>(null);
  // Suppression en cours ou faite : une relecture encore en vol ne réaffiche rien (audit, faible).
  let deleting = false;
  const over = () => secret === null || phase === "gone" || deleting;
  async function refresh() {
    if (over() || Date.now() < pausedUntil) return;
    try {
      const s = await shareStatus(secret!, location.origin);
      if (over()) return;
      readAt = Date.now();
      if (total === 0) total = s.expiresInS;
      status = s;
      error = "";
      reads++;
      phase = "ready";
    } catch (e) {
      if (over()) return;
      if (e instanceof NotFoundError || (e instanceof Error && e.message === "lien_invalide")) return gone();
      if (e instanceof LimitError) {
        pausedUntil = Date.now() + e.retryAfterS * 1000;
        error = t("manage.limit", { duration: formatDuration(e.retryAfterS, lang) });
      } else error = t("manage.network");
      if (phase === "loading") phase = "ready";
    }
  }

  let card: HTMLDivElement | undefined = $state();
  let goneTitle: HTMLHeadingElement | undefined = $state();
  let logo: Logo | undefined = $state();
  async function gone() {
    secret = null;
    phase = "gone";
    await tick();
    goneTitle?.focus({ preventScroll: true });
    announce(t("manage.gone"));
    await logo?.erase();
  }

  let deleteError = $state("");
  async function remove() {
    if (secret === null) return;
    deleteError = "";
    deleting = true;
    try {
      await destroyShare(secret, location.origin);
    } catch (e) {
      if (!(e instanceof NotFoundError)) {
        deleting = false;
        deleteError = t("manage.delete.net");
        return;
      }
    }
    // Après la réponse du serveur seulement (UI §7.4).
    if (card && typeof card.animate === "function") {
      await card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: "forwards" }).finished.catch(() => undefined);
    }
    await gone();
  }

  $effect(() => {
    untrack(() => void refresh());
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    // Retour sur l'onglet après plus d'une minute : relu tout de suite (jamais en arrière-plan).
    const back = () => {
      if (document.visibilityState === "visible" && readAt !== null && Date.now() - readAt >= REFRESH_MS) void refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
    };
  });

  let title: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (title) untrack(() => title?.focus({ preventScroll: true }));
  });

  const line = $derived.by(() => {
    if (!status) return "";
    if (status.state === "draining") return t("manage.draining");
    if (status.state === "uploading") return t("manage.uploading");
    return "";
  });
</script>

{#if phase === "incomplete"}
  <Invalid kind="incomplete" />
{:else if phase === "gone"}
  <section class="manage" aria-labelledby="m-gone">
    <div class="gone-logo"><Logo bind:this={logo} /></div>
    <DestroyedArt />
    <h1 id="m-gone" class="title" tabindex="-1" bind:this={goneTitle}>{t("manage.gone")}</h1>
    <p class="lede">{t("manage.gone.body")}</p>
    <p><a class="send" href={href("/")} onclick={(e) => followLink(e, "/")}>{t("invalid.send")}</a></p>
  </section>
{:else}
  <section class="manage" aria-labelledby="m-title" aria-busy={phase === "loading" ? "true" : undefined}>
    <h1 id="m-title" class="title" tabindex="-1" data-large-title bind:this={title}>{t("manage.title")}</h1>
    <div class="card" bind:this={card} data-capsule data-state="open">
      {#if status}
        {#key reads}
          <TimeRim remainingS={status.expiresInS} totalS={total} opensLeft={Math.max(0, status.maxOpens - status.opensUsed)} radius={23} />
        {/key}
        <p class="status num" data-status={status.state}>
          {#key reads}
            {t("manage.status", { u: status.opensUsed, max: status.maxOpens })}
          {/key}
        </p>
        <p class="when">
          {#key reads}
            <Deadline expiresInS={status.expiresInS} onexpire={() => void refresh()} />
          {/key}
        </p>
        {#if line}<p class="sub">{line}</p>{/if}
        {#if readAt !== null}<p class="read num" data-read-at>{t("manage.readAt", { time: formatClock(readAt, lang) })}</p>{/if}
      {:else}
        <p class="sub">{t("manage.loading")}</p>
      {/if}
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="actions">
      <Button variant="ghost" onpress={refresh}>
        {#snippet icon()}<RefreshCw size={18} />{/snippet}
        {t("manage.refresh")}
      </Button>
    </div>
    <div class="danger-zone">
      <InlineConfirm label={t("manage.delete")} message={t("manage.delete.confirm")} confirmLabel={t("manage.delete.yes")} kind="danger" triggerVariant="danger" onconfirm={remove}>
        {#snippet icon()}<Trash2 size={18} />{/snippet}
      </InlineConfirm>
      {#if deleteError}<p class="err" role="alert">{deleteError}</p>{/if}
    </div>
  </section>
{/if}

<style>
  /* Échéance en deux lignes (Deadline, retours UI4). */
  .when {
    margin: 0;
    font-size: var(--fs-small);
  }
  .manage {
    width: min(100%, 640px);
    margin-inline: auto;
    padding: var(--sp-6) var(--sp-4) var(--sp-8);
    display: grid;
    justify-items: start;
    gap: var(--sp-5);
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
  .card {
    position: relative;
    justify-self: stretch;
    display: grid;
    gap: var(--sp-2);
    padding: var(--sp-5);
    border-radius: var(--r-xl);
    background: var(--vessel);
    box-shadow: var(--edge-hi);
  }
  .status {
    margin: 0;
    font-size: var(--fs-h3);
    font-weight: 600;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .read {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .sub,
  .lede {
    margin: 0;
    color: var(--text-2);
    max-width: 60ch;
  }
  .err {
    margin: 0;
    color: var(--danger);
  }
  .danger-zone {
    justify-self: stretch;
    display: grid;
    justify-items: start;
    gap: var(--sp-2);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--line);
  }
  .gone-logo {
    height: 34px;
  }
  .send {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent);
    text-underline-offset: 0.2em;
  }
  /* Téléphone : actions pleine largeur et alignées ; grand titre natif (réduit dans la barre). */
  @media (max-width: 899px) {
    .manage {
      padding: var(--sp-2) 0 var(--sp-6);
      justify-items: stretch;
      gap: var(--sp-4);
    }
    .card {
      padding: var(--sp-4);
      border-radius: var(--r-lg);
    }
    .actions,
    .danger-zone {
      display: grid;
      justify-items: stretch;
    }
    .actions :global(.btn),
    .danger-zone :global(.btn) {
      width: 100%;
      justify-content: center;
    }
    .send {
      justify-content: center;
      width: 100%;
      min-height: 52px;
      border-radius: 14px;
      background: var(--surface-3);
      color: var(--text);
      font-weight: 600;
      text-decoration: none;
    }
  }
</style>
