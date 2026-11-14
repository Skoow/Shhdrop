<script lang="ts">
  // Ouverture d'un partage (UI §9.7, §9.11, S4 ; benchmark M6, M9, S3). Le lien est pris une
  // fois (take) et remis à createReceiver, qui le garde dans sa fermeture et nettoie la barre
  // d'adresse. Le mot de passe ne vit que dans le champ, jusqu'au déverrouillage. La capsule
  // est un seul élément du verrouillage à la fin : data-state « locked », « open », « destroyed ».
  import { untrack } from "svelte";
  import { inAppBrowser, isStandalone } from "../app/env";
  import type { ShareTake } from "../app/link";
  import { scrubAddressBar } from "../app/link";
  import { followLink, href, markReopen } from "../app/router.svelte";
  import { createReceiver } from "../flows/receive.svelte";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { PW_TRIES, isGeneratedPassword } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { copyText } from "../ui/clipboard";
  import Deadline from "../ui/Deadline.svelte";
  import DestroyedArt from "../ui/DestroyedArt.svelte";
  import { ChevronDown, Copy, Eye, EyeOff, Lock, LockOpen, ShieldCheck, TriangleAlert } from "../ui/Icon";
  import TimeRim from "../ui/TimeRim.svelte";
  import { finish } from "../flows/endoflife";
  import { createGone } from "../flows/gone.svelte";
  import GoneScreen from "../ui/GoneScreen.svelte";
  import { revokeAll } from "../viewers/blobs";
  import { arrive } from "../ui/arrive";
  import Content from "./Content.svelte";
  import Ended from "./Ended.svelte";
  import ErrorPage from "./ErrorPage.svelte";
  import Invalid from "./Invalid.svelte";

  type Props = {
    /** Lit le lien de l'adresse, une fois, au montage (le secret n'est jamais une prop réactive). */
    take: () => ShareTake | null;
  };
  let { take }: Props = $props();
  const lang = $derived(getLang());

  const taken = untrack(() => take());
  // D41-29 : mot de passe lu du QR code (fragment déjà retiré de l'adresse par scrub) ; une
  // seule tentative automatique, et seulement s'il a la forme d'un mot de passe généré (un
  // fragment fabriqué ne consomme pas d'essai). Échec : écran de saisie normal, champ vide.
  let linkPw: string | null = taken?.password ?? null;
  const r = createReceiver(taken?.state ?? { kind: "incomplete" }, {
    inAppBrowser: () => inAppBrowser(navigator.userAgent, isStandalone(window)),
    // Chemin non nu (« //x », « \ ») : repli sur l'accueil plutôt que garder le « # ».
    scrub: () => {
      if (!scrubAddressBar(history, location.pathname)) scrubAddressBar(history, href("/"));
    },
  });

  // Démontage (autre route, nouveau lien collé) : un déverrouillage ou une lecture encore en
  // cours n'aboutit plus à rien, et rien ne continue de tourner (audit M2).
  $effect(() => () => r.dispose());

  // ---------- Garde de sortie (ruling 3) ----------
  // Le « # » est retiré de l'adresse dès la lecture : recharger ou fermer l'écran verrouillé
  // perdrait le lien sans bruit. Confirmation du navigateur tant que le lien est tenu ici
  // (verrouillé, déverrouillage, erreur de lecture) ; jamais dans un navigateur intégré, qui
  // garde le « # ».
  // Rechargement (reopen) : le lien et l'octroi sont dans l'onglet (spec §41.4) ; rien ne se perd.
  // Lecture de meta (et attente des autres onglets, 400 ms) comprise : le « # » est déjà retiré.
  const holdsLink = $derived(
    (r.state === "meta" || r.state === "locked" || r.state === "unlocking" || r.state === "error") && !r.reopening,
  );
  $effect(() => {
    if (!holdsLink) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  });

  // Ouverture déverrouillée : cette entrée d'historique revient ici au rechargement (spec §41.4).
  $effect(() => {
    if (r.state === "open") untrack(() => markReopen(history));
  });

  // ---------- Activité (spec §41.4) : 30 min sans clic, touche, défilement ni retour à la page → octroi effacé ----------
  $effect(() => {
    const touch = () => r.touch();
    const opts = { passive: true, capture: true };
    for (const ev of ["pointerdown", "keydown", "scroll", "visibilitychange"]) window.addEventListener(ev, touch, opts);
    return () => {
      for (const ev of ["pointerdown", "keydown", "scroll", "visibilitychange"]) window.removeEventListener(ev, touch, opts);
    };
  });

  // ---------- Champ (UI §12.3) ----------
  let pw = $state("");
  let shown = $state(false);
  let input: HTMLInputElement | undefined = $state();
  const busy = $derived(r.state === "unlocking");

  // LimitError : bouton désactivé jusqu'à l'échéance.
  let limited = $state(false);
  $effect(() => {
    if (r.error !== "limit" || r.state !== "locked" || !r.retryAfterS) return;
    limited = true;
    const id = setTimeout(() => (limited = false), r.retryAfterS * 1000);
    return () => clearTimeout(id);
  });

  async function unlock() {
    if (pw === "" || busy || limited) {
      if (pw === "") await r.unlock(""); // message « Entrez le mot de passe. », aucun essai
      return;
    }
    const value = pw;
    await r.unlock(value);
    if (r.state === "open") {
      pw = ""; // plus aucune référence au mot de passe
      return;
    }
    if (r.error === "bad_password" && input) {
      input.focus();
      input.select();
    }
  }
  $effect(() => {
    if (linkPw === null || r.state !== "locked") return;
    const v = linkPw;
    linkPw = null;
    if (!isGeneratedPassword(v)) return;
    untrack(() => {
      pw = v;
      void unlock().then(() => {
        if (r.state !== "open") pw = "";
      });
    });
  });
  function onkey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      void unlock();
    }
  }

  const errorText = $derived.by(() => {
    switch (r.error) {
      case "bad_password":
        // Dernier essai : une seule ligne qui dit tout (audit M20).
        return r.attemptsLeft === 1 ? t("open.lastTry") : t("open.badPw", { n: r.attemptsLeft ?? 0 });
      case "password_required":
        return t("open.pwRequired");
      case "grant_invalid":
        return t("open.grantInvalid");
      case "reopen_limit":
        return t("open.reopenLimit");
      case "limit":
        return t(r.state === "error" ? "open.meta.limit" : "open.limit", { duration: formatDuration(r.retryAfterS ?? 60, lang) });
      case "network":
      case "server":
      case "maintenance":
        return t("open.network");
      default:
        return "";
    }
  });
  // Les erreurs sont en role="alert" (annoncées une fois, sans doublon dans la région polie).

  // ---------- Navigateur intégré (S4) ----------
  async function copyLink() {
    // Le « # » est encore dans la barre (rien n'a été retiré) : le lien d'origine, sans la requête.
    const r2 = await copyText(location.origin + location.pathname + location.hash);
    announce(r2 === "copied" ? t("copy.done", { label: t("open.inapp.copy") }) : t("copy.manual"));
  }

  // ---------- Disparition pendant la lecture (spec §41.8, E1) ----------
  // La fin de lecture (done, wipe) attend les enregistrements en cours ; rien ne part sur le
  // réseau pour dire « fermé ».
  const gone = createGone({
    finish: async () => {
      const o = r.opened;
      if (o) await finish(o);
      r.forget();
    },
    revokeAll,
  });

  // ---------- Fin de lecture ----------
  let expired = $state(false);
  // Échéance fixée à l'ouverture (« Disponible jusqu'au … », conception compte §21.9).
  const endsAt = $derived(r.state === "open" ? Date.now() + r.remainingS() * 1000 : undefined);
  let end = $state<"destroyed" | "gone" | null>(null);
  const capState = $derived(
    r.state === "destroyed_by_password" || end === "destroyed" || end === "gone" || gone.closed ? "destroyed" : r.state === "open" ? "open" : "locked",
  );

  let title: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (!title) return;
    untrack(() => title?.focus({ preventScroll: true }));
  });
  // Détruit après le dernier essai : même titre, autre écran ; on remonte le montrer (audit I4).
  $effect(() => {
    if (r.state === "destroyed_by_password") untrack(() => arrive(title));
  });
