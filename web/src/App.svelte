<script lang="ts">
  import { inAppBrowser, isSupported } from "./app/env";
  import { guardFileDrop, reloadIfRestored } from "./app/lifecycle";
  import { readLink, scrubAddressBar, type LinkState } from "./app/link";
  import { href, router } from "./app/router.svelte";
  import { watchKeyboard } from "./app/viewport";
  import Home from "./routes/Home.svelte";
  import NotFound from "./routes/NotFound.svelte";
  import Unsupported from "./routes/Unsupported.svelte";
  import AppShell from "./ui/AppShell.svelte";

  // UI §9 : vérifié une fois, avant toute route. Sans ces capacités, aucune route ne démarre
  // (ni lecture du lien, ni requête).
  const supported = isSupported(globalThis);

  // UI §12.2 : une page restaurée du cache « page précédente » est rechargée.
  reloadIfRestored(window);

  const standalone = () =>
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  /**
   * UI §12.1 : au démarrage d'une route /s/ ou /m/, le lien est lu, puis le « # » et la requête
   * sont retirés de l'adresse et de l'historique. Sur toute autre route (404 comprise : lien
   * abîmé « /s/{id}/#… », « /S/… », hors base de démo), un « # » non vide est retiré aussi.
   * Exception : navigateur intégré (S4), où le « # » reste pour « Ouvrir dans le navigateur ».
   * Le résultat contient le secret : il est rendu à l'appelant, jamais rangé ici. Task 20 le
   * remet par valeur au flux de la route (createReceiver, gestion).
   */
  function enterLinkRoute(): LinkState | null {
    const r = router.current;
    const linkRoute = r.name === "open" || r.name === "manage";
    const state = linkRoute ? readLink(location.href, r.name === "open" ? "s" : "m") : null;
    if ((linkRoute || location.hash !== "") && inAppBrowser(navigator.userAgent, standalone()) === null) {
      // Chemin non nu (« //x », « \ ») : repli sur l'accueil plutôt que garder le « # ».
      if (!scrubAddressBar(history, location.pathname)) scrubAddressBar(history, href("/"));
    }
    return state;
  }

  // Changement de route, et « # » collé dans la barre sur la même page (navigation de fragment,
  // sans rechargement ni changement de route).
  $effect(() => {
    void router.current;
    if (supported) enterLinkRoute();
  });
  function onHashChange() {
    if (supported) enterLinkRoute();
  }

  // UI §9.2.2 : hors du composeur, un fichier déposé ne fait jamais naviguer l'onglet.
  // Task 10/11 : allow() vrai sur l'accueil hors envoi.
  $effect(() => guardFileDrop(window, () => false));

  // UI §9 : clavier virtuel ouvert → classe kbd-open sur <html> (barres collées dans le flux).
  $effect(() => watchKeyboard(window, (open) => document.documentElement.classList.toggle("kbd-open", open)));
</script>

<svelte:window onhashchange={onHashChange} />

<AppShell>
  {#if !supported}
    <Unsupported />
  {:else if router.current.name === "notfound"}
    <NotFound />
  {:else if router.current.name === "home"}
    <Home />
  {:else}
    <!-- Écrans des tâches suivantes : ouverture, gestion, sécurité, confidentialité. -->
    <h1 tabindex="-1">Shhdrop</h1>
  {/if}
</AppShell>
