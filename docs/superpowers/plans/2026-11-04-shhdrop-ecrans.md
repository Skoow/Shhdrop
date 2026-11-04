# Shhdrop — Plan 2 : les écrans

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une PWA Svelte 5, en français et en anglais, dans le monde visuel « Nuit chiffrée », qui permet de composer, chiffrer, envoyer, gérer, ouvrir, lire, enregistrer, détruire et signaler un partage, en s'appuyant uniquement sur l'API cliente du Plan 1, servie par le serveur Go sous la CSP stricte de la spec, et vérifiée par des parcours Playwright sur Chromium et WebKit (téléphone et ordinateur) avec captures, contrôle d'accessibilité et garde « aucune violation CSP, aucune ressource tierce ».

**Architecture:** `web/src/index.ts` (API du Plan 1, durcie) reste la seule porte vers la crypto et le réseau. Au-dessus : `web/src/ui/` (jetons, composants, mouvement), `web/src/routes/` (écrans), `web/src/i18n/`, `web/src/media/` (vocal, retrait des métadonnées), `web/src/viewers/` (visionneuses, PDF isolé), `web/src/app/` (routeur, hygiène du lien, cycle de vie de la page). La logique vit dans des fichiers `.ts` / `.svelte.ts` testés par Vitest ; les composants `.svelte` restent minces. Deux entrées Vite : `index.html` (l'application) et `pdf-frame.html` (visionneuse PDF isolée, script classique IIFE). Le serveur Go sert `web/dist` (`SHH_STATIC_DIR`) avec repli SPA.

**Tech Stack:** Svelte 5.57.3, `@sveltejs/vite-plugin-svelte` 7.3.1, Vite 8.3.5, TypeScript 7.0.2 (+ `svelte-check` 4.7.8 sur TypeScript 6.0.3 dans un paquet outil séparé), Vitest 5.1.0, `@playwright/test` 1.64.1, `@axe-core/playwright` 4.14.0, `altcha` 2.3.0, `pdfjs-dist` 6.5.438, `@lucide/svelte` 1.68.0, `uqr` 0.1.3, polices Mona Sans et JetBrains Mono (Fontsource 5.3.0, fichiers copiés). Go 1.26 pour le serveur statique.

**Spec:** `docs/superpowers/specs/2026-11-04-shhdrop-ui-design.md` (notée « UI ») et `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (notée « spec »). Lire UI §0, §1, §7, §9, §12 et spec §2, §5, §10, §12, §13, §18, §19, §21, §24 avant toute tâche.

## Global Constraints

- **Aucune crypto ni aucun appel réseau hors de `web/src/index.ts`.** Les écrans n'importent jamais `transfer/api.ts`, `crypto/*` ni `fetch` (sauf `fetch` indirect via l'API). Un test de recherche dans les sources le vérifie (Task 1).
- `expectedOrigin` = `location.origin` partout.
- Le serveur ne reçoit jamais de contenu, de nom, de clé ni de mot de passe en clair : le test « le serveur ne voit rien » du Plan 1 doit rester vert ; la Task 23 l'étend au parcours dans le navigateur.
- **Aucune ressource tierce** (polices, icônes, scripts, styles, images : tout est servi par le serveur) ; aucun `data:` ; `build.assetsInlineLimit: 0`.
- **CSP** de la spec §10 inchangée : aucun script ni style en ligne, aucun attribut `style` statique dans les gabarits, aucun `eval` / `new Function`, aucun `{@html}`. Toute violation détectée en e2e fait échouer le test.
- Aucun stockage navigateur (`localStorage`, `sessionStorage`, IndexedDB, cookies) ; aucun secret dans la console, le titre ou l'URL après `replaceState` (sauf exception navigateur intégré, UI §1 S4).
- `translate="no"`, attributs de saisie de UI §12.3, aucune balise `<form>` sur l'envoi et l'ouverture.
- Choix de visionneuse par `previewKind(i)` seulement, nom par `safeName(i)` seulement, téléchargement en `application/octet-stream` seulement.
- Accessibilité : WCAG 2.1 AA en sombre et en clair ; zones tactiles ≥ 44 px ; `prefers-reduced-motion` respecté (UI §7.5).
- Jamais « 100 % sécurisé ».
- Versions exactes (sans `^` ni `~`), `npm ci` reproductible, `npm audit --omit=dev --audit-level=high` sans alerte, licences dans `THIRD_PARTY_LICENSES.md`.
- On n'annonce une tâche finie qu'avec la sortie des tests (et les captures quand l'écran change).
- Commits : `git commit --author="Skoow <190851638+Skoow@users.noreply.github.com>" -m "…"` (aucune surcharge de `user.*`), poussés sur `origin plan-2-ecrans` à la fin de chaque tâche.

## Review Focus

1. **Le lien ne fuit pas** : après chargement de `/s/…#k` et `/m/…#s`, `location.hash === ""`, l'historique ne contient plus le `#`, aucune requête ne porte `K_lien`/`S_gestion` (Task 5, Task 23).
2. **Le contenu reçu ne s'exécute jamais** : SVG avec script, HTML, PDF avec JavaScript ouverts dans les visionneuses → aucune exécution, aucune navigation, aucune violation CSP (Task 17, Task 18).
3. **Retour arrière** : après « Retour », la page recharge et ne montre plus rien du contenu déchiffré (Task 5, Task 23).
4. **Enregistrement interrompu** : erreur pendant `saveItem` → `writable.abort()` appelé, jamais « Enregistré » (Task 19).
5. **Fin de vie** : détruire en état `draining` (`maxOpens = 1`) fonctionne ou dit la vérité ; la dissolution n'est jouée qu'après la réponse (Task 20).
6. **Métadonnées** : JPEG d'iPhone avec MPF et image secondaire → plus aucune trace GPS/appareil, orientation et ICC intacts, données de l'image identiques à l'octet (Task 8).

---

## Prérequis (avant la Task 1)

- `plan-1c-durcissement` fusionnée dans `main`, avec les exports de `web/src/index.ts` décrits en UI §0.1.
- Questions UI §17 tranchées ou défauts acceptés. Si Q5 est acceptée, `Opened.destroy(reason)` et `keepalive` sur `done` sont livrés par la branche de durcissement ; sinon, la Task 20 utilise le repli UI §9.10.
- Branche : `plan-2-ecrans` (elle porte déjà les deux documents), rebasée sur `main` après la fusion.

## Structure des fichiers

```
web/index.html                          # entrée de l'application (aucun script/style en ligne)
web/pdf-frame.html                      # entrée de la visionneuse PDF isolée
web/vite.config.ts                      # Svelte, deux entrées, assetsInlineLimit 0, IIFE pour le cadre PDF
web/playwright.config.ts                # projets chromium/webkit × ordinateur/téléphone
web/tools/svelte-check/package.json     # svelte-check 4.7.8 + typescript 6.0.3 (S5)
web/public/fonts/*.woff2                # polices copiées (Task 3)
web/public/assets/grain.png             # tuile de bruit de la dissolution (Task 3)
web/public/icon*.png|svg, manifest.webmanifest, robots.txt, apple-touch-icon.png
web/scripts/copy-fonts.mjs | gen-grain.mjs | gen-icons.mjs | gen-fixtures.mjs
web/src/main.ts                         # montage de l'application
web/src/App.svelte                      # coque + routeur
web/src/app/router.svelte.ts            # routes, navigation interne
web/src/app/link.ts                     # lecture du lien + replaceState (UI §12.1)
web/src/app/lifecycle.ts                # pagehide / pageshow, beforeunload d'envoi (UI §12.2)
web/src/app/env.ts                      # navigateur pris en charge, navigateur intégré, mémoire
web/src/i18n/fr.ts | en.ts | i18n.svelte.ts | format.ts
web/src/ui/tokens.css | fonts.css | base.css | motion.ts | contrast.ts
web/src/ui/*.svelte                     # composants (UI §8)
web/src/media/strip.ts | jpeg.ts | png.ts | webp.ts | recorder.ts | kinds.ts
web/src/routes/Home.svelte | Compose.svelte | Options.svelte | Sealing.svelte | Ready.svelte
web/src/routes/Manage.svelte | Open.svelte | Content.svelte | Invalid.svelte | Page*.svelte
web/src/flows/send.svelte.ts            # machine à états de l'envoi (phases UI §9.4)
web/src/flows/receive.svelte.ts         # machine à états de l'ouverture et du contenu
web/src/viewers/blobs.ts                # TYPE_SUR, URL blob suivies et révoquées
web/src/viewers/save.ts                 # showSaveFilePicker / repli Blob
web/src/viewers/pdf-host.ts | pdf-frame/main.ts | pdf-frame/frame.css
web/src/captcha/altcha.ts               # solveCaptcha via le widget
web/src/qr/qr.ts                        # matrice uqr → chemins SVG
web/ui-e2e/fixtures.ts                  # serveur Go par test, gardes CSP / tierces, axe, captures
web/ui-e2e/*.spec.ts                    # parcours
web/ui-e2e/files/                       # fichiers piégés et médias de test (générés)
server/internal/api/static.go | static_test.go   # serveur statique + repli SPA
```

---

### Task 1 : Socle Svelte, Vite, contrôles de sources

**Files:**
- Create: `web/index.html`, `web/src/main.ts`, `web/src/App.svelte`, `web/vite.config.ts`, `web/tools/svelte-check/package.json`, `web/src/source-rules.test.ts`
- Modify: `web/package.json`, `web/tsconfig.json`, `web/vitest.config.ts`, `Makefile`, `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:**
- Produces: scripts npm `build` (`vite build`), `check` (`tsc --noEmit` + `svelte-check` de l'outil), `test` (inchangé, élargi à `src/**`), `test:ui` (`playwright test`). Cible `make test-ui`.

- [ ] **Step 1 : Tests qui échouent.** `source-rules.test.ts` parcourt `web/src/**/*.{ts,svelte}` (hors `crypto/`, `transfer/`, `index.ts`, tests) et échoue si : `{@html` ; `style="` dans un `.svelte` ; `eval(` ou `new Function` ; `import` de `../transfer/api`, `../crypto/` ou `fetch(` dans `routes/`, `ui/`, `flows/`, `viewers/`, `media/` ; `localStorage|sessionStorage|indexedDB|document.cookie` ; `console.log`. Plus un test qui lit `vite.config.ts` résolu et vérifie `assetsInlineLimit === 0` et `modulePreload.polyfill === false`.
- [ ] **Step 2 : Lancer** `cd web && npm test -- source-rules` → ÉCHEC (configuration absente).
- [ ] **Step 3 : Implémenter.** Installer en versions exactes (`npm i -E`) : `svelte@5.57.3` ; dev : `@sveltejs/vite-plugin-svelte@7.3.1`, `@playwright/test@1.64.1`, `@axe-core/playwright@4.14.0`. `vite.config.ts` : plugin Svelte, `build.assetsInlineLimit: 0`, `build.modulePreload: { polyfill: false }`, `build.sourcemap: false`, entrée `index.html`. `index.html` : `<html lang="fr" translate="no">`, `<meta name="google" content="notranslate">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, un seul `<script type="module" src="/src/main.ts">`, aucune balise `og:*`. `tsconfig` : `types: ["node", "svelte"]`, inclure `src/**/*.svelte.ts`. `web/tools/svelte-check/package.json` : `svelte-check@4.7.8`, `typescript@6.0.3`, `svelte@5.57.3` exacts ; script `check` = `svelte-check --workspace ../.. --tsconfig ../../tsconfig.json --fail-on-warnings`. CI : job `web` ajoute `npm run build && npm run check` ; job `ui` (après `go` et `web`) : `npx playwright install --with-deps chromium webkit && make test-ui`, captures téléversées comme artefact. `.gitignore` : `web/ui-e2e/__captures__/`, `web/test-results/`, `web/playwright-report/`.
- [ ] **Step 4 : Lancer** `npm test && npm run build && npm run check` → SUCCÈS ; `dist/index.html` ne contient aucun `<script>` sans `src` ni `<style>`.
- [ ] **Step 5 : Commit** « feat(web): socle Svelte 5 + Vite, règles de sources » et push.

---

### Task 2 : Serveur statique Go et banc Playwright

**Files:**
- Create: `server/internal/api/static.go`, `server/internal/api/static_test.go`, `web/playwright.config.ts`, `web/ui-e2e/fixtures.ts`, `web/ui-e2e/shell.spec.ts`
- Modify: `server/cmd/shhdrop/main.go` (utilise `api.Static(dir)` au lieu de `http.FileServerFS`), `server/internal/api/headers.go` (en-têtes par chemin)

**Interfaces:**
- Produces (Go) : `func Static(dir string) (http.Handler, error)` — erreur si `dir` n'est pas un dossier absolu contenant `index.html`.
- Produces (TS) : fixture Playwright `shh` = `{ origin, server: TestServer, cspViolations: string[], foreignRequests: string[] }`, un serveur Go neuf **par test** (`startServer({ env: { SHH_STATIC_DIR: <web/dist absolu> } })` de `web/e2e/server.ts`) ; à la fin de chaque test, `expect(cspViolations).toEqual([])` et `expect(foreignRequests).toEqual([])`. Helpers `capture(page, nom)` (écrit `ui-e2e/__captures__/<projet>/<nom>.png` après stabilisation des animations) et `axe(page)` (règles `wcag2a, wcag2aa, wcag21a, wcag21aa`, attend zéro violation).

- [ ] **Step 1 : Tests Go qui échouent** (`static_test.go`) : `TestStaticRefusesMissingIndex` ; `TestStaticServesFile` (`/assets/x.js` → 200) ; `TestStaticNoDirListing` (`/assets/` → 404) ; `TestStaticNoDotfiles` (`/.env`, `/assets/.x` → 404) ; `TestStaticSPAFallback` (`/`, `/s/abc`, `/m/abc`, `/securite`, `/confidentialite` → 200 + contenu de `index.html`) ; `TestStaticUnknownRoute404` (`/nimporte` → 404 + `index.html`) ; `TestStaticNoIndexHeader` (`/s/abc`, `/m/abc` → `X-Robots-Tag: noindex`) ; `TestStaticPdfFrameCORP` (`/pdf-frame.js` → `Cross-Origin-Resource-Policy: cross-origin`, tout autre fichier → `same-origin`) ; `TestStaticKeepsSecurityHeaders` (CSP et `no-store` présents).
- [ ] **Step 2 : Lancer** `cd server && go test ./internal/api/ -run Static` → ÉCHEC.
- [ ] **Step 3 : Implémenter** `Static` : `os.DirFS`, refus de tout segment commençant par « . », `Stat` : dossier → 404, fichier → `http.ServeFileFS` ; routes SPA par motifs exacts (`/s/{id}` et `/m/{id}` sur un seul segment). `withHeaders` laisse `static.go` remplacer `Cross-Origin-Resource-Policy` pour les trois fichiers du cadre PDF (liste fermée). `main.go` : sans `SHH_STATIC_DIR`, la page d'attente actuelle ; avec, `Static` ou arrêt du démarrage.
- [ ] **Step 4 : Tests Playwright qui échouent** (`shell.spec.ts`) : « la page d'accueil répond sous la CSP, sans violation ni requête tierce » ; « `/s/x` et `/m/x` servent l'application » ; « `<html translate="no">` et meta notranslate présents ». `playwright.config.ts` : projets `chromium-desktop` (Desktop Chrome, 1440 × 900), `webkit-desktop` (Desktop Safari), `chromium-mobile` (Pixel 7), `webkit-mobile` (iPhone 15) ; `globalSetup` = `go build -o server/shhdrop ./cmd/shhdrop` + `npm run build`. La garde CSP : `page.addInitScript` qui écoute `securitypolicyviolation` et pousse `violatedDirective + blockedURI` dans un tableau lu à la fin ; plus `page.on("console")` pour les messages « Refused to ». La garde tierce : `page.on("request")`, toute URL dont l'origine n'est ni `shh.origin` ni `blob:` est enregistrée.
- [ ] **Step 5 : Lancer** `go test ./... && cd ../web && npx playwright test shell` → SUCCÈS sur les quatre projets.
- [ ] **Step 6 : Commit** « feat(server): serveur statique sûr, repli SPA ; banc Playwright » et push.

---

### Task 3 : Polices, icônes, jetons, grain

**Files:**
- Create: `web/scripts/copy-fonts.mjs`, `web/scripts/gen-grain.mjs`, `web/public/fonts/mona-sans-latin-standard-normal.woff2`, `web/public/fonts/jetbrains-mono-latin-wght-normal.woff2`, `web/public/assets/grain.png`, `web/src/ui/fonts.css`, `web/src/ui/tokens.css`, `web/src/ui/base.css`, `web/src/ui/contrast.ts`, `web/src/ui/tokens.test.ts`, `web/src/ui/Icon.ts`
- Modify: `web/package.json`, `THIRD_PARTY_LICENSES.md`, `web/index.html` (préchargement de Mona Sans)

**Interfaces:**
- Produces : `contrast(a: string, b: string): number` (formule WCAG) ; `tokens.css` avec **exactement** les jetons de UI §3, §4.2, §5, §7.2 sous `:root` (sombre) et `@media (prefers-color-scheme: light)` ; `Icon.ts` qui réexporte nommément les icônes de la liste fermée UI §6 depuis `@lucide/svelte`.

- [ ] **Step 1 : Tests qui échouent** (`tokens.test.ts`) : `contrast("#FFFFFF", "#000000")` ≈ 21 ; chaque paire de UI §3.3 lue dans `tokens.css` (analyse des déclarations `--nom: #hex`) atteint son seuil, en sombre et en clair ; les deux `.woff2` existent et leurs SHA-256 valent ceux de UI §4.1 ; `fonts.css` ne contient que des `url(/fonts/…)` ; `grain.png` fait 128 × 128 (lecture de l'en-tête IHDR) ; `Icon.ts` n'exporte que les noms de UI §6.
- [ ] **Step 2 : Lancer** `npm test -- tokens` → ÉCHEC.
- [ ] **Step 3 : Implémenter.** Dev : `@fontsource-variable/mona-sans@5.3.0`, `@fontsource-variable/jetbrains-mono@5.3.0` ; dépendance : `@lucide/svelte@1.68.0`. `copy-fonts.mjs` copie les deux fichiers de `node_modules/.../files/` vers `public/fonts/`. `gen-grain.mjs` : bruit déterministe (xorshift32, graine `0x5348`), PNG niveaux de gris écrit avec `node:zlib` (sans dépendance). `fonts.css` : `@font-face` « Mona Sans » (`font-weight: 200 900; font-stretch: 75% 125%`) et « JetBrains Mono » (`100 800`), `font-display: swap`, `unicode-range` du sous-ensemble latin. `base.css` : `body` sur `--bg`, champ lumineux d'ambiance (UI §2), `::selection`, `caret-color: var(--accent)`, barres de défilement (`scrollbar-color`), anneau de focus, `text-underline-offset: 0.2em`, `font-variant-numeric: tabular-nums` sur `.num`. Vérifier dans le navigateur que Mona Sans applique `tnum` (capture d'une rangée « 1111 / 8888 » alignée) ; sinon, `.num` passe en JetBrains Mono et UI §4.2 est mise à jour. `THIRD_PARTY_LICENSES.md` : OFL 1.1 (Mona Sans, JetBrains Mono), ISC (Lucide).
- [ ] **Step 4 : Lancer** `npm test && npm run build` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): polices hébergées, jetons Nuit/Aube vérifiés, icônes, grain » et push.

