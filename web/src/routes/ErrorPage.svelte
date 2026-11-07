<script lang="ts">
  // Pages d'erreur du site (tâche UP), en français et en anglais : introuvable (404), hors ligne
  // (navigator.onLine ou requête impossible), erreur du serveur (5xx), trop de demandes (429,
  // compte à rebours de Retry-After), navigateur non pris en charge, maintenance (503 « frozen »,
  // drapeau d'exploitation du serveur). Aucun secret dans l'adresse ni dans le titre : rien
  // d'autre que des textes fixes. Le lien invalide ou incomplet garde son écran (Invalid.svelte),
  // dans la même facture (StatusPage).
  import { followLink, href } from "../app/router.svelte";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { Compass, Hourglass, MonitorX, ServerCrash, WifiOff, Wrench } from "../ui/Icon";
  import StatusPage from "../ui/StatusPage.svelte";

  export type ErrorKind = "notfound" | "offline" | "server" | "limit" | "unsupported" | "maintenance";
  type Props = {
    kind: ErrorKind;
    /** 429 : secondes avant de pouvoir réessayer (Retry-After). */
    retryAfterS?: number;
    /** Réessayer (hors ligne, serveur, trop de demandes, maintenance). */
    onretry?: () => void;
    /** Retour à l'écran d'avant, à la place de l'accueil (maintenance pendant un envoi). */
    onback?: () => void;
    level?: 1 | 2;
  };
  let { kind, retryAfterS = 0, onretry, onback, level = 1 }: Props = $props();

  const ICONS = { notfound: Compass, offline: WifiOff, server: ServerCrash, limit: Hourglass, unsupported: MonitorX, maintenance: Wrench } as const;
  const lang = $derived(getLang());

  // 429 : compte à rebours à la seconde ; « Réessayer » s'active à zéro (annoncé une fois).
  let left = $state(0);
  $effect(() => {
    if (kind !== "limit") return;
    // Ne lit pas `left` : l'effet ne dépend que de retryAfterS (sinon chaque seconde le relancerait).
    const total = Math.max(0, Math.ceil(retryAfterS));
    const end = Date.now() + total * 1000;
    left = total;
    if (total === 0) return;
    const id = setInterval(() => {
      left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (left === 0) {
        clearInterval(id);
        announce(t("error.limit.ready"));
      }
    }, 1000);
    return () => clearInterval(id);
  });

  // Hors ligne : le retour du réseau relance d'office (une seule fois par retour).
  $effect(() => {
    if (kind !== "offline" || !onretry) return;
    const back = () => onretry?.();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  });
</script>

<StatusPage kind={kind} screen={kind} icon={ICONS[kind]} title={t(`error.${kind}.title`)} lede={t(`error.${kind}.body`)} {level}>
  {#if kind === "limit"}
    <p class="wait num" aria-live="off">
      {left > 0 ? t("error.limit.wait", { duration: formatDuration(left, lang, { precise: true }) }) : t("error.limit.ready")}
    </p>
  {/if}
  {#snippet action()}
    {#if kind === "notfound" || ((kind === "server" || kind === "maintenance") && !onretry && !onback)}
      <a href={href("/")} onclick={(e) => followLink(e, "/")}>{t("notfound.home")}</a>
    {:else if kind !== "unsupported"}
      {#if onretry}<Button variant="primary" disabled={kind === "limit" && left > 0} onpress={() => onretry?.()}>{t("common.retry")}</Button>{/if}
      {#if onback}<Button variant="secondary" onpress={() => onback?.()}>{t("error.back")}</Button>{/if}
    {/if}
  {/snippet}
</StatusPage>

<style>
  .wait {
    margin: 0;
    color: var(--text);
    font-weight: 560;
  }
</style>
