<script lang="ts">
  import { untrack } from "svelte";
  import { getDemo } from "./app/demo-hooks";
  import { inAppBrowser, isStandalone, isSupported } from "./app/env";
  import { guardFileDrop, reloadIfRestored } from "./app/lifecycle";
  import { readLink, scrubAddressBar, type LinkState } from "./app/link";
  import { href, router } from "./app/router.svelte";
  import { watchKeyboard } from "./app/viewport";
  import Manage from "./routes/Manage.svelte";
  import NotFound from "./routes/NotFound.svelte";
  import Open from "./routes/Open.svelte";
  import SendFlow from "./routes/SendFlow.svelte";
  import Unsupported from "./routes/Unsupported.svelte";
  import AppShell from "./ui/AppShell.svelte";

  // UI §9 : vérifié une fois, avant toute route. Sans ces capacités, aucune route ne démarre
  // (ni lecture du lien, ni requête).
  const supported = isSupported(globalThis);

  // Démo GitHub Pages seulement (UI §14.3) : bandeau permanent ; null en production.
  const demo = getDemo();

  // Task 17 : vrai pendant un envoi et sur « Lien prêt » (langue figée, dépôt de fichier ignoré).
  let sending = $state(false);

  // UI §12.2 : une page restaurée du cache « page précédente » est rechargée.
  reloadIfRestored(window);

  /**
   * UI §12.1, spec §32 : le lien d'ouverture ou de gestion (racine avec un « # » de la bonne
   * forme) est lu par l'écran lui-même, au moment où il se monte (take), puis le « # » et la
   * requête sont retirés de l'adresse et de l'historique. Le secret n'est rangé dans aucun état
   * réactif ni global : il passe par valeur à la fermeture de l'écran.
   * - Ouverture : createReceiver le retire juste après la lecture, sauf dans un navigateur
   *   intégré (S4, jusqu'à « Continuer ici quand même »).
   * - Gestion : retiré ici, à la lecture (sauf navigateur intégré).
   * - Toute autre route (accueil avec un « # » mal formé, 404, hors base de démo) : un « # » non
   *   vide est retiré aussi.
   */
  const inApp = () => inAppBrowser(navigator.userAgent, isStandalone(window)) !== null;
  function scrubHere(): void {
    // Chemin non nu (« //x », « \ ») : repli sur l'accueil plutôt que garder le « # ».
    if (!scrubAddressBar(history, location.pathname)) scrubAddressBar(history, href("/"));
  }
  const takeShare = (): LinkState => readLink(location.href, "s");
  function takeManage(): LinkState {
    const l = readLink(location.href, "m");
    if (!inApp()) scrubHere();
    return l;
  }
  // Un nouveau lien collé sur la même route (navigation de fragment) remonte l'écran.
  let linkGen = $state(0);

  function onRoute(): void {
    const name = router.current.name;
    if (name === "open" || name === "manage") return; // l'écran lit et nettoie lui-même
    if (location.hash !== "" && !inApp()) scrubHere();
  }
  let lastRoute = router.current;
  $effect(() => {
    lastRoute = router.current;
    if (supported) untrack(onRoute);
  });
  // « # » collé dans la barre sur la même page : relu par un écran neuf s'il garde la même route
  // d'ouverture ou de gestion (le changement de route, lui, monte déjà un écran neuf) ; retiré
  // ailleurs. Un « # » déjà retiré ne relance rien.
  function onHashChange() {
    if (!supported || location.hash === "") return;
    const r = router.current;
    const same = r === lastRoute;
    lastRoute = r;
    if ((r.name === "open" || r.name === "manage") && same) linkGen++;
    else onRoute();
  }

  // UI §9.2.2 : hors de l'accueil, un fichier déposé ne fait jamais naviguer l'onglet. Sur
  // l'accueil, Home reçoit le dépôt (voile pleine page), sauf pendant un envoi.
  $effect(() => guardFileDrop(window, () => supported && router.current.name === "home" && !sending));

  // UI §9 : clavier virtuel ouvert → classe kbd-open sur <html> (barres collées dans le flux).
  $effect(() => watchKeyboard(window, (open) => document.documentElement.classList.toggle("kbd-open", open)));
</script>

<svelte:window onhashchange={onHashChange} />

{#snippet demoBanner()}
  {#if demo}<demo.Banner />{/if}
{/snippet}

<AppShell banner={demo ? demoBanner : undefined} langLocked={sending}>
  {#if !supported}
    <Unsupported />
  {:else if router.current.name === "notfound"}
    <NotFound />
  {:else if router.current.name === "home"}
    <!-- Accueil, puis composeur dès le premier élément (UI §9.1, §9.2). Coffre : jamais en démo (spec §27.6). -->
    <SendFlow vaultAllowed={demo === null} onbusy={(b) => (sending = b)} />
  {:else if router.current.name === "open"}
    {#key linkGen}<Open take={takeShare} />{/key}
  {:else if router.current.name === "manage"}
    {#key linkGen}<Manage take={takeManage} />{/key}
  {:else}
    <!-- Écrans des tâches suivantes : sécurité, confidentialité. -->
    <h1 tabindex="-1">Shhdrop</h1>
  {/if}
</AppShell>