---

### Task 4 : Coque, routeur, i18n, formats, annonces

**Files:**
- Create: `web/src/app/router.svelte.ts`, `web/src/app/router.test.ts`, `web/src/i18n/fr.ts`, `web/src/i18n/en.ts`, `web/src/i18n/i18n.svelte.ts`, `web/src/i18n/format.ts`, `web/src/i18n/i18n.test.ts`, `web/src/ui/AppShell.svelte`, `web/src/ui/LiveRegion.svelte`, `web/src/ui/announce.ts`, `web/src/routes/NotFound.svelte`, `web/ui-e2e/i18n.spec.ts`

**Interfaces:**
- Produces : `match(pathname): { name: "home" | "open" | "manage" | "securite" | "confidentialite" | "notfound"; id?: string }` ; `navigate(path)` (pushState + focus du titre) ; `t(key, params?)` typé sur les clés de `fr.ts` ; `setLang("fr" | "en")`, `detectLang(navigator.languages)` ; `formatDuration(seconds, lang)`, `formatBytes(n, lang)` (base 1024, « Mo »/« Go », « MB »/« GB »), `plural(lang, n, forms)` ; `announce(text)` (file d'attente, au plus une annonce par seconde).

- [ ] **Step 1 : Tests qui échouent.** Routeur : `/s/AbC_-1` → `open`, id ; `/s/` et `/s/a/b` → `notfound` ; `/m/x` → `manage`. i18n : `en.ts` a toutes les clés de `fr.ts` (test de type + test d'exécution) ; aucune valeur vide ; dans les chaînes FR, chaque « : », « ; », « ! », « ? » est précédé de U+202F et aucun « ≈ » ni « 100 % sécurisé » ; `detectLang(["fr-CA","en"])` = `fr`, `detectLang(["de"])` = `en`. Formats : `formatDuration(15300, "fr")` = « 4 h 15 », `720` → « 12 min », `45` → « 45 s », `30` en FR avec option `coarse` → « moins d'une minute » ; `formatBytes(35651584, "fr")` = « 34 Mo » ; `formatBytes(1073741824, "fr")` = « 1 Go ». e2e : la bascule de langue change `<html lang>` et le titre ; pas de stockage (`localStorage.length === 0` après bascule).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter.** Toutes les clés de UI §10 et celles des écrans (§9) dans `fr.ts` (référence) et `en.ts` (`satisfies`). `AppShell` : lien d'évitement, en-tête (logo SVG, bascule de langue), `<main id="contenu" tabindex="-1">`, pied (Sécurité, Confidentialité), verre au défilement (`IntersectionObserver` sur une sentinelle, pas d'écouteur `scroll`). Liens internes interceptés par le routeur (clic gauche sans modificateur).
- [ ] **Step 4 : Lancer** `npm test && npx playwright test i18n` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): coque, routeur, i18n FR/EN, formats » et push.