</script>

{#if r.state === "invalid" || r.state === "incomplete" || r.state === "return_lost" || r.state === "corrupt"}
  <Invalid kind={r.state} limit={r.state === "return_lost" && r.error === "reopen_limit"} />
{:else if r.state === "error"}
  <!-- fetchMeta impossible : page d'erreur (tâche UP) ; le lien reste en mémoire pour Réessayer. -->
  <ErrorPage
    kind={r.error === "limit" ? "limit" : r.error === "server" ? "server" : r.error === "maintenance" ? "maintenance" : "offline"}
    retryAfterS={r.retryAfterS ?? 60}
    onretry={() => void r.retry()}
  />
{:else}
  <section class="open" aria-labelledby={r.state === "open" ? undefined : "open-title"}>
    <div class={["capsule", capState === "open" && "bar", r.state === "open" && end !== null && "spent"]} data-capsule data-state={capState} aria-busy={r.state === "meta" ? "true" : undefined}>
      {#if (r.state === "locked" || r.state === "reopen" || r.state === "unlocking") && r.expiresInS > 0}
        <TimeRim remainingS={r.remainingS()} totalS={r.expiresInS} radius={31} />
      {:else if r.state === "open" && end === null && !expired && !gone.closed}
        <TimeRim remainingS={r.remainingS()} totalS={r.expiresInS} radius={23} />
      {/if}
      {#if capState === "destroyed"}
        <!-- UI §9.10.1 : ni cadenas ouvert ni pointillés ; le document qui se défait. -->
        <span class="art"><DestroyedArt /></span>
      {:else}
        <span class="lockbox" aria-hidden="true">
          {#if capState === "locked"}<Lock size={26} strokeWidth={1.75} />{:else}<LockOpen size={20} strokeWidth={1.75} />{/if}
        </span>
      {/if}
      <div class="cap-tx">
        {#if r.state === "open"}
          {#if end === null && !gone.closed}
            <p class="banner num">
              <!-- Retours UI5 : seulement l'échéance, date et heure de fin puis décompte (sans « Disponible encore »). -->
              {#if expired}{t("content.expired")}{:else}<Deadline
                  expiresInS={r.remainingS()}
                  onexpire={() => {
                    expired = true;
                    gone.closeToGone("countdown"); // aucune requête : l'horloge locale suffit
                  }}
                />{/if}
            </p>
          {/if}
        {:else}
          <h1 id="open-title" class="title" tabindex="-1" bind:this={title}>
            {r.state === "destroyed_by_password" ? t("open.destroyedByPw") : r.reopening ? t("open.reopen.title") : t("open.title")}
          </h1>
          {#if r.state === "locked" || r.state === "reopen" || r.state === "unlocking"}
            <p class="avail"><Deadline expiresInS={r.remainingS()} onexpire={() => r.expire()} /></p>
          {:else if r.state === "meta"}
            <p class="avail">{t("open.loading")}</p>
          {/if}
        {/if}
      </div>
    </div>

    {#if r.state === "inapp"}
      <div class="inapp" role="alert">
        <p class="warn-tx"><TriangleAlert size={20} aria-hidden="true" /> <span>{t("open.inapp", { app: r.app ?? "" })}</span></p>
        <div class="row">
          <Button variant="primary" onpress={copyLink}>
            {#snippet icon()}<Copy size={18} />{/snippet}
            {t("open.inapp.copy")}
          </Button>
          <Button variant="ghost" onpress={() => r.continueHere()}>{t("open.inapp.continue")}</Button>
        </div>
      </div>
    {:else if r.state === "locked" || r.state === "reopen" || r.state === "unlocking"}
      <p class="intro">{t("open.intro")}</p>
      <div class="unlock">
        <label class="fl" for="shh-unlock">{t("open.password")}</label>
        <div class={["box", r.error === "bad_password" && "bad"]}>
          <input
            bind:this={input}
            bind:value={pw}
            id="shh-unlock"
            name="shh-unlock"
            type={shown ? "text" : "password"}
            class="in"
            autocomplete="one-time-code"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            translate="no"
            enterkeyhint="go"
            readonly={busy}
            aria-invalid={r.error === "bad_password" ? "true" : undefined}
            aria-describedby="open-tries{errorText ? ' open-err' : ''}"
            onkeydown={onkey}
          />
          <button type="button" class="ib" aria-label={shown ? t("open.pw.hide") : t("open.pw.show")} aria-pressed={shown} onclick={() => (shown = !shown)}>
            {#if shown}<EyeOff size={19} strokeWidth={1.9} aria-hidden="true" />{:else}<Eye size={19} strokeWidth={1.9} aria-hidden="true" />{/if}
          </button>
        </div>
        {#if errorText}
          <div id="open-err" class="err" role="alert">
            <p>{errorText}</p>
          </div>
        {/if}
        <p id="open-tries" class="small">{t("open.tries", { n: PW_TRIES })}</p>
        {#if r.reopening}
          <p id="open-cost" class="cost">{t("open.reopen.body")}</p>
        {:else if r.otherTab}
          <p id="open-cost" class="cost">{t("open.otherTab")}</p>
        {:else if r.opensLeft > 0}
          <p id="open-cost" class="cost">{t("open.oneOpen", { n: r.opensLeft })}</p>
        {/if}
<div class="cta dock">
          <Button variant="primary" busy={busy} disabled={pw === "" || limited} onpress={unlock} aria-describedby={r.reopening || r.otherTab || r.opensLeft > 0 ? "open-cost" : undefined}>
          {#snippet icon()}<LockOpen size={18} />{/snippet}
          {busy ? t("open.unlocking") : r.reopening ? t("open.reopen") : t("open.unlock")}
        </Button>
        </div>
        <p class="trust"><ShieldCheck size={18} aria-hidden="true" /> <span>{t("open.trust")}</span></p>
      </div>
      <details class="private">
        <summary><span>{t("open.private")}</span><ChevronDown size={18} aria-hidden="true" /></summary>
        <ul>
          <li>{t("open.private.safari")}</li>
          <li>{t("open.private.chrome")}</li>
          <li>{t("open.private.firefox")}</li>
        </ul>
        <p>{t("open.private.limit")}</p>
      </details>
    {:else if r.state === "destroyed_by_password"}
      <p class="intro">{t("open.destroyedByPw.body")}</p>
      <p><a class="send" href={href("/")} onclick={(e) => followLink(e, "/")}>{t("invalid.send")}</a></p>
    {:else if gone.cause !== null}
      <GoneScreen cause={gone.cause} finishing={gone.finishing} />
    {:else if end !== null}
      <Ended kind={end} />
    {:else if r.state === "open" && r.opened}
      <Content
        opened={r.opened}
        {expired}
        {gone}
        onforget={() => r.forgetHere()}
        {endsAt}
        onend={(k) => {
          end = k;
          r.forget(); // clés déjà effacées ; le contenu déchiffré n'est plus référencé
        }}
      />
    {/if}
  </section>
{/if}

<style>
  .open {
    width: min(100%, 760px);
    margin-inline: auto;
    padding: var(--sp-6) var(--sp-4) var(--sp-8);
    display: grid;
    gap: var(--sp-5);
    min-width: 0;
  }

  /* ---------- Capsule (M6) ---------- */
  .capsule {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    min-width: 0;
    padding: var(--sp-5);
    border-radius: var(--r-2xl);
    background: var(--vessel);
    box-shadow: var(--edge-hi), var(--e-vessel);
  }
  .capsule[data-state="destroyed"] {
    background: transparent;
    box-shadow: none;
    padding-inline: 0;
  }
  .art {
    flex: none;
    display: block;
  }
  .capsule.bar {
    position: sticky;
    inset-block-start: calc(64px + var(--sp-2));
    z-index: 5;
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-xl);
    background: var(--glass);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    backdrop-filter: blur(20px) saturate(1.2);
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .capsule.bar {
      background: var(--surface-1);
    }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .capsule.bar {
      background: var(--surface-1);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
  /* Fin de lecture : la capsule se replie (pointillés si détruite) au-dessus du message. */
  .capsule.spent {
    align-self: start;
    justify-self: start;
    padding: var(--sp-2);
    border-radius: var(--r-pill);
  }
  .capsule.spent .lockbox {
    width: 64px;
    height: 40px;
  }
  .lockbox {
    flex: none;
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border-radius: var(--r-lg);
    background: var(--accent-tint);
    color: var(--accent);
  }
  .bar .lockbox {
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
  }
  .cap-tx {
    display: grid;
    gap: var(--sp-1);
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--fs-screen);
    font-stretch: var(--wd-screen);
    line-height: 1.1;
    letter-spacing: -0.02em;
    text-wrap: balance;
  }
  .title:focus {
    outline: none;
  }
  .avail,
  .banner {
    margin: 0;
    color: var(--text-2);
  }
  .banner {
    color: var(--text);
    font-size: var(--fs-small);
  }
  @media (max-width: 759px) {
    .cost {
      font-size: var(--fs-small);
      line-height: var(--lh-small);
    }
  }
  .num {
    font-variant-numeric: tabular-nums;
  }

  /* ---------- Déverrouillage ---------- */
  .intro {
    margin: 0;
    color: var(--text-2);
    max-width: 60ch;
  }
  .unlock {
    display: grid;
    gap: var(--sp-3);
    max-width: 520px;
  }
  .cta {
    justify-self: start;
  }
  /* Téléphone, façon app : « Déverrouiller » pleine largeur, collé en bas (zone du pouce) ;
     dans le flux quand le clavier est ouvert (base.css, .dock), juste sous le champ. */
  @media (max-width: 899px) {
    .cta {
      justify-self: stretch;
      z-index: 4;
      margin-inline: calc(-1 * var(--sp-4));
      padding: var(--sp-3) var(--sp-4) calc(var(--sp-3) + env(safe-area-inset-bottom, 0px));
      background: linear-gradient(to top, var(--bg) 72%, transparent);
    }
    .cta :global(.btn) {
      width: 100%;
      min-height: 56px;
      border-radius: 14px;
      font-size: 1.0625rem;
    }
    :global(html.kbd-open) .cta {
      padding-block: var(--sp-2);
      background: none;
    }
  }
  .fl {
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .box {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 60px;
    padding: 4px 6px 4px var(--sp-4);
    border-radius: 14px;
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .box.bad {
    box-shadow: inset 0 0 0 1px var(--danger);
  }
  .box:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .in {
    flex: 1;
    min-width: 0;
    height: 50px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: max(1.0625rem, 16px);
    outline: none;
  }
  .ib {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }
  .ib:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    .ib:hover {
      color: var(--text);
      background: var(--surface-3);
    }
  }
  .err {
    margin: 0;
    color: var(--danger);
    display: grid;
    gap: var(--sp-1);
  }
  .err p {
    margin: 0;
  }
  @media (prefers-reduced-motion: no-preference) {
    .err {
      animation: err-in var(--dur-fast) var(--ease-out);
    }
  }
  @keyframes err-in {
    from {
      opacity: 0;
    }
  }
  .small {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  .cost {
    margin: 0;
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    background: var(--warn-tint);
    color: var(--warn);
    font-weight: 520;
  }
  .trust {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .trust :global(svg) {
    flex: none;
    color: var(--accent);
    margin-top: 1px;
  }

  /* ---------- Navigation privée (demande du propriétaire) ---------- */
  .private {
    max-width: 60ch;
    color: var(--text-2);
    font-size: var(--fs-small);
    border-top: 1px solid var(--line);
    padding-top: var(--sp-4);
  }
  .private summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    list-style: none;
    cursor: pointer;
    color: var(--text);
    font-weight: 560;
  }
  .private summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--r-sm);
  }
  .private summary::-webkit-details-marker {
    display: none;
  }
  .private summary :global(svg) {
    flex: none;
    color: var(--text-2);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .private[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  .private ul {
    margin: var(--sp-2) 0;
    padding-left: var(--sp-5);
    display: grid;
    gap: var(--sp-1);
  }
  .private p {
    margin: 0;
  }

  /* ---------- Navigateur intégré ---------- */
  .inapp {
    display: grid;
    gap: var(--sp-4);
    padding: var(--sp-4);
    border-radius: var(--r-lg);
    background: var(--warn-tint);
  }
  .warn-tx {
    margin: 0;
    display: flex;
    gap: var(--sp-2);
    color: var(--warn);
  }
  .warn-tx :global(svg) {
    flex: none;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .send {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent);
    text-underline-offset: 0.2em;
  }
  @media (max-width: 480px) {
    .capsule {
      padding: var(--sp-4);
      gap: var(--sp-3);
    }
    .lockbox {
      width: 52px;
      height: 52px;
    }
    .title {
      font-size: var(--fs-h1);
    }
    /* Détruit (5 essais, faible de l'audit) : l'illustration au-dessus du titre, qui garde la
       largeur de l'écran au lieu de s'écraser à côté. */
    .capsule[data-state="destroyed"]:not(.spent) {
      flex-direction: column;
      align-items: flex-start;
    }
  }
  @media (forced-colors: active) {
    .capsule {
      border: 1px solid CanvasText;
    }
    .capsule[data-state="destroyed"] {
      border: 0;
    }
  }
</style>