---

### Task 5 : Hygiène du lien, cycle de vie, environnement

**Files:**
- Create: `web/src/app/link.ts`, `web/src/app/link.test.ts`, `web/src/app/lifecycle.ts`, `web/src/app/lifecycle.test.ts`, `web/src/app/env.ts`, `web/src/app/env.test.ts`, `web/src/routes/Unsupported.svelte`, `web/ui-e2e/hygiene.spec.ts`

**Interfaces:**
- Produces :
  ```ts
  type LinkState = { kind: "s" | "m"; link: string } | { kind: "incomplete" };
  readLink(href: string, expected: "s" | "m"): LinkState;          // parseLink + contrôle du préfixe
  scrubAddressBar(h: History, pathname: string): void;              // replaceState(null, "", pathname)
  onPageHide(cb: () => void): () => void;                            // pagehide
  reloadIfRestored(w: Window): void;                                 // pageshow persisted → reload
  guardUnload(active: () => boolean): () => void;                    // beforeunload pendant l'envoi
  isSupported(g: typeof globalThis): boolean;                        // UI §9.11
  inAppBrowser(ua: string, standalone: boolean): string | null;      // nom de l'app ou null
  lowMemory(n: Navigator, size: number): boolean;                    // UI §9.8
  ```

- [ ] **Step 1 : Tests qui échouent.** `readLink` : lien `/s/` valide → `{kind:"s"}` ; sans `#` → `incomplete` ; lien de gestion sur la route d'ouverture → `incomplete`. `scrubAddressBar` appelle `replaceState` avec le chemin seul. `inAppBrowser` : table de 12 agents réels (Instagram iOS/Android, FBAN/FBAV, FB_IAB, Messenger, LinkedInApp, Snapchat, `musical_ly`, `BytedanceWebview`, Line, Telegram, `MicroMessenger`) → nom ; Safari iOS, Chrome Android, Firefox, Edge, Samsung Internet → `null` ; tout agent avec `standalone = true` → `null`. `isSupported` faux sans `crypto.subtle`, `WebAssembly`, `Blob.prototype.stream`. `guardUnload` : `preventDefault` seulement si `active()`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter**, puis brancher dans `App.svelte` : `reloadIfRestored` au démarrage ; vérification `isSupported` avant toute route (sinon `Unsupported`).
- [ ] **Step 4 : e2e** (`hygiene.spec.ts`) : ouvrir `/s/<id>#<clé>` (lien créé via l'API dans Node) → `location.hash === ""` et `history.length` ne permet pas de revenir à l'URL avec `#` (`page.goBack()` ne réaffiche pas le `#`) ; même chose pour `/m/` ; avec l'agent Instagram (`browser.newContext({ userAgent })`) le `#` reste jusqu'au clic « Continuer ici quand même ». Navigateur sans `crypto.subtle` (`addInitScript` qui le retire) → écran « non pris en charge », aucune requête `/api/`.
- [ ] **Step 5 : Lancer** `npm test && npx playwright test hygiene` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): hygiène du lien, bfcache, navigateur intégré » et push.

---

### Task 6 : Composants de base

**Files:**
- Create: `web/src/ui/Button.svelte`, `IconButton.svelte`, `TextField.svelte`, `TextArea.svelte`, `Segmented.svelte`, `Stepper.svelte`, `CopyField.svelte`, `Banner.svelte`, `InlineConfirm.svelte`, `Sheet.svelte`, `CapacityGauge.svelte`, `ItemRow.svelte`, `Countdown.svelte`, `web/src/ui/countdown.ts`, `web/src/ui/countdown.test.ts`, `web/src/ui/clipboard.ts`, `web/src/ui/clipboard.test.ts`, `web/src/ui/motion.ts`, `web/src/ui/motion.test.ts`

**Interfaces:**
- Produces : `createCountdown(expiresInS, now = performance.now)` → `{ remaining(): number; display(lang): string; announceAt(): number[] }` (seuils 3600, 900, 300, 60, 0 ; rafraîchissement visuel : 60 s au-delà d'1 h, 1 s sous 5 min) ; `copyText(text)` → `"copied" | "manual"` ; `clearClipboard()` ; `reducedMotion(): boolean`, `flip(els, mutate): Promise<void>` (WAAPI, ne fait rien en mouvement réduit).

- [ ] **Step 1 : Tests qui échouent.** Compte à rebours avec horloge injectée : affichage et seuils d'annonce exacts, pas de valeur négative, `0` → expiré. `copyText` : succès → `copied` ; `writeText` rejeté → `manual`. `flip` : `matchMedia` « reduce » → aucune animation créée (espion sur `Element.prototype.animate`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** les composants selon UI §8 : états complets, `IconButton` exige `label` (type requis), `Segmented` en `radiogroup` avec flèches, `Stepper` borné, `CopyField` tronque au milieu (CSS `text-overflow` sur deux moitiés) et copie la valeur entière, `Sheet` sur `<dialog>` + `showModal()`, `Banner` `role` selon `tone`. Aucun attribut `style` : valeurs dynamiques par `style:--var={…}`.
- [ ] **Step 4 : Lancer** `npm test && npm run check` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): composants de base » et push.

---

### Task 7 : Accueil (en-tête Persuade)

**Files:**
- Create: `web/src/routes/Home.svelte`, `web/src/ui/Schema.svelte`, `web/public/logo.svg`, `web/ui-e2e/home.spec.ts`

- [ ] **Step 1 : e2e qui échoue** (`home.spec.ts`) : le titre UI §9.1 est visible ; sur `chromium-mobile` et `webkit-mobile`, la rangée « Fichiers / Photo / Vocal / Texte » est dans le premier écran (`boundingBox().y + height <= 844`) ; `axe` sans violation en sombre et en clair ; le schéma est un `<svg>` avec `role="img"` et `aria-label` ; en mouvement réduit, aucune animation en cours (`document.getAnimations().length === 0` après 100 ms) ; captures `home-dark`, `home-light`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.1 : titre `--fs-display`, `font-stretch: 118%`, phrase, schéma SVG (tracé `stroke-dashoffset` une fois, 600 ms), lien « Comment ça marche ». Le composeur (Task 9) se monte dessous ; d'ici là, un emplacement vide.
- [ ] **Step 4 : Lancer** → SUCCÈS ; relire les captures.
- [ ] **Step 5 : Commit** « feat(ui): accueil » et push.

---

### Task 8 : Retrait des métadonnées (JPEG, PNG, WebP)

**Files:**
- Create: `web/src/media/jpeg.ts`, `png.ts`, `webp.ts`, `strip.ts`, `kinds.ts`, `strip.test.ts`, `kinds.test.ts`, `web/scripts/gen-fixtures.mjs`, `web/src/media/fixtures/*` (générés, commités)

**Interfaces:**
- Produces :
  ```ts
  type Stripped = { ok: true; data: Uint8Array<ArrayBuffer>; mime: string } | { ok: false; reason: "malforme" };
  stripMetadata(bytes: Uint8Array, mime: string): Stripped;   // JPEG, PNG, WebP seulement
  cleanStatus(mime: string, name: string): "nettoyable" | "video" | "photo_non_nettoyee" | "pdf" | "document" | "texte";
  ```

- [ ] **Step 1 : Fixtures.** `gen-fixtures.mjs` (sans dépendance) produit : `iphone-like.jpg` = SOI + APP1 EXIF (Orientation = 6, Make « ReperMake », GPS « 48.85 » en repère, miniature JPEG) + APP1 XMP (« ReperXMP ») + APP2 ICC_PROFILE (profil factice de 600 octets, 2 morceaux) + APP2 MPF + APP13 + COM + APP14 Adobe + données d'une petite image réelle (8 × 8, encodée par `ffmpeg` une fois et figée dans le script en base64) + EOI + **seconde image JPEG avec son propre EXIF « ReperSecond »** ; `meta.png` (iCCP, tEXt « ReperPNG », eXIf, tIME) ; `meta.webp` (VP8X avec drapeaux EXIF+XMP, ICCP, EXIF « ReperWEBP », XMP).
- [ ] **Step 2 : Tests qui échouent.** JPEG : aucune des chaînes repères dans la sortie ; orientation lue = 6 ; les deux morceaux ICC identiques à l'octet ; APP14 présent ; le flux compressé (de SOS à EOI) identique à l'octet ; rien après le premier EOI ; sortie décodable (`createImageBitmap` dans un test e2e court, Task 9). PNG : chunks texte/eXIf/tIME absents, iCCP présent, CRC valides. WebP : EXIF/XMP absents, drapeaux VP8X corrigés, taille RIFF = longueur − 8, ICCP présent. Fichiers tronqués ou marqueurs incohérents → `{ok:false}` (jamais d'exception, jamais de sortie partielle). `cleanStatus` : `video/*` → `video` ; HEIC/AVIF/GIF → `photo_non_nettoyee` ; PDF → `pdf` ; autres → `document`.
- [ ] **Step 3 : Lancer** `npm test -- strip kinds` → ÉCHEC.
- [ ] **Step 4 : Implémenter** des analyseurs à bornes vérifiées (chaque longueur lue contrôlée contre la taille restante), en ne copiant que les segments conservés. EXIF réécrit : en-tête TIFF petit-boutiste, IFD0 à une entrée (0x0112), aucun IFD suivant.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(media): retrait des métadonnées sans réencodage (JPEG MPF compris) » et push.

---

### Task 9 : Composer

**Files:**
- Create: `web/src/routes/Compose.svelte`, `web/src/flows/compose.svelte.ts`, `web/src/flows/compose.test.ts`, `web/src/ui/DropZone.svelte`, `web/ui-e2e/compose.spec.ts`, `web/ui-e2e/files/` (photo, vidéo courte, PDF, 10 petits fichiers, fichier de 1 Go creux généré à la volée)

**Interfaces:**
- Produces : `createComposer()` → `{ items: ComposeItem[]; totalBytes; count; add(files: File[]): Promise<AddResult[]>; addText(text): void; addVoice(blob, mime): void; remove(id): void; blockReason(): null | "vide" | "trop_d_elements" | "trop_gros" | "texte_trop_long"; toApiItems(): Item[] }` avec `ComposeItem = { id; kind: "file" | "text"; name; mime; size; data: Blob | Uint8Array; clean: ReturnType<typeof cleanStatus> | "nettoye" }`. `CONTENT_MAX = 1073741824 - 65540`.

- [ ] **Step 1 : Tests qui échouent** (`compose.test.ts`) : ajout d'un JPEG → donnée remplacée par la version nettoyée, `clean = "nettoye"` ; JPEG malformé → refusé avec raison ; 11ᵉ élément → `trop_d_elements` ; total > `CONTENT_MAX` → `trop_gros` ; texte de 10 001 points de code → `texte_trop_long` ; liste vide → `vide` ; `toApiItems` ne lit jamais un `File` en entier (le `File` d'origine est passé tel quel pour les non-images).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.2 : boutons d'ajout, `DropZone` (glisser-déposer sur ordinateur), `TextArea` (attributs UI §12.3), liste `ItemRow` avec badges, `CapacityGauge`, messages de blocage, bouton Continuer. Les images > 50 Mo ne sont pas lues en mémoire pour le nettoyage : elles passent en « non nettoyée » avec avertissement (une photo de cette taille n'existe pas en pratique ; borne de mémoire).
- [ ] **Step 4 : e2e** (`compose.spec.ts`) : ajouter photo, texte, PDF → jauge « … / 1 Go · 3 / 10 », badges attendus ; retirer un élément au clavier (Tab + Entrée sur `x`) ; 11 fichiers → message ; fichier creux de 1 Go + 1 octet → bouton bloqué avec la raison ; `axe` ; captures `compose-filled` (sombre, clair).
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): composer (fichiers, photo nettoyée, texte, limites) » et push.

---

### Task 10 : Vocal

**Files:**
- Create: `web/src/media/recorder.ts`, `web/src/media/recorder.test.ts`, `web/src/ui/VoiceRecorder.svelte`, `web/ui-e2e/voice.spec.ts`

**Interfaces:**
- Produces : `pickMime(isSupported: (t: string) => boolean): { mime: string; ext: "m4a" | "webm" } | null` (ordre : `audio/mp4;codecs=mp4a.40.2`, `audio/mp4`, `audio/webm;codecs=opus`, `audio/webm`) ; `startRecording()` → `{ stop(): Promise<Blob>; level(): number; elapsedMs(): number; cancel(): void }`.

- [ ] **Step 1 : Tests qui échouent** : `pickMime` respecte l'ordre ; rien de supporté → `null` (le bouton Vocal est masqué).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.2 (états refus, enregistrement, écoute, garder/recommencer) ; les pistes du micro sont arrêtées (`track.stop()`) dès la fin ; nom « Vocal {n}.{ext} ».
- [ ] **Step 4 : e2e** sur Chromium (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, permission `microphone`) : enregistrer 2 s → élément « Vocal 1 » de taille > 0 ; refus de permission → message. WebKit : test marqué `fixme` si le faux micro n'est pas disponible, et ligne ajoutée à la liste de vérification manuelle (spec §14).
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(media): enregistrement vocal » et push.

---

### Task 11 : Options et phrase de passe

**Files:**
- Create: `web/src/routes/Options.svelte`, `web/src/flows/options.svelte.ts`, `web/src/flows/options.test.ts`, `web/src/ui/PassphraseField.svelte`, `web/src/ui/PasswordChecklist.svelte`, `web/ui-e2e/options.spec.ts`

**Interfaces:**
- Produces : `createOptions()` → `{ ttlHours: 1|6|12|24; maxOpens: number; mode: "generated" | "custom"; password: string; regenerate(): void; setCustom(pw: string): void; check(): PwCheck }` (défauts 24 h, 1, phrase de 4 mots).

- [ ] **Step 1 : Tests qui échouent** : défauts ; `regenerate` change la phrase (4 mots, tirets, minuscules) ; `setCustom("court")` → `trop_court` ; un mot de la liste noire de 12 caractères → `trop_courant` ; `maxOpens` borné à [1, 10].
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.3 ; sur ordinateur (≥ 960 px), Composer et Options côte à côte, Options collées en haut à droite (`position: sticky`).
- [ ] **Step 4 : e2e** : flèches clavier dans la durée ; Stepper 1 → 10 et pas au-delà ; mot de passe personnel trop court → bouton bloqué et message relié (`aria-describedby`) ; le champ porte les attributs UI §12.3 ; aucune `<form>` dans la page ; `axe` ; captures `options`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): options, phrase de passe, indicateur honnête » et push.

---

### Task 12 : Anti-robot (widget ALTCHA hébergé)

**Files:**
- Create: `web/src/captcha/altcha.ts`, `web/src/captcha/altcha.test.ts`, `web/src/captcha/altcha.css` (thème), `web/ui-e2e/captcha.spec.ts`
- Modify: `web/package.json`, `web/vite.config.ts` (copie de `dist_external/worker.js` et `altcha.css` sous `/assets/altcha/`), `THIRD_PARTY_LICENSES.md`

**Interfaces:**
- Produces : `solveCaptcha(host: HTMLElement, lang: "fr" | "en"): (challenge: unknown) => Promise<string>`.

- [ ] **Step 1 : Vérification de version (bloquante).** `npm view altcha version` (attendu 3.5.0 ou plus) ; dans le paquet de la dernière version, chercher la lecture de `maxNumber` dans `dist/external/altcha.js`. Si elle est absente (constat du 4 novembre 2026), la dernière version ne lit pas les défis v1 d'`altcha-lib-go` v1.0.0 : installer `altcha@2.3.0` (`-E`) et noter l'écart (UI S3). Si une version 3.x la lit, l'épingler à la place et adapter les étapes suivantes. Contrôler aussi dans la version retenue : aucun `eval`/`new Function`, aucune requête réseau quand `challengejson` est fourni, styles dans `altcha.css` seulement.
- [ ] **Step 2 : Tests qui échouent** (`altcha.test.ts`, unitaire) : `solveCaptcha` refuse un défi dont `algorithm !== "SHA-256"` ; e2e (`captcha.spec.ts`) : sur une page de l'application, résolution d'un vrai défi de `GET /api/captcha` → charge utile base64 dont le JSON contient `number` et le `salt` reçu ; aucune requête hors origine ; aucune violation CSP ; le widget est retiré du DOM après résolution.
- [ ] **Step 3 : Lancer** → ÉCHEC.
- [ ] **Step 4 : Implémenter** : import de `altcha/dist_external/altcha.js` (chemin de la version retenue) ; création de `<altcha-widget>` par `document.createElement`, `configure({ challengejson, auto: "onload", hidelogo: true, hidefooter: true, workers: 2, strings })` ou attributs équivalents de la v2 ; promesse résolue sur `statechange` (`verified`, `payload`), rejetée sur `error`/`expired`, délai maximal 60 s. Couleurs par variables CSS du widget reprises des jetons.
- [ ] **Step 5 : Lancer** → SUCCÈS sur les quatre projets.
- [ ] **Step 6 : Commit** « feat(captcha): widget ALTCHA hébergé, compatible altcha-lib-go v1 » et push.

---

### Task 13 : Scellement et envoi

**Files:**
- Create: `web/src/flows/send.svelte.ts`, `web/src/flows/send.test.ts`, `web/src/routes/Sealing.svelte`, `web/src/ui/SealCapsule.svelte`, `web/src/ui/seal.css`, `web/ui-e2e/send.spec.ts`

**Interfaces:**
- Consumes : `createShare`, `solveCaptcha`, `createComposer().toApiItems()`, `createOptions()`.
- Produces : `createSender(deps = { createShare, now })` → `{ phase: "idle" | "key" | "captcha" | "upload" | "stalled" | "finalize" | "sealed" | "error"; done: number; total: number; error?: SendError; result?: { link; manage; expiresInS; password }; start(items, opts): Promise<void>; retry(): Promise<void> }`, avec `SendError = "reseau" | "interrompu" | "limite" | "sature" | "gele" | "captcha" | "fichier_modifie" | "inattendu"` et `retryAfterS` pour `limite`.

- [ ] **Step 1 : Tests qui échouent** (`send.test.ts`, `createShare` simulé) : enchaînement des phases (`key` → `captcha` à l'appel de `solveCaptcha` → `upload` à `onProgress(0,n)` → `finalize` à `onProgress(n,n)` → `sealed`) ; `stalled` après 15 s sans progrès (horloge injectée) et retour à `upload` au progrès suivant ; correspondance des erreurs (UI §9.4) dont `Error("bad_request")` → **un** nouvel appel complet de `createShare` puis `captcha` ; `NotReadableError` → `fichier_modifie` ; `retry()` rappelle `createShare` (jamais de réutilisation d'un résultat partiel) ; le mot de passe n'est conservé que dans `result`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §7.3 et §9.4 : capsule avec `<svg><rect pathLength="100">`, trait indéterminé (animation CSS), progression (`style:--p`), flou des noms, regroupement FLIP (`flip()`), fermeture du sceau en WAAPI (`animate().finished` enchaînés), variante mouvement réduit, `role="progressbar"` + `aria-valuetext`, annonces tous les 10 %. `guardUnload` actif de `key` à `finalize`. Événement `offline` → `stalled`.
- [ ] **Step 4 : e2e** (`send.spec.ts`, vrai serveur) : envoi texte + photo → phases visibles dans l'ordre, capsule à 100 %, écran Lien prêt ; réseau coupé 5 s au milieu d'un envoi de 20 Mo (`context.setOffline(true)` puis `false`) → bandeau `stalled` puis succès ; serveur arrêté pendant l'envoi → « Le transfert a été interrompu, réessayez » ; `beforeunload` armé pendant l'envoi seulement (`page.on("dialog")`) ; captures `seal-progress`, `seal-sealed` (mouvement réduit pour la stabilité) ; aucune violation CSP.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): scellement et envoi (phases, reprise, erreurs) » et push.

---

### Task 14 : Lien prêt

**Files:**
- Create: `web/src/routes/Ready.svelte`, `web/src/qr/qr.ts`, `web/src/qr/qr.test.ts`, `web/src/ui/QrCode.svelte`, `web/ui-e2e/ready.spec.ts`
- Modify: `web/package.json` (`uqr@0.1.3`), `THIRD_PARTY_LICENSES.md`

**Interfaces:**
- Produces : `qrPath(text: string): { size: number; d: string }` (matrice `encode(text, { ecc: "M", border: 2 })` de `uqr` → un seul chemin SVG, un carré par module noir) ; `QrCode` chargé par `import()` dynamique.

- [ ] **Step 1 : Tests qui échouent** : `qrPath` d'un lien de 80 caractères → `size` attendu par la version QR, `d` ne contient que `M`, `h`, `v`, `z` et des nombres ; décodage de contrôle dans l'e2e avec `BarcodeDetector` si disponible (Chromium), sinon comparaison à la matrice.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.5 : trois `CopyField`, Partager (`navigator.share({ url })` seulement), QR sur demande (feuille sur téléphone), Vider le presse-papier, mention « plus jamais affichées », Terminé + `InlineConfirm`, effacement de l'état (chaînes oubliées, références nulles).
- [ ] **Step 4 : e2e** : copier le lien → presse-papier = lien entier (permission `clipboard-read` sur Chromium) ; copier le mot de passe ; `navigator.share` simulé reçoit `{ url }` sans mot de passe ; Vider → presse-papier vide ; Terminé → composeur vide, et ni le lien ni le mot de passe ne sont présents dans `document.body.innerText` ; `axe` ; captures `ready`, `ready-qr`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): lien prêt (copie, partage, QR, presse-papier) » et push.

---

### Task 15 : Page de gestion

**Files:**
- Create: `web/src/routes/Manage.svelte`, `web/src/flows/manage.svelte.ts`, `web/src/flows/manage.test.ts`, `web/src/ui/Dissolve.svelte`, `web/src/ui/dissolve.css`, `web/ui-e2e/manage.spec.ts`

**Interfaces:**
- Produces : `createManager(link, deps = { shareStatus, destroyShare })` → `{ state: "loading" | "ready" | "draining" | "uploading" | "gone" | "error"; status?; refresh(); destroy() }` ; `Dissolve` : composant enveloppe, `play(): Promise<void>` (résout à la fin ou tout de suite en mouvement réduit).

- [ ] **Step 1 : Tests qui échouent** : `NotFoundError` → `gone` ; `destroy` → appel puis `gone` seulement après la réponse ; `LimitError` → pas de relecture avant `retryAfterS` ; relecture suspendue quand `document.visibilityState === "hidden"`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.6 et la dissolution UI §7.4 (`@property --d`, masque à trois couches, préfixes WebKit, repli `@supports`).
- [ ] **Step 4 : e2e** : partage créé, ouvert une fois sur trois via l'API → « Ouvert 1 / 3 · Expire dans … » ; Détruire → confirmation → dissolution → « Supprimé », focus sur le message ; lien de gestion d'un partage inexistant → « Supprimé » ; capture en milieu de dissolution (`page.clock` ou animation mise en pause via `getAnimations()[0].pause()`), et `dissolve-end` ; `axe`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): gestion du partage, dissolution » et push.

---

### Task 16 : Ouverture

**Files:**
- Create: `web/src/routes/Open.svelte`, `web/src/routes/Invalid.svelte`, `web/src/flows/receive.svelte.ts`, `web/src/flows/receive.test.ts`, `web/ui-e2e/open.spec.ts`

**Interfaces:**
- Produces : `createReceiver(link, deps = { fetchMeta, openShare })` → `{ state: "meta" | "inapp" | "locked" | "unlocking" | "open" | "invalid" | "incomplete" | "error"; expiresInS; attemptsLeft?; retryAfterS?; opened?: Opened; continueHere(); unlock(password): Promise<void> }`. Le mot de passe qui a déverrouillé est gardé dans une variable non réactive, oubliée par `forget()` (utilisé par la Task 20).

- [ ] **Step 1 : Tests qui échouent** : `fetchMeta` → `NotFoundError` → `invalid` ; `Error("lien_invalide")` → `invalid` ; `BadPasswordError(3)` → `locked` + `attemptsLeft = 3` ; `BadPasswordError(1)` → avertissement « dernier essai » ; `LimitError(120)` → `retryAfterS` ; succès → `open` ; navigateur intégré → `inapp` puis `locked` après `continueHere()`, et `scrubAddressBar` n'est appelé qu'à ce moment.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.7 et §9.11 : squelette, compte à rebours, champ (attributs UI §12.3, Entrée par `keydown`), note sur le coût d'une ouverture, bandeau navigateur intégré, écrans invalide et incomplet.
- [ ] **Step 4 : e2e** : mauvais mot de passe deux fois → « 3 essais restants » ; cinq fois → écran invalide et le partage n'existe plus (`fetchMeta` en Node → `NotFoundError`) ; bon mot de passe → contenu ; lien sans `#` → « Lien incomplet » sans aucune requête `/api/` ; lien d'un partage détruit → message unique ; agent Instagram → bandeau, « Copier le lien » donne le lien **avec** sa clé ; `axe` ; captures `open`, `open-badpw`, `open-inapp`, `invalid`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): ouverture, essais, navigateur intégré, liens invalides » et push.

---

### Task 17 : Contenu et visionneuses natives

**Files:**
- Create: `web/src/routes/Content.svelte`, `web/src/viewers/blobs.ts`, `web/src/viewers/blobs.test.ts`, `web/src/viewers/collect.ts`, `web/src/viewers/collect.test.ts`, `web/src/viewers/ImageViewer.svelte`, `AudioViewer.svelte`, `VideoViewer.svelte`, `TextViewer.svelte`, `web/ui-e2e/content.spec.ts`, `web/ui-e2e/files/trap.svg`, `trap.html`

**Interfaces:**
- Produces : `TYPE_SUR` (UI §9.8) et `safeBlobType(kind, manifestMime): string | null` ; `trackUrl(blob): string` / `revokeAll()` (registre unique, vidé au `pagehide`) ; `collectPreview(opened, i, onBytes): Promise<Blob>` (via `saveItem`, tranches mises à zéro après assemblage) ; `PREVIEW_MAX = 200 * 1048576`, `AUTO_IMAGE_MAX = 20 * 1048576`.

- [ ] **Step 1 : Tests qui échouent** : `safeBlobType("image", "text/html")` → `null` ; `("video", "video/quicktime")` → `video/quicktime` ; `("video", "application/x-evil")` → `video/mp4` ; `("none", …)` → `null` ; `collectPreview` rapporte les octets cumulés et met les tranches à zéro ; `revokeAll` révoque chaque URL suivie (espion sur `URL.revokeObjectURL`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.8 : bandeau collé (verre) avec compte à rebours et rappel « recharger consomme une ouverture », liste des éléments, règles d'aperçu par taille, image révoquée au `load`, vidéo après téléchargement complet, texte en `<pre>` avec `dir="auto"`, expiration pendant la lecture (boutons désactivés, bandeau), erreurs de lecture, alerte mémoire (`lowMemory`).
- [ ] **Step 4 : e2e** : partage texte + JPEG + MP3 + MP4 + `trap.svg` (script et `onload`) + `trap.html` → texte affiché ; image affichée sans action ; audio et vidéo lisibles (`readyState >= 2`) ; `trap.svg` affiché en `<img>`, `window.__pwned` jamais défini, l'URL blob de l'image n'est plus valide après `load` (`fetch(src)` échoue) ; `trap.html` → Enregistrer seulement ; `page.clock.fastForward` au-delà de l'expiration → bandeau « Expiré » et boutons désactivés ; navigation puis Retour → rechargement et aucun texte du partage dans la page (Review Focus 3) ; `axe` ; captures `content`, `content-image`, `content-expired`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(viewers): contenu, image/audio/vidéo/texte, URL blob maîtrisées » et push.

---

### Task 18 : PDF isolé (prototype bloquant, puis visionneuse)

**Files:**
- Create: `web/pdf-frame.html`, `web/src/viewers/pdf-frame/main.ts`, `web/src/viewers/pdf-frame/frame.css`, `web/src/viewers/pdf-host.ts`, `web/src/viewers/pdf-host.test.ts`, `web/src/viewers/PdfViewer.svelte`, `web/vite.pdf-frame.config.ts`, `web/ui-e2e/pdf.spec.ts`, `web/ui-e2e/files/js.pdf`, `web/ui-e2e/files/simple.pdf`
- Modify: `web/package.json` (`pdfjs-dist@6.5.438`, script `build` = deux builds), `THIRD_PARTY_LICENSES.md`

**Interfaces:**
- Produces : protocole de messages `{type:"ready"}` (cadre → parent), `{type:"pdf", bytes: ArrayBuffer, labels}` (parent → cadre, transféré), `{type:"rendered", pages:number} | {type:"error"}` (cadre → parent) ; `mountPdf(container, bytes, labels): Promise<"ok" | "fallback">`.

- [ ] **Step 1 : Prototype (bloquant).** Build séparé `vite.pdf-frame.config.ts` : entrée `src/viewers/pdf-frame/main.ts`, `build.lib` format `iife`, sortie `dist/pdf-frame.js` + `dist/pdf-frame.css` ; `main.ts` importe `pdfjs-dist/build/pdf.mjs` et `pdfjs-dist/build/pdf.worker.mjs` puis pose `globalThis.pdfjsWorker = { WorkerMessageHandler }`, `getDocument({ data, disableWorkerRendering: true, enableXfa: false, useWasm: false, isOffscreenCanvasSupported: false })`. Test e2e `pdf.spec.ts › prototype` sur Chromium **et** WebKit : `simple.pdf` → `rendered` avec 2 pages et un `<canvas>` non vide (pixel central non transparent, lu dans le cadre par le cadre lui-même et renvoyé en message) ; aucune violation CSP ; aucune requête sauf `pdf-frame.html/.js/.css`. **Décision** : si ce test échoue sur un moteur après correction raisonnable (une demi-journée), retirer la visionneuse PDF (`pdf` → Enregistrer seulement, UI §13), consigner la raison dans `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md`, et passer à la Task 19.
- [ ] **Step 2 : Tests qui échouent** (`pdf-host.test.ts`) : l'hôte ignore un `ready` dont `event.source` n'est pas le cadre ; envoie les octets **transférés** (l'`ArrayBuffer` source est détaché) ; délai de 20 s → `fallback` ; `error` → `fallback`.
- [ ] **Step 3 : Implémenter** UI §13 : `<iframe sandbox="allow-scripts">` (aucun autre jeton), cadre qui n'écoute que `window.parent`, rendu par page à la demande, commandes page/zoom, libellés passés par le parent.
- [ ] **Step 4 : e2e** : `js.pdf` (action `OpenAction` JavaScript qui tenterait `app.alert` et une navigation) → rendu sans exécution, aucune boîte de dialogue (`page.on("dialog")` jamais appelé), aucune navigation du cadre ; `iframe.sandbox` vaut exactement `allow-scripts` ; `contentWindow.origin === "null"` vu depuis le cadre (message) ; captures `pdf`.
- [ ] **Step 5 : Lancer** → SUCCÈS (ou repli consigné).
- [ ] **Step 6 : Commit** « feat(viewers): PDF isolé (pdf.js sans worker, cadre sandbox) » et push.

---

### Task 19 : Enregistrer (flux, repli Blob, fichiers à risque)

**Files:**
- Create: `web/src/viewers/save.ts`, `web/src/viewers/save.test.ts`, `web/src/ui/SaveButton.svelte`, `web/ui-e2e/save.spec.ts`

**Interfaces:**
- Produces : `saveItem(opened, i, deps = { showSaveFilePicker?, collectToBlob, click }, onBytes, signal): Promise<"saved" | "cancelled" | "failed">`.

- [ ] **Step 1 : Tests qui échouent** (dépendances simulées) : avec sélecteur → `suggestedName = opened.safeName(i)`, écriture de chaque tranche, `close()` puis `saved` ; erreur pendant `saveItem` → `abort()` appelé, `close()` jamais appelé, `failed` ; annulation par `signal` → `abort()`, `cancelled` ; `AbortError` du sélecteur → `cancelled` sans écriture ; sans sélecteur → `collectToBlob(opened, i)` puis clic sur `<a download>` avec `download = safeName(i)`, URL révoquée après 60 s (horloge injectée) ; aucun chemin n'utilise le type MIME du manifeste.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.9 : confirmation `isRiskyFile`, progression en octets, Annuler, messages d'échec, note « assemblé en mémoire » au-delà de 200 Mio sans sélecteur.
- [ ] **Step 4 : e2e** : Chromium ordinateur — `showSaveFilePicker` remplacé par un faux qui écrit dans un tableau (`addInitScript`) → octets identiques au fichier envoyé ; panne réseau simulée (`page.route` qui coupe le 2ᵉ segment, 5 essais épuisés) → `abort` appelé et message « fichier incomplet supprimé » ; WebKit et téléphones — événement `download` Playwright → fichier identique, nom nettoyé (`facture‮fdp.exe` → nom sans U+202E), avertissement de fichier à risque affiché avant ; fichier de 300 Mo → pas de bouton d'aperçu, Enregistrer seulement ; captures `save-progress`, `save-risky`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(viewers): enregistrement en flux, abandon du partiel, repli Blob » et push.

---

### Task 20 : Terminer, détruire, signaler

**Files:**
- Create: `web/src/flows/endoflife.ts`, `web/src/flows/endoflife.test.ts`, `web/src/ui/ReportSheet.svelte`, `web/ui-e2e/endoflife.spec.ts`
- Modify: `web/src/routes/Content.svelte`

**Interfaces:**
- Produces : `finish(opened)` (`done()` puis `wipe()` puis `revokeAll()`) ; `destroyFromContent(ctx, reason?)` → `"destroyed" | "draining_wiped" | "network"` : `opened.destroy(reason)` s'il existe, sinon `destroyShare(link, { password }, location.origin)` et, sur `NotFoundError`, `finish` + `draining_wiped` (UI §9.10).

- [ ] **Step 1 : Tests qui échouent** : avec `opened.destroy` → appelé avec le motif, puis `wipe` ; sans → `destroyShare` avec le mot de passe gardé ; `NotFoundError` → `done` + `wipe` + `draining_wiped` ; `Error("reseau")` → `network`, rien n'est effacé ; `forget()` du récepteur est appelé dans tous les cas terminaux ; la dissolution n'est demandée qu'après la résolution.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.8 (pied de liste) et §9.10 : Terminer et effacer, Détruire (`InlineConfirm`), Signaler (`Sheet` à trois motifs), `onPageHide` → `finish` (au mieux).
- [ ] **Step 4 : e2e** : `maxOpens = 3`, Détruire → « Ce partage a été détruit », `fetchMeta` en Node → `NotFoundError` ; `maxOpens = 1` (état `draining`), Détruire → message « détruit » si `Opened.destroy` existe, sinon message `draining_wiped`, et dans les deux cas le partage est effacé côté serveur après `done` (vérifié en Node) ; Signaler → motif choisi → partage détruit ; Terminer et effacer → dissolution, texte du partage absent de la page ; captures `destroy-confirm`, `report-sheet`, `destroyed`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): fin de vie (terminer, détruire, signaler) » et push.

---

### Task 21 : Pages Sécurité et Confidentialité, 404

**Files:**
- Create: `web/src/routes/PageSecurite.svelte`, `web/src/routes/PageConfidentialite.svelte`, `web/src/i18n/pages.fr.ts`, `web/src/i18n/pages.en.ts`, `web/ui-e2e/pages.spec.ts`

- [ ] **Step 1 : e2e qui échoue** : `/securite` contient les dix limites de la spec §18 (une par élément de liste), ne contient ni « 100 % » ni « sécurisé à » ; `/confidentialite` contient « aucun cookie » et la liste de la spec §9 ; route inconnue → « Cette page n'existe pas » et code HTTP 404 ; mesure ≤ 75 ch (largeur calculée / taille de police) ; `axe`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.12 (mode Read), textes FR et EN relus à partir de la spec, sans promesse supplémentaire.
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): pages sécurité, confidentialité, 404 » et push.

---

### Task 22 : PWA (manifeste, icônes, sans service worker)

**Files:**
- Create: `web/public/manifest.webmanifest`, `web/public/icon.svg`, `web/public/icon-192.png`, `web/public/icon-512.png`, `web/public/icon-maskable-512.png`, `web/public/apple-touch-icon.png`, `web/public/robots.txt`, `web/scripts/gen-icons.mjs`, `web/ui-e2e/pwa.spec.ts`
- Modify: `web/index.html`

- [ ] **Step 1 : e2e qui échoue** : `/manifest.webmanifest` répond, JSON conforme à UI §14.1 ; chaque icône répond avec la bonne taille (en-tête PNG) ; `navigator.serviceWorker.getRegistrations()` → `[]` après tout le parcours ; aucune balise `og:*` ; `theme-color` sombre et clair ; `robots.txt` interdit `/s/` et `/m/`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** : icône dessinée (capsule au contour ouvert, UI §6) en SVG, PNG produits par `gen-icons.mjs` (`rsvg-convert` ou `ffmpeg`, outil local) et commités ; balises dans `index.html`.
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(pwa): manifeste et icônes, sans service worker » et push.

---

### Task 23 : Parcours complets, « le serveur ne voit rien » côté navigateur, matrice de captures

**Files:**
- Create: `web/ui-e2e/full.spec.ts`, `web/ui-e2e/sees-nothing-ui.spec.ts`
- Modify: `web/ui-e2e/fixtures.ts`

- [ ] **Step 1 : Tests qui échouent.**
  - `full.spec.ts`, sur les quatre projets, en sombre et en clair, mouvement normal et réduit : expéditeur (composer texte + photo + PDF + vocal simulé, options, scellement, lien prêt, copie du lien et du mot de passe) → destinataire dans un **autre contexte** (ouverture, mauvais mot de passe une fois, déverrouillage, lecture de chaque élément, enregistrement d'un élément, Terminer et effacer) → expéditeur sur la page de gestion (« Ouvert 1 / 1 » ou « Supprimé »). `axe` à chaque écran ; captures nommées `<étape>-<thème>`.
  - Clavier seul (Chromium ordinateur) : le parcours expéditeur complet sans souris (Tab, Maj+Tab, Entrée, Espace, flèches).
  - Zoom : viewport 320 px et `font-size` racine à 24 px → aucun débordement horizontal (`scrollWidth <= clientWidth`) sur chaque écran.
  - `sees-nothing-ui.spec.ts` : texte « ReperContenuUI », fichier nommé « ReperNomUI.txt », mot de passe personnel « ReperMotDePasseUI » ; toutes les requêtes et réponses capturées (`page.on("request")`, corps compris, `route.fetch()` pour lire les corps) ne contiennent aucun repère, ni la `K_lien` du lien produit (en base64url) ; puis le contrôle du Plan 1 sur le dossier de données et les journaux du serveur (`web/e2e/scan.ts`).
- [ ] **Step 2 : Lancer** → ÉCHEC sur ce qui manque, corriger dans la tâche concernée (commit séparé par correction).
- [ ] **Step 3 : Lancer** `make test && make test-ui` → SUCCÈS ; joindre le nombre de tests et la liste des captures.
- [ ] **Step 4 : Commit** « test(ui): parcours complets, garde « le serveur ne voit rien » dans le navigateur » et push.

---

### Task 24 : Contrôle visuel (impeccable) et DESIGN.md

**Files:**
- Create: `DESIGN.md` (racine, écrit depuis le monde construit), `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md` (si pas déjà créé)
- Modify: fichiers d'interface selon les constats

- [ ] **Step 1 : Détecteur.** `sh /root/.claude/skills/synced/10dfe987-33c2-4162-9258-91020c952592_4f3a0d7a-b152-48de-b27e-2ae49c652950/impeccable/scripts/impeccable detect --json web/src/ui web/src/routes web/src/viewers web/index.html` ; corriger tout constat mécanique ; consigner les autres avec leur justification dans le fichier de décisions.
- [ ] **Step 2 : Passage « craft floor »** sur les captures de la Task 23 (un seul passage groupé) : contrastes, ombres décalées, espacements (plus au-dessus des titres), mesure du texte, un seul moment de mouvement par geste, états complets, surfaces du navigateur thémées (sélection, curseur, barres de défilement, anneau de focus, chiffres tabulaires), textes dans la langue du produit, couverture de chaque exigence de UI §9. Interdits vérifiés : pas d'étiquette au-dessus des titres, pas de texte en dégradé, pas de bord gauche coloré épais, pas de verre décoratif, pas d'emoji en guise d'icône, pas de halo sans décalage.
- [ ] **Step 3 : Corriger**, relancer `make test-ui`, refaire les captures (deuxième et dernier passage).
- [ ] **Step 4 : DESIGN.md** : jetons et règles **tels que construits** (couleurs, typographie, espacements, rayons, élévation, verre, mouvement, composants), écarts éventuels avec UI §3–§8 signalés au propriétaire, pas corrigés en silence.
- [ ] **Step 5 : Liste de vérification manuelle** ajoutée au fichier de décisions (spec §14 « Manuels ») : iPhone et Android réels — photo (orientation), vocal croisé, vidéo d'iPhone sur Android, PDF, mauvais mot de passe, expiration, destruction, installation PWA, VoiceOver/TalkBack, aucun gestionnaire de mots de passe qui propose d'enregistrer, navigateur intégré d'Instagram.
- [ ] **Step 6 : Commit** « docs(ui): DESIGN.md, contrôle visuel, liste manuelle » et push. Préparer la fusion (superpowers:finishing-a-development-branch).
