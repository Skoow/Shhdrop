# Shhdrop — Plan 2 : les écrans

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une PWA Svelte 5, en français et en anglais, dans le monde visuel « Nuit chiffrée » (toujours sombre), qui permet de composer (glisser-déposer, coller, catégories, ordre), chiffrer, envoyer (progression réelle, pause, annulation, reprise), gérer, ouvrir, lire, enregistrer, détruire et signaler un partage, en s'appuyant uniquement sur l'API cliente (`web/src/index.ts`, complétée en Task 0), servie par le serveur Go sous la CSP stricte de la spec, avec un anti-robot par preuve de travail maison et un repli reCAPTCHA isolé sur une autre origine ; une démo publiée sur GitHub Pages dès le premier écran ; le tout vérifié par des parcours Playwright sur Chromium et WebKit (téléphone et ordinateur) avec captures, contrôle d'accessibilité et garde « aucune violation CSP, aucune ressource tierce ».

**Architecture:** `web/src/index.ts` reste la seule porte vers la crypto et le réseau. Au-dessus : `web/src/ui/` (jetons, composants, mouvement), `web/src/routes/` (écrans), `web/src/flows/` (machines à états testées), `web/src/i18n/`, `web/src/media/` (vocal, métadonnées, catégories), `web/src/captcha/` (preuve de travail, cadre de repli), `web/src/viewers/`, `web/src/app/` (routeur, lien, cycle de vie, environnement), `web/src/demo/` (faux serveur, **absent du build de production**). Logique dans des `.ts` / `.svelte.ts` testés par Vitest ; composants `.svelte` minces. Entrées Vite : `index.html` (application), `pdf-frame.html` (cadre PDF, IIFE), `verif/index.html` (page de vérification, build séparé). Mode `demo` : `base: "/Shhdrop/"`, sortie `dist-demo/`. Le serveur Go sert `web/dist` (`static.go`, déjà sur `main`).

**Tech Stack:** Svelte 5.57.3, `@sveltejs/vite-plugin-svelte` 7.3.1, Vite 8.3.5, TypeScript 7.0.2 (+ `svelte-check` 4.7.8 sur TypeScript 6.0.3 dans un paquet outil séparé), Vitest 5.1.0, `@playwright/test` 1.64.1, `@axe-core/playwright` 4.14.0, `pdfjs-dist` 6.5.438, `@lucide/svelte` 1.68.0, `uqr` 0.1.3, polices Mona Sans et JetBrains Mono (Fontsource 5.3.0, fichiers copiés). Go 1.26.

**Spec:** `docs/superpowers/specs/2026-11-04-shhdrop-ui-design.md` (notée « UI ») et `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (notée « spec »). Lire UI §0, §7, §9, §12, §14.3, §15, §18 et spec §2, §5, §7.4, §10, §12, §13, §18, §19, §21, §24, §25 avant toute tâche.

## Global Constraints

- **Tout le travail se fait sur `main`** (CLAUDE.md) : aucune branche ; tests au vert avant chaque push ; `git push origin main` à la fin de chaque tâche (ce qui republie la démo, Task 8).
- **Aucune crypto ni aucun appel réseau hors de `web/src/index.ts`** (et de `web/src/transfer/` en Task 0). Les écrans n'importent jamais `transfer/api.ts`, `crypto/*` ni `fetch` ; seul `src/demo/` remplace `fetch`/`XMLHttpRequest`, et seulement en mode démo. Contrôlé par un test de recherche dans les sources (Task 1).
- `expectedOrigin` = `location.origin` partout.
- Le serveur ne reçoit jamais de contenu, de nom, de clé ni de mot de passe en clair : le test « le serveur ne voit rien » du Plan 1 reste vert ; la Task 27 l'étend au navigateur.
- **Aucune ressource tierce** sur les pages de l'application (polices, icônes, scripts, styles, images : tout est servi par le serveur) ; aucun `data:`. Seule exception, et seulement dans les Tasks 15–16 : le document du cadre de vérification, servi par l'origine `SHH_VERIF_ORIGIN`, chargé après consentement (UI §15).
- **CSP** de la spec §10 inchangée, sauf `frame-src 'self' {SHH_VERIF_ORIGIN}` quand le repli est activé. Aucun script ni style en ligne, aucun attribut `style` statique, aucun `eval` / `new Function`, aucun `{@html}`. Toute violation détectée en e2e fait échouer le test.
- Aucun stockage navigateur ; aucun secret dans la console, le titre, l'URL après `replaceState` (sauf exception navigateur intégré, UI S4), ni dans un `postMessage`.
- `translate="no"`, attributs de saisie de UI §12.3, aucune balise `<form>` sur l'envoi et l'ouverture.
- Visionneuse par `previewKind(i)`, nom par `safeName(i)`, téléchargement en `application/octet-stream` seulement.
- **Un seul thème, sombre** (UI §0.2 P1) : pas de jetons, tests ni captures en clair.
- Accessibilité : WCAG 2.1 AA ; zones tactiles ≥ 44 px ; `prefers-reduced-motion` et `forced-colors` respectés.
- Jamais « 100 % sécurisé ».
- Versions exactes, `npm ci` reproductible, `npm audit --omit=dev --audit-level=high` sans alerte, licences dans `THIRD_PARTY_LICENSES.md`.
- On n'annonce une tâche finie qu'avec la sortie des tests (et les captures quand l'écran change).
- Commits : `git commit --author="Skoow <190851638+Skoow@users.noreply.github.com>" -m "…"` (aucune surcharge de `user.*`).
- **Démo à jour** : à partir de la Task 8, toute tâche qui change un écran finit par `npm run build:demo && node scripts/check-dist.mjs && npx playwright test --project=demo` (SUCCÈS exigé) avant le push.

## Review Focus

1. **Le lien ne fuit pas** : après `/s/…#k` et `/m/…#s`, `location.hash === ""`, l'historique ne contient plus le `#`, aucune requête ne porte `K_lien`/`S_gestion` (Tasks 5, 27).
2. **Le contenu reçu ne s'exécute jamais** : SVG avec script, HTML, PDF avec JavaScript → aucune exécution, aucune navigation, aucune violation CSP (Tasks 21, 22).
3. **Google n'approche pas les clés** : aucune requête vers Google depuis le cadre principal ; le cadre de vérification n'a qu'une autre origine ; le jeton n'est accepté que de `event.origin === fallbackOrigin && event.source === iframe.contentWindow` ; rien ne se charge avant le clic de consentement (Tasks 15, 16).
4. **Le code de démo est absent de la production** (Task 8, `check-dist.mjs` en CI).
5. **Annuler et quitter** : annulation et `pagehide` pendant l'envoi détruisent le partage créé (`keepalive`) ; jamais « Lien prêt » avant la résolution de `createShare` (Tasks 0, 17).
6. **Reprise réelle** : une coupure de 60 s pendant l'envoi ne perd pas l'envoi ; une pause est bornée à 10 min (Tasks 0, 17).
7. **Enregistrement interrompu** : `writable.abort()`, jamais « Enregistré » (Task 23).
8. **Métadonnées** : JPEG d'iPhone avec MPF et image secondaire → aucune trace GPS/appareil, orientation et ICC intacts (Task 9).

---

## Prérequis

- Durcissement fusionné sur `main` (fait : spec v2.4, `web/src/index.ts`, `server/cmd/shhdrop/static.go`).
- Questions UI §19 tranchées ou défauts acceptés. **Q3 (amendement de CLAUDE.md et de la spec pour le repli reCAPTCHA) est bloquante pour les Tasks 15 et 16 seulement** : sans amendement écrit, ces deux tâches ne sont pas faites, et la preuve de travail échoue sur l'erreur « La vérification anti-robot n'a pas pu se faire sur cet appareil » (UI §9.4.2, repli désactivé).

## Structure des fichiers

```
web/index.html                          # entrée de l'application (aucun script/style en ligne)
web/pdf-frame.html                      # cadre PDF isolé
web/verif/index.html | verif.ts | verif.css | config.js   # page de vérification (autre origine, build séparé)
web/vite.config.ts                      # Svelte, entrées, mode demo (base /Shhdrop/, dist-demo), demoGuard, CSP meta de démo
web/vite.pdf-frame.config.ts | vite.verif.config.ts
web/playwright.config.ts                # chromium/webkit × ordinateur/téléphone + projet demo
web/tools/svelte-check/package.json     # svelte-check 4.7.8 + typescript 6.0.3 (S5)
web/public/fonts/*.woff2 | assets/grain.png | icon*.png|svg | manifest.webmanifest | robots.txt | apple-touch-icon.png
web/scripts/copy-fonts.mjs | gen-grain.mjs | gen-icons.mjs | gen-fixtures.mjs | check-dist.mjs
web/src/transfer/*                      # compléments de l'API (Task 0)
web/src/main.ts | App.svelte
web/src/app/router.svelte.ts | link.ts | lifecycle.ts | env.ts | viewport.ts
web/src/i18n/fr.ts | en.ts | i18n.svelte.ts | format.ts | pages.fr.ts | pages.en.ts
web/src/ui/tokens.css | fonts.css | base.css | motion.ts | contrast.ts | *.svelte
web/src/media/strip.ts | jpeg.ts | png.ts | webp.ts | recorder.ts | kinds.ts | categories.ts
web/src/flows/compose.svelte.ts | options.svelte.ts | send.svelte.ts | stats.ts | manage.svelte.ts | receive.svelte.ts | endoflife.ts
web/src/captcha/pow.ts | pow.worker.ts | verif-host.ts | solve.ts
web/src/routes/*.svelte
web/src/viewers/blobs.ts | collect.ts | save.ts | pdf-host.ts | pdf-frame/main.ts | *.svelte
web/src/qr/qr.ts
web/src/demo/install.ts | fake-server.ts | fake-xhr.ts | DemoBanner.svelte   # mode demo seulement
web/ui-e2e/fixtures.ts | verif-origin.ts | pages-server.ts | *.spec.ts | files/
server/internal/api/headers.go | handlers_share.go | static_paths.go | *_test.go
server/internal/captcha/recaptcha.go | recaptcha_test.go
server/internal/config/config.go | config_test.go
.github/workflows/ci.yml | pages.yml
```

---

### Task 0 : Compléments de l'API cliente (annulation, octets, pause, reprise, preuve)

**Files:**
- Modify: `web/src/transfer/client.ts`, `web/src/transfer/api.ts`, `web/src/index.ts`, `web/src/transfer/client.test.ts`, `web/src/transfer/api.test.ts`, `web/e2e/*.ts` (adaptation à `CaptchaProof`)
- Create: `web/src/transfer/upload.ts`, `web/src/transfer/upload.test.ts`

**Interfaces:**
```ts
type CaptchaProof = { kind: "pow"; payload: string } | { kind: "recaptcha"; token: string };
type CreateOpts = Net & {
  ttlHours: 1 | 6 | 12 | 24; maxOpens: number; password: string;
  solveCaptcha: (challenge: unknown, ctx: { fallbackOrigin: string | null }) => Promise<CaptchaProof>;
  onProgress?: (done: number, total: number) => void;          // segments (inchangé)
  onBytes?: (sent: number, total: number) => void;             // octets chiffrés
  onRetry?: (r: { attempt: number; inMs: number; offline: boolean }) => void;
  pause?: () => Promise<void> | void;                          // attendue avant chaque segment
  signal?: AbortSignal;
};
// upload.ts — transport des PUT de segment
type Uploader = (url: string, headers: Record<string, string>, body: Uint8Array, onBytes: (n: number) => void, signal?: AbortSignal) => Promise<{ status: number; json: unknown }>;
export const xhrUploader: Uploader;      // navigateur : XMLHttpRequest.upload.onprogress
export const fetchUploader: Uploader;    // Node / tests
export const OUTAGE_BUDGET_MS = 600_000; // 10 min sans progrès, puis Error("reseau")
export { cleanName } from "./transfer/safety"; // dans index.ts
```

- [ ] **Step 1 : Tests qui échouent** (`client.test.ts`, `upload.test.ts`, `fetch` et `Uploader` simulés, horloge injectée) :
  - `signal` annulé avant `solveCaptcha` → `AbortError`, aucun `POST /api/shares` ; annulé pendant l'envoi → `AbortError`, un `POST /destroy` avec `manage` envoyé avec `keepalive: true` ; les clés sont mises à zéro.
  - `onBytes` : monotone, finit à la somme exacte de `segmentSize(bucket, n)` ; un segment réessayé ne fait pas reculer le cumul affiché (le cumul repart du début du segment, jamais en dessous du total des segments terminés).
  - `pause` : tant que la promesse n'est pas résolue, aucun `PUT` suivant.
  - Coupure : 3 minutes d'échecs puis succès → envoi terminé, `onRetry` appelé avec des attentes 1, 2, 4, 8, 16, 30, 30… s ; 10 min sans progrès → `Error("reseau")` puis `destroy` ; événement `online` → essai immédiat.
  - `finalize` coupé puis rétabli → succès.
  - `solveCaptcha` reçoit `{ fallbackOrigin }` lu dans `GET /api/captcha` (`fallback` absent → `null`) ; `{kind:"pow"}` → corps `altcha` ; `{kind:"recaptcha"}` → corps `recaptcha` + `salt` du défi, sans `altcha`.
  - `index.ts` exporte `cleanName` et `type CaptchaProof`.
- [ ] **Step 2 : Lancer** `cd web && npm test -- transfer` → ÉCHEC.
- [ ] **Step 3 : Implémenter.** `upload.ts` : `xhrUploader` (`xhr.upload.onprogress`, `signal` → `xhr.abort()`), `fetchUploader`. `client.ts` : boucle de segments avec `await o.pause?.()`, `o.signal?.throwIfAborted()` aux points d'attente (défi, attente de 3,1 s, chaque segment), budget de coupure autour de `putSegment` et `finalize` (sans changer `api.send` pour les autres routes), chemin d'échec existant `api.destroy(…, { sGestion })` passé en `keepalive`. Choix du transport : `xhrUploader` si `XMLHttpRequest` existe et que `net.fetch` n'est pas fourni, sinon `fetchUploader`.
- [ ] **Step 4 : Lancer** `npm test && make test` (le test « le serveur ne voit rien » et les e2e du Plan 1 restent verts) → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(client): annulation, octets envoyés, pause, reprise sur coupure, preuve anti-robot typée » et push.

---

### Task 1 : Socle Svelte, Vite, contrôles de sources

**Files:**
- Create: `web/index.html`, `web/src/main.ts`, `web/src/App.svelte`, `web/vite.config.ts`, `web/tools/svelte-check/package.json`, `web/src/source-rules.test.ts`
- Modify: `web/package.json`, `web/tsconfig.json`, `web/vitest.config.ts`, `Makefile`, `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:** scripts npm `build`, `build:demo` (Task 8), `check` (`tsc --noEmit` + `svelte-check`), `test`, `test:ui`. Cible `make test-ui`.

- [ ] **Step 1 : Tests qui échouent.** `source-rules.test.ts` parcourt `web/src/**/*.{ts,svelte}` (hors `crypto/`, `transfer/`, `index.ts`, `demo/`, tests) et échoue si : `{@html` ; `style="` dans un `.svelte` ; `eval(` ou `new Function` ; import de `../transfer/`, `../crypto/` ou `fetch(` / `XMLHttpRequest` dans `routes/`, `ui/`, `flows/`, `viewers/`, `media/`, `captcha/`, `app/` ; `localStorage|sessionStorage|indexedDB|document.cookie` ; `console.log` ; import de `demo/` ailleurs que dans `main.ts`, et dans `main.ts` seulement sous la forme `import("./demo/install")`. Plus : `vite.config.ts` résolu a `assetsInlineLimit === 0` et `modulePreload.polyfill === false`.
- [ ] **Step 2 : Lancer** `cd web && npm test -- source-rules` → ÉCHEC.
- [ ] **Step 3 : Implémenter.** `npm i -E svelte@5.57.3` ; dev : `@sveltejs/vite-plugin-svelte@7.3.1`, `@playwright/test@1.64.1`, `@axe-core/playwright@4.14.0`. `vite.config.ts` : plugin Svelte, `assetsInlineLimit: 0`, `modulePreload: { polyfill: false }`, `sourcemap: false`. `index.html` : `<html lang="fr" translate="no">`, `<meta name="google" content="notranslate">`, `<meta name="color-scheme" content="dark">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`, un seul `<script type="module" src="/src/main.ts">`, aucune balise `og:*`. `tools/svelte-check/package.json` : `svelte-check@4.7.8`, `typescript@6.0.3`, `svelte@5.57.3` ; `--fail-on-warnings`. CI : job `web` ajoute `npm run build && npm run check` ; job `ui` : `npx playwright install --with-deps chromium webkit && make test-ui`, captures en artefact. `.gitignore` : `web/dist-demo/`, `web/ui-e2e/__captures__/`, `web/test-results/`, `web/playwright-report/`.
- [ ] **Step 4 : Lancer** `npm test && npm run build && npm run check` → SUCCÈS ; `dist/index.html` sans `<script>` sans `src` ni `<style>`.
- [ ] **Step 5 : Commit** « feat(web): socle Svelte 5 + Vite, règles de sources » et push.

---

### Task 2 : En-têtes par chemin et banc Playwright

Le serveur statique existe déjà (`server/cmd/shhdrop/static.go`) ; cette tâche n'ajoute que ce qui manque (UI §14.2).

**Files:**
- Create: `server/internal/api/static_paths.go`, `server/internal/api/static_paths_test.go`, `web/public/robots.txt`, `web/playwright.config.ts`, `web/ui-e2e/fixtures.ts`, `web/ui-e2e/shell.spec.ts`
- Modify: `server/internal/api/headers.go`

**Interfaces:**
- Go : `withHeaders` pose, en plus : `X-Robots-Tag: noindex` sur `/s/*` et `/m/*` ; `Cross-Origin-Resource-Policy: cross-origin` sur `/pdf-frame.html`, `/pdf-frame.js`, `/pdf-frame.css` seulement (liste fermée) ; `frame-src 'self' <origine>` quand `cfg.VerifOrigin` est non vide (champ ajouté en Task 15 ; vide ici).
- TS : fixture `shh` = `{ origin, server, cspViolations, foreignRequests }`, serveur Go neuf **par test** (`startServer` de `web/e2e/server.ts`, `SHH_STATIC_DIR` = `web/dist` absolu) ; fin de test : `expect(cspViolations).toEqual([])`, `expect(foreignRequests).toEqual([])`. Helpers `capture(page, nom)` et `axe(page)` (`wcag2a, wcag2aa, wcag21a, wcag21aa`).

- [ ] **Step 1 : Tests Go qui échouent** : `TestRobotsHeaderOnSharePaths` ; `TestPdfFrameCORP` (trois fichiers → `cross-origin`, tout autre → `same-origin`) ; `TestFrameSrcDefault` (CSP inchangée sans `VerifOrigin`) ; `TestSecurityHeadersKept`.
- [ ] **Step 2 : Lancer** `cd server && go test ./internal/api/ -run 'Robots|PdfFrame|FrameSrc|SecurityHeaders'` → ÉCHEC.
- [ ] **Step 3 : Implémenter** ; `robots.txt` : `Disallow: /s/`, `Disallow: /m/`.
- [ ] **Step 4 : Tests Playwright qui échouent** (`shell.spec.ts`) : accueil sous la CSP sans violation ni requête tierce ; `/s/x`, `/m/x` servent l'application ; `translate="no"` et meta notranslate. Projets `chromium-desktop` (1440 × 900), `webkit-desktop`, `chromium-mobile` (Pixel 7), `webkit-mobile` (iPhone 15) ; `globalSetup` = `go build` + `npm run build`. Garde CSP : `addInitScript` sur `securitypolicyviolation` + `page.on("console")` « Refused to ». Garde tierce : `page.on("request")` sur `page.mainFrame()` seulement, toute origine autre que `shh.origin` ou `blob:` enregistrée.
- [ ] **Step 5 : Lancer** `go test ./... && cd ../web && npx playwright test shell` → SUCCÈS sur les quatre projets.
- [ ] **Step 6 : Commit** « feat(server): en-têtes par chemin ; banc Playwright » et push.

---

### Task 3 : Polices, icônes, jetons (sombre), grain

**Files:**
- Create: `web/scripts/copy-fonts.mjs`, `web/scripts/gen-grain.mjs`, `web/public/fonts/*.woff2`, `web/public/assets/grain.png`, `web/src/ui/fonts.css`, `tokens.css`, `base.css`, `contrast.ts`, `tokens.test.ts`, `Icon.ts`
- Modify: `web/package.json`, `THIRD_PARTY_LICENSES.md`, `web/index.html`

**Interfaces:** `contrast(a, b): number` ; `tokens.css` avec **exactement** les jetons de UI §3.1, §4.2, §5, §7.2 sous `:root` (un seul thème, `color-scheme: dark`) et le bloc `@media (forced-colors: active)` de UI §3.3 ; `Icon.ts` réexporte nommément la liste fermée de UI §6.

- [ ] **Step 1 : Tests qui échouent** : `contrast("#FFFFFF", "#000000")` ≈ 21 ; chaque paire de UI §3.2 atteint son seuil ; `tokens.css` ne contient **aucun** `prefers-color-scheme` ; SHA-256 des `.woff2` = UI §4.1 ; `fonts.css` ne contient que des `url(/fonts/…)` ; `grain.png` 128 × 128 ; `Icon.ts` n'exporte que les noms de UI §6.
- [ ] **Step 2 : Lancer** `npm test -- tokens` → ÉCHEC.
- [ ] **Step 3 : Implémenter** (Fontsource en dev, `@lucide/svelte@1.68.0`, grain xorshift32 graine `0x5348` écrit avec `node:zlib`). `base.css` : `body` sur `--bg`, lumière d'ambiance, `::selection`, `caret-color`, `scrollbar-color`, anneau de focus, `.num` tabulaire. Vérifier `tnum` de Mona Sans par une capture « 1111 / 8888 » ; sinon `.num` en JetBrains Mono et UI §4.2 mise à jour.
- [ ] **Step 4 : Lancer** `npm test && npm run build` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): polices hébergées, jetons Nuit vérifiés, icônes, grain » et push.

---

### Task 4 : Coque, routeur, i18n, formats, annonces

**Files:**
- Create: `web/src/app/router.svelte.ts`, `router.test.ts`, `web/src/i18n/fr.ts`, `en.ts`, `i18n.svelte.ts`, `format.ts`, `i18n.test.ts`, `web/src/ui/AppShell.svelte`, `LiveRegion.svelte`, `announce.ts`, `web/src/routes/NotFound.svelte`, `web/ui-e2e/i18n.spec.ts`

**Interfaces:** `match(pathname, base = import.meta.env.BASE_URL)` → `{ name: "home" | "open" | "manage" | "securite" | "confidentialite" | "notfound"; id? }` ; `navigate(path)` ; `t(key, params?)` ; `setLang`, `detectLang` ; `formatDuration(s, lang, opts?)`, `formatBytes(n, lang)`, `formatRate(bytesPerS, lang)`, `plural` ; `announce(text)` (une par seconde au plus).

- [ ] **Step 1 : Tests qui échouent.** Routeur : `/s/AbC_-1` → `open` ; `/s/`, `/s/a/b` → `notfound` ; avec `base = "/Shhdrop/"`, `/Shhdrop/s/x` → `open`, `/s/x` → `notfound`. i18n : clés identiques FR/EN, aucune vide, U+202F avant « : ; ! ? » en FR, ni « ≈ » ni « 100 % sécurisé ». Formats : « 4 h 15 », « 12 min », « 45 s », « moins d'une minute » ; « 34 Mo », « 1 Go », « 0 octet » ; `formatRate(4404019, "fr")` = « 4,2 Mo/s ». e2e : la bascule change `<html lang>` ; aucun stockage.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** (clés de UI §10 et des écrans). `AppShell` : lien d'évitement, en-tête, `<main id="contenu" tabindex="-1">`, pied, verre au défilement (`IntersectionObserver`), emplacement du bandeau de démo (vide hors démo).
- [ ] **Step 4 : Lancer** `npm test && npx playwright test i18n` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): coque, routeur, i18n FR/EN, formats » et push.

---

### Task 5 : Hygiène du lien, cycle de vie, environnement, dépôt et clavier virtuel

**Files:**
- Create: `web/src/app/link.ts`, `lifecycle.ts`, `env.ts`, `viewport.ts` + tests, `web/src/routes/Unsupported.svelte`, `web/ui-e2e/hygiene.spec.ts`

**Interfaces:**
```ts
type LinkState = { kind: "s" | "m"; link: string } | { kind: "incomplete" };
readLink(href: string, expected: "s" | "m", base?: string): LinkState;   // retire la base avant parseLink
scrubAddressBar(h: History, pathname: string): void;
onPageHide(cb: () => void): () => void;
reloadIfRestored(w: Window): void;
guardUnload(active: () => boolean): () => void;
guardFileDrop(w: Window, allow: () => boolean): () => void;   // preventDefault dragover/drop hors composeur
isSupported(g: typeof globalThis): boolean;                    // UI §9 (Worker non exigé)
inAppBrowser(ua: string, standalone: boolean): string | null;
lowMemory(n: Navigator, size: number): boolean;
keyboardOpen(vv: VisualViewport | null, innerHeight: number): boolean;   // vv.height < 0,75 × innerHeight
```

- [ ] **Step 1 : Tests qui échouent.** `readLink` (valide, sans `#`, mauvais préfixe, avec base `/Shhdrop/`) ; `scrubAddressBar` ; `inAppBrowser` sur 12 agents réels et 5 navigateurs ordinaires, `standalone` → `null` ; `isSupported` faux sans `crypto.subtle`, `WebAssembly`, `Blob.prototype.stream`, `AbortController`, vrai sans `Worker` ; `guardUnload` ; `guardFileDrop` appelle `preventDefault` sur `drop` quand `allow()` est faux ; `keyboardOpen`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** et brancher dans `App.svelte` : `reloadIfRestored`, `isSupported` avant toute route, `guardFileDrop` global, classe `kbd-open` sur `<html>` selon `keyboardOpen` (barres collées repassées dans le flux par CSS).
- [ ] **Step 4 : e2e** (`hygiene.spec.ts`) : `/s/<id>#<clé>` → `location.hash === ""`, Retour ne réaffiche pas le `#` ; idem `/m/` ; agent Instagram → `#` conservé jusqu'à « Continuer ici quand même » ; sans `crypto.subtle` → « non pris en charge », aucune requête `/api/` ; fichier déposé sur `/s/x` → l'URL ne change pas (`page.dispatchEvent` de `drop` avec un `DataTransfer`).
- [ ] **Step 5 : Lancer** `npm test && npx playwright test hygiene` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): hygiène du lien, bfcache, dépôt neutralisé, clavier virtuel » et push.

---

### Task 6 : Composants de base

**Files:**
- Create: `web/src/ui/Button.svelte`, `IconButton.svelte`, `TextField.svelte`, `TextArea.svelte`, `Segmented.svelte`, `Stepper.svelte`, `CopyField.svelte`, `Banner.svelte`, `InlineConfirm.svelte`, `Sheet.svelte`, `UndoToast.svelte`, `Countdown.svelte`, `countdown.ts`, `clipboard.ts`, `motion.ts` + tests

**Interfaces:** `createCountdown(expiresInS, now)` → `{ remaining(); display(lang); announceAt() }` (seuils 3600, 900, 300, 60, 0) ; `copyText(text)` → `"copied" | "manual"` ; `clearClipboard()` ; `reducedMotion()`, `flip(els, mutate)` ; `Button` prop `onpress` avec garde de ré-entrée (désactivé avant tout `await`).

- [ ] **Step 1 : Tests qui échouent** : compte à rebours (horloge injectée, jamais négatif) ; `copyText` ; `flip` sans animation en mouvement réduit ; `Button` : deux clics synchrones → un seul appel de `onpress`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** selon UI §8 (`IconButton` exige `label`, `Segmented` en `radiogroup`, `CopyField` tronqué au milieu, `Sheet` sur `<dialog>` + `showModal()` et focus rendu au déclencheur, `InlineConfirm` focus sur « Annuler », `UndoToast` 6 s). Valeurs dynamiques par `style:--var={…}` seulement.
- [ ] **Step 4 : Lancer** `npm test && npm run check` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): composants de base » et push.

---

### Task 7 : Accueil (en-tête Persuade)

**Files:**
- Create: `web/src/routes/Home.svelte`, `web/src/ui/Schema.svelte`, `web/public/logo.svg`, `web/ui-e2e/home.spec.ts`

- [ ] **Step 1 : e2e qui échoue** : titre UI §9.1 visible ; sur les projets téléphone, la rangée d'ajout tient dans 844 px (emplacement réservé tant que la Task 10 n'existe pas) ; `axe` ; schéma `<svg role="img" aria-label>` ; en mouvement réduit, `document.getAnimations().length === 0` après 100 ms ; captures `home`, `home-320`, `home-forced-colors` (Chromium, `forcedColors: "active"`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.1 (titre replié après le premier ajout : prop `compact`).
- [ ] **Step 4 : Lancer** → SUCCÈS ; relire les captures.
- [ ] **Step 5 : Commit** « feat(ui): accueil » et push.

---

### Task 8 : Démo GitHub Pages (UI §14.3)

**Files:**
- Create: `web/src/demo/install.ts`, `fake-server.ts`, `fake-xhr.ts`, `DemoBanner.svelte`, `fake-server.test.ts`, `web/scripts/check-dist.mjs`, `web/scripts/check-dist.test.ts`, `web/ui-e2e/pages-server.ts`, `web/ui-e2e/demo.spec.ts`
- Modify: `web/vite.config.ts` (mode `demo`, greffons `demoGuard` et `demoMeta`, copie `404.html`), `web/src/main.ts`, `web/package.json` (`build:demo`), `web/playwright.config.ts` (projet `demo`), `.github/workflows/pages.yml`, `.github/workflows/ci.yml`, `Makefile`
- Delete: `web/demo-attente/` (page d'attente)

**Interfaces:**
```ts
// fake-server.ts — mêmes routes, corps et codes que server/internal/api (spec §8)
createFakeServer(opts?: { now?: () => number; rateBytesPerS?: number; outage?: { atFraction: number; ms: number } }): {
  handle(req: Request): Promise<Response>;   // /api/* seulement
  shares(): number;                          // pour les tests
};
installDemo(w: Window): void;               // remplace fetch et XMLHttpRequest pour /api/*, monte DemoBanner, préfixe le titre
```
- `main.ts` : `if (import.meta.env.MODE === "demo") await (await import("./demo/install")).installDemo(window);` **avant** le montage de l'application. Chaque fichier de `src/demo/` contient la marque `const MARK = "__SHH_DEMO__"`.
- En démo, `solveCaptcha` est remplacé (via `install.ts`, par l'injection de dépendance du flux d'envoi) par une fonction qui rend `{ kind: "pow", payload: "demo" }` ; le faux serveur ne vérifie aucune preuve et rend `fallback: null`.

- [ ] **Step 1 : Tests qui échouent.**
  - `fake-server.test.ts` : le **vrai** client contre le faux serveur (`net.fetch = (u, i) => fake.handle(new Request(u, i))`) : `createShare` → `openShare` → `saveItem` rend les octets d'origine ; mauvais mot de passe ×5 → `NotFoundError` ensuite ; `maxOpens = 1` → `draining`, `Opened.destroy()` fonctionne ; `shareStatus` ; segment de mauvaise taille → 400 ; expiration (horloge injectée) → 404 ; `destroy` par `S_gestion` en `uploading` ; le faux serveur ne voit jamais de repère en clair (même contrôle que le test « le serveur ne voit rien », sur ses `Request`).
  - `check-dist.test.ts` : sur un dossier factice contenant `__SHH_DEMO__`, `check-dist.mjs` échoue ; sans la marque, il passe ; avec `--demo`, l'inverse est exigé (marque, meta CSP, `404.html` présents).
- [ ] **Step 2 : Lancer** `npm test -- demo check-dist` → ÉCHEC.
- [ ] **Step 3 : Implémenter.**
  - `vite.config.ts` : `mode === "demo"` → `base: "/Shhdrop/"`, `build.outDir: "dist-demo"`, greffon `demoMeta` (`transformIndexHtml` : CSP meta, `referrer`, `robots` de UI §14.3 en tête de `<head>`), copie `index.html` → `404.html` ; sinon greffon `demoGuard` (`generateBundle` : échec si un module dont l'id contient `/src/demo/` est dans le bundle).
  - `fake-xhr.ts` : `XMLHttpRequest` minimal pour `PUT /api/…/segments/*` (envoie à `handle`, émet `upload.onprogress` au débit simulé, gère `abort`) ; tout autre XHR passe à l'original.
  - `install.ts` : lit `?lent` (1 Mo/s) et `?coupure` ; monte `DemoBanner` dans l'emplacement de `AppShell` (`role="note"`, texte UI §14.3, non fermable, collé en haut, `--warn-tint`) ; titre « Démo · … » ; bouton « Ouvrir comme destinataire (démo) » exposé aux écrans par un drapeau `demo` du contexte (utilisé en Task 18).
  - `check-dist.mjs [--demo]` : parcourt `dist/` (ou `dist-demo/`) et applique les règles ci-dessus ; branché dans `make test-web` et le job `web` de la CI après `npm run build`.
  - `pages.yml` : garder déclencheurs (`push` sur `main`, `workflow_dispatch`), permissions et `deploy` ; remplacer l'étape d'artefact par : `actions/setup-node` (épinglée par empreinte, même version de Node que `ci.yml`), `npm ci` dans `web`, `npm run build:demo`, `node scripts/check-dist.mjs --demo`, `actions/upload-pages-artifact` sur `web/dist-demo`. Supprimer `web/demo-attente/`.
  - `pages-server.ts` (tests) : serveur HTTP Node qui imite Pages : sert `dist-demo/` sous `/Shhdrop/`, `404.html` avec le code 404 pour tout chemin absent, **aucun** en-tête de sécurité.
- [ ] **Step 4 : e2e** (`demo.spec.ts`, projet `demo` sur `chromium-mobile` et `webkit-desktop`) : `/Shhdrop/` affiche l'accueil et le bandeau ; `/Shhdrop/s/abc#x` (adresse profonde) affiche « Lien invalide » avec la phrase de démo ; aucune violation de la CSP meta ; aucune requête hors de l'origine ; `localStorage.length === 0`. Les tâches suivantes ajoutent leur parcours à ce fichier.
- [ ] **Step 5 : Lancer** `npm test && npm run build && node scripts/check-dist.mjs && npm run build:demo && node scripts/check-dist.mjs --demo && npx playwright test --project=demo` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(demo): démo GitHub Pages (faux serveur en mémoire, absente de la production) » et push sur `main` ; vérifier que le workflow `pages` passe et que `https://skoow.github.io/Shhdrop/` affiche l'accueil (capture jointe).

---

### Task 9 : Retrait des métadonnées (JPEG, PNG, WebP)

**Files:**
- Create: `web/src/media/jpeg.ts`, `png.ts`, `webp.ts`, `strip.ts`, `kinds.ts`, `categories.ts`, `strip.test.ts`, `kinds.test.ts`, `categories.test.ts`, `web/scripts/gen-fixtures.mjs`, `web/src/media/fixtures/*`

**Interfaces:**
```ts
type Stripped = { ok: true; data: Uint8Array<ArrayBuffer>; mime: string } | { ok: false; reason: "malforme" };
stripMetadata(bytes: Uint8Array, mime: string): Stripped;
cleanStatus(mime: string, name: string): "nettoyable" | "video" | "photo_non_nettoyee" | "pdf" | "document" | "texte";
type Category = "texte" | "photos" | "videos" | "audio" | "documents" | "autres";
CATEGORY_ORDER: readonly Category[];                          // UI §9.2.4
categoryOf(item: { kind: "text" | "file"; mime: string; name: string; voice?: boolean }): Category;
categoryOfReceived(previewKind: PreviewKind, safeName: string): Category;   // affichage destinataire
```

- [ ] **Step 1 : Fixtures** (`gen-fixtures.mjs`, sans dépendance) : `iphone-like.jpg` (EXIF orientation 6 + Make « ReperMake » + GPS, XMP « ReperXMP », ICC en 2 morceaux, MPF, APP13, COM, APP14, image 8 × 8 réelle, EOI, **seconde image avec EXIF « ReperSecond »**), `meta.png`, `meta.webp`.
- [ ] **Step 2 : Tests qui échouent.** JPEG : aucun repère, orientation 6, ICC identique, APP14 présent, flux compressé identique, rien après le premier EOI. PNG : chunks retirés, iCCP présent, CRC valides. WebP : EXIF/XMP absents, VP8X corrigé, taille RIFF juste. Tronqué → `{ok:false}` sans exception. `cleanStatus` (vidéo, HEIC/AVIF/GIF, PDF, document). `categoryOf` : table de 20 cas (`.docx` → documents, `.zip` → autres, vocal → audio, `image/heic` → photos…). `CATEGORY_ORDER` = texte, photos, videos, audio, documents, autres.
- [ ] **Step 3 : Lancer** `npm test -- strip kinds categories` → ÉCHEC.
- [ ] **Step 4 : Implémenter** des analyseurs à bornes vérifiées ; EXIF réécrit à une entrée (0x0112).
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(media): métadonnées retirées sans réencodage, catégories » et push.

---

### Task 10 : Composer — liste, catégories, ordre, retrait, renommage, doublons, jauge

**Files:**
- Create: `web/src/routes/Compose.svelte`, `web/src/flows/compose.svelte.ts`, `compose.test.ts`, `web/src/ui/CapacityGauge.svelte`, `CategoryGroup.svelte`, `ItemRow.svelte`, `ReorderHandle.svelte`, `web/src/ui/reorder.ts`, `reorder.test.ts`, `web/ui-e2e/compose.spec.ts`, `web/ui-e2e/files/*` (photo, vidéo courte, PDF, 12 petits fichiers ; fichier creux de 1 Go généré)

**Interfaces:**
```ts
type ComposeItem = { id: string; kind: "file" | "text"; category: Category; base: string; ext: string;
  mime: string; size: number; data: Blob | Uint8Array; clean: ReturnType<typeof cleanStatus> | "nettoye";
  duplicate: boolean; thumb?: string; status: "pret" | "nettoyage" };
createComposer(deps = { strip: stripMetadata, probe: (f: Blob) => Promise<void>, now }) → {
  items: ComposeItem[];                         // ordre d'affichage = ordre du manifeste
  groups(): { category: Category; items: ComposeItem[]; count: number; bytes: number }[];
  totalBytes: number; count: number;
  add(files: File[], source: "fichiers" | "photo" | "depot" | "collage"): Promise<AddReport>;
  addText(text: string): string; updateText(id, text): void; addVoice(blob, mime): void;
  remove(id): { undo(): void };                 // annulation 6 s
  rename(id, base): null | "vide" | "trop_long" | "interdit";
  move(id, delta: -1 | 1): "ok" | "premier" | "dernier";   // dans sa catégorie seulement
  moveTo(id, index): void;                      // glisser, dans sa catégorie
  blockReason(): null | "vide" | "trop_gros" | "texte_trop_long" | "nettoyage" | "hors_ligne";
  toApiItems(): Item[];                         // ordre CATEGORY_ORDER puis ordre interne ; nom = cleanName(base + ext)
};
type AddReport = { added: string[]; refusedCount: string[]; unreadable: string[]; folders: string[]; failedClean: string[]; duplicates: string[] };
CONTENT_MAX = 1073741824 - 65540;
```

- [ ] **Step 1 : Tests qui échouent** (`compose.test.ts`, `reorder.test.ts`) : JPEG → donnée nettoyée, `clean = "nettoye"` ; JPEG malformé → `failedClean` ; 12 fichiers → 10 ajoutés, 2 dans `refusedCount` ; `probe` rejeté → `unreadable` ; total > `CONTENT_MAX` → ajouté, `blockReason() === "trop_gros"` ; photo de source `photo` → `base = "Photo 1"` ; doublon (même `cleanName` sans casse + même taille) → `duplicate` sur les deux, retiré à la suppression de l'un ; `move` limité à la catégorie, `"premier"`/`"dernier"` en limite ; `toApiItems` suit `CATEGORY_ORDER` puis l'ordre interne, et passe le `File` d'origine tel quel pour les non-images (jamais lu en entier) ; `rename` (vide, 121 points de code, `/`, contrôle) ; `remove().undo()` remet à la même place ; extension non modifiable.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.2.1, §9.2.4–§9.2.9 : rangée d'ajout (Fichiers, Photo, Texte ; Vocal et Coller en Tasks 11–12), `DropZone` cliquable (dépôt en Task 11), `CategoryGroup` + `ItemRow` (vignette 40 px des images nettoyées, URL blob révoquée à l'oubli), `ReorderHandle` (Pointer Events + `setPointerCapture`, 150 ms au doigt, défilement automatique, Alt + ↑/↓, mode déplacement Monter/Descendre/Terminé, annonces), renommage en place, `UndoToast`, `CapacityGauge` (deux `role="meter"`, état vide, 90 %, dépassement en `role="alert"`), raisons de blocage reliées au bouton, `beforeunload` si la liste n'est pas vide.
- [ ] **Step 4 : e2e** (`compose.spec.ts`) : photo + texte + PDF → trois catégories dans l'ordre Texte, Photos, Documents, méta « 1 · … » ; deux photos réordonnées à la souris puis au clavier (Alt + ↓) avec annonce lue dans le `LiveRegion` ; mode déplacement sur `webkit-mobile` ; renommage (Entrée, Échap) ; retrait + Annuler ; 12 fichiers → message « 2 éléments n'ont pas été ajoutés » ; fichier creux 1 Go + 1 octet → jauge `--danger`, bouton bloqué avec la raison ; doublon → badge ; nom de 200 caractères et nom arabe → pas de débordement à 320 px ; `axe` ; captures `compose-filled`, `compose-over`, `compose-reorder`. Démo : parcours « ajouter, réordonner, retirer » ajouté à `demo.spec.ts`.
- [ ] **Step 5 : Lancer** `npm test && npx playwright test compose` puis la commande démo des Global Constraints → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): composer (catégories, ordre, renommage, doublons, jauge) » et push.

---

### Task 11 : Glisser-déposer et coller

**Files:**
- Create: `web/src/ui/DropOverlay.svelte`, `web/src/flows/intake.ts`, `intake.test.ts`, `web/ui-e2e/intake.spec.ts`
- Modify: `web/src/routes/Compose.svelte`, `web/src/ui/DropZone.svelte`, `web/src/app/lifecycle.ts` (`guardFileDrop` laisse passer sur l'accueil hors envoi)

**Interfaces:**
```ts
filesFromDrop(dt: DataTransfer): Promise<{ files: File[]; folders: string[] }>;   // webkitGetAsEntry si présent
fromPasteEvent(e: ClipboardEvent, focusInTextField: boolean): { files: File[]; text: string | null; native: boolean };
fromClipboardRead(items: ClipboardItem[]): Promise<{ files: File[]; text: string | null }>;   // image/png|jpeg|webp|gif, text/plain
dragDepth(): { enter(e): boolean; leave(e): boolean; reset(): void };   // compteur anti-clignotement
```

- [ ] **Step 1 : Tests qui échouent** : `filesFromDrop` sépare un dossier (entrée `isDirectory`) ; `fromPasteEvent` : fichiers → `files`, `native: false`, même avec focus dans un champ ; texte avec focus dans un champ → `native: true` ; texte hors champ → `text`, jamais `text/html` ; `fromClipboardRead` nomme « Image collée 1.png » ; `dragDepth` ne passe à 0 qu'au dernier `dragleave`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.2.2–§9.2.3 : `DropOverlay` pleine page (voile `--scrim`, Échap, `dragend`), dossiers refusés (`folder-x`), écouteur `paste` sur `document` actif sur l'accueil hors envoi, bouton Coller si `navigator.clipboard.read` existe (`NotAllowedError` → message, rien → « Rien à coller. »), texte collé hors champ → éditeur de texte ouvert avec focus.
- [ ] **Step 4 : e2e** : dépôt de 3 fichiers (`DataTransfer` construit dans la page) → 3 éléments ; dépôt d'un dossier (Chromium, `webkitGetAsEntry` simulé) → message ; voile visible pendant `dragenter`, retiré sur Échap ; Ctrl + V d'une image (`ClipboardEvent` avec `DataTransfer`) → « Image collée 1.png » nettoyée ; Ctrl + V de texte hors champ → éditeur ouvert ; bouton Coller sur Chromium (permission `clipboard-read`) ; `axe` ; captures `drop-overlay`, `paste`. Démo : dépôt et collage ajoutés à `demo.spec.ts`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): glisser-déposer pleine page, coller (fichiers, images, texte) » et push.

---

### Task 12 : Vocal

**Files:**
- Create: `web/src/media/recorder.ts`, `recorder.test.ts`, `web/src/ui/VoiceRecorder.svelte`, `web/ui-e2e/voice.spec.ts`

**Interfaces:** `pickMime(isSupported)` → `{ mime; ext: "m4a" | "webm" } | null` (ordre `audio/mp4;codecs=mp4a.40.2`, `audio/mp4`, `audio/webm;codecs=opus`, `audio/webm`) ; `startRecording({ maxMs = 1_800_000 })` → `{ stop(): Promise<Blob>; level(); elapsedMs(); cancel() }`.

- [ ] **Step 1 : Tests qui échouent** : ordre de `pickMime` ; `null` → bouton masqué ; arrêt automatique à `maxMs` (horloge injectée), avertissement à `maxMs − 60 s`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.2.7 ; pistes arrêtées à la fin et sur `pagehide` ; nom « Vocal {n}.{ext} », catégorie Audio et vocaux.
- [ ] **Step 4 : e2e** Chromium (faux micro) : 2 s → « Vocal 1 » > 0 octet dans « Audio et vocaux » ; refus → message. WebKit : `fixme` si pas de faux micro, ligne ajoutée à la liste manuelle.
- [ ] **Step 5 : Lancer** → SUCCÈS (démo comprise : le vocal reste local à la page).
- [ ] **Step 6 : Commit** « feat(media): enregistrement vocal » et push.

---

### Task 13 : Options et phrase de passe

**Files:**
- Create: `web/src/routes/Options.svelte`, `web/src/flows/options.svelte.ts`, `options.test.ts`, `web/src/ui/PassphraseField.svelte`, `PasswordChecklist.svelte`, `web/ui-e2e/options.spec.ts`

**Interfaces:** `createOptions()` → `{ ttlHours: 1|6|12|24; maxOpens; mode: "generated" | "custom"; password; regenerate(); setCustom(pw); useGenerated(); check(): PwCheck }` — **défauts 12 h, 1 ouverture**, phrase de 4 mots.

- [ ] **Step 1 : Tests qui échouent** : défauts `ttlHours === 12`, `maxOpens === 1` ; `regenerate` ; `setCustom("court")` → trop court ; mot courant de 12 caractères → trop courant ; `maxOpens` borné ; `useGenerated` revient à une phrase.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.3 ; sur ordinateur, colonnes Composer | Options (`position: sticky`).
- [ ] **Step 4 : e2e** : 12 h sélectionné au chargement ; flèches dans la durée ; Stepper 1 → 10 ; mot de passe trop court → bouton bloqué, message relié ; attributs UI §12.3 ; aucune `<form>` ; clavier ouvert sur `webkit-mobile` (`page.setViewportSize` réduit) → barre d'actions dans le flux, champ visible ; `axe` ; capture `options`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): options (12 h, 1 ouverture), phrase de passe » et push.

---

### Task 14 : Anti-robot — preuve de travail maison

**Files:**
- Create: `web/src/captcha/pow.ts`, `pow.worker.ts`, `pow.test.ts`, `web/src/captcha/solve.ts`, `solve.test.ts`, `web/ui-e2e/captcha.spec.ts`

**Interfaces:**
```ts
// pow.worker.ts : message { salt, challenge, maxnumber } → { type: "progress", tried } | { type: "found", number, took } | { type: "notfound" }
solvePow(ch: { algorithm: string; challenge: string; maxnumber: number; salt: string; signature: string },
  opts: { signal: AbortSignal; timeoutMs: number; onProgress(tried: number, rate: number): void;
          makeWorker?: () => Worker }): Promise<{ payload: string }>;       // rejette "pow_echec" | AbortError
makeSolveCaptcha(deps: { solvePow; askFallback(origin: string, signal): Promise<string> /* Task 16 */;
  onPhase(p: "pow" | "fallback_offer" | "fallback"): void; timeoutMs = 20_000 })
  : (challenge: unknown, ctx: { fallbackOrigin: string | null }) => Promise<CaptchaProof>;
```

- [ ] **Step 1 : Tests qui échouent** : `solvePow` (Worker simulé par une classe en mémoire qui exécute le même code) trouve le `number` d'un défi produit par le même format que `altcha-lib-go` (sel « …&expires=…& », SHA-256 de `salt + number`) ; charge utile = base64 du JSON `{algorithm, challenge, number, salt, signature, took}` ; `algorithm !== "SHA-256"` → rejet ; `signal` → `terminate()` appelé ; 20 s sans solution → `pow_echec` ; `makeWorker` qui lève → `pow_echec` immédiat ; `makeSolveCaptcha` : `pow_echec` avec `fallbackOrigin: null` → rejet `captcha_impossible` ; avec origine → `onPhase("fallback_offer")` puis `askFallback`. Aucun SHA-256 écrit à la main (le Worker appelle `crypto.subtle.digest`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** (`new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" })`, lots de 64 condensés parallèles, progression toutes les 250 ms, borne « encore {durée} au plus » = `(maxnumber − tried) / rate`).
- [ ] **Step 4 : e2e** (`captcha.spec.ts`, vrai serveur) : résolution d'un vrai défi de `GET /api/captcha` dans la page → `POST /api/shares` accepté (via `createShare` complet) ; aucune requête hors origine ; aucune violation CSP (le Worker est un fichier de l'origine) ; `Worker` retiré par `addInitScript` → l'erreur « La vérification anti-robot n'a pas pu se faire sur cet appareil » (repli non configuré).
- [ ] **Step 5 : Lancer** → SUCCÈS sur les quatre projets.
- [ ] **Step 6 : Commit** « feat(captcha): preuve de travail maison (Worker, WebCrypto), compatible altcha-lib-go v1 » et push.

---

### Task 15 : Serveur — repli reCAPTCHA (bloquée par Q3)

**Files:**
- Create: `server/internal/captcha/recaptcha.go`, `server/internal/captcha/recaptcha_test.go`
- Modify: `server/internal/config/config.go`, `config_test.go`, `server/internal/api/handlers_share.go`, `server/internal/api/api.go`, `server/internal/api/headers.go`, `server/internal/api/*_test.go`, `server/cmd/shhdrop/main.go`

**Interfaces:**
```go
// config : RecaptchaSecret string; VerifOrigin string; RecaptchaVerifyURL string
type Siteverify interface { Verify(ctx context.Context, token string) (VerifyResult, error) }
type VerifyResult struct { Success bool; Hostname string; ChallengeTS time.Time }
func NewSiteverify(secret, url string, client *http.Client) Siteverify   // POST secret+response, jamais remoteip, délai 5 s
func (c *Captcha) VerifyFallback(ctx context.Context, sv Siteverify, token, salt string, ip netip.Addr, hp string, shownAt time.Time, verifHost string) error
```

- [ ] **Step 1 : Tests qui échouent.**
  - `config_test.go` : secret sans `SHH_VERIF_ORIGIN` → erreur ; origine non `https://` (hors boucle locale) → erreur ; origine égale à celle du site → erreur ; `SHH_RECAPTCHA_VERIFY_URL` `http://` hors boucle locale → erreur ; sans secret → repli désactivé.
  - `recaptcha_test.go` (faux `siteverify` en `httptest.Server`) : succès ; `success:false` → `ErrInvalid` ; `hostname` différent → `ErrInvalid` ; `challenge_ts` > 2 min → `ErrInvalid` ; même jeton deux fois → second refusé (empreinte en mémoire) ; sel déjà consommé → refusé ; `shown_at` non lié au sel → refusé ; moins de 3 s → refusé ; délai de Google dépassé → `ErrInvalid` ; le corps envoyé à Google ne contient ni `remoteip` ni l'adresse du client ; une création par repli compte dans la fenêtre d'une heure (le défi suivant de la même connexion a un niveau supérieur).
  - API : `GET /api/captcha` → `"fallback": null` sans secret, l'origine sinon ; `POST /api/shares` avec `altcha` et `recaptcha` → 400 ; `recaptcha` sans `salt` → 400 ; `recaptcha` de plus de 4 096 caractères → 400 ; CSP des réponses → `frame-src 'self' <origine>` quand activé ; le jeton n'apparaît dans aucun journal (capture du `slog`).
- [ ] **Step 2 : Lancer** `cd server && go test ./...` → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §15.4 (corps de création : champ `recaptcha` et `salt` optionnels, exactement un des deux modes ; vérification sous le même verrou que la consommation du sel).
- [ ] **Step 4 : Lancer** `go test -race ./... && GOARCH=386 go build ./... && govulncheck ./...` → SUCCÈS ; `make test` (dont « le serveur ne voit rien ») vert.
- [ ] **Step 5 : Commit** « feat(server): repli reCAPTCHA vérifié par siteverify, lié au défi, usage unique » et push.

---

### Task 16 : Cadre de vérification et repli client (bloquée par Q3)

**Files:**
- Create: `web/verif/index.html`, `web/verif/verif.ts`, `web/verif/verif.css`, `web/verif/config.js` (valeurs de test), `web/vite.verif.config.ts`, `web/src/captcha/verif-host.ts`, `verif-host.test.ts`, `web/src/ui/VerifFrame.svelte`, `web/ui-e2e/verif-origin.ts`, `web/ui-e2e/verif.spec.ts`, `web/ui-e2e/files/fake-recaptcha.js`

**Interfaces:**
```ts
// verif-host.ts
askFallback(origin: string, mount: HTMLElement, signal: AbortSignal, lang: "fr" | "en"): Promise<string>;  // jeton
acceptMessage(e: MessageEvent, origin: string, frame: Window): { type: "ready" | "token" | "expired" | "error"; token?: string } | null;
// verif.ts (autre origine) : charge grecaptcha (URL depuis config.js), render({ sitekey, callback, "expired-callback" }), postMessage vers APP_ORIGIN exacte
```

- [ ] **Step 1 : Tests qui échouent** (`verif-host.test.ts`) : message d'une autre origine → ignoré ; bonne origine mais `source` différente → ignoré ; jeton hors `[A-Za-z0-9_-]{20,4096}` → ignoré ; `v` ≠ 1 → ignoré ; `signal` → cadre retiré ; 15 s sans `ready` → rejet `cadre_muet` ; l'iframe a exactement `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`, `referrerpolicy="no-referrer"`, `allow=""`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.4.2, §15.2–§15.3 : `Sheet` « Vérification supplémentaire » (texte de consentement, **rien chargé avant** « Continuer avec Google »), `VerifFrame` (`min(100 %, 400px)` × `min(600px, 85dvh)`), branchement dans `makeSolveCaptcha`. Build `vite.verif.config.ts` → `web/dist-verif/` (aucun module partagé avec l'application, vérifié par `check-dist.mjs --verif` : aucun import de `src/`).
- [ ] **Step 4 : e2e** (`verif.spec.ts`) : `verif-origin.ts` sert `dist-verif/` sur `http://127.0.0.1:<port>` (l'application est sur `http://localhost:<port>` : origines distinctes) avec la CSP de UI §15.2, et `fake-recaptcha.js` à la place de Google ; serveur Go lancé avec `SHH_RECAPTCHA_SECRET`, `SHH_VERIF_ORIGIN`, `SHH_RECAPTCHA_VERIFY_URL` vers un faux `siteverify`. Parcours : `Worker` retiré → feuille de consentement, **aucune requête vers l'origine de vérification avant le clic** ; clic → case cochée dans le cadre → jeton → envoi réussi, « Lien prêt ». Contrôles : aucune requête du cadre principal hors `localhost` sauf le document du cadre ; un `postMessage` forgé depuis la page (`window.postMessage`) n'est pas accepté ; Échap ferme la feuille = envoi annulé ; aucune violation CSP ; captures `verif-consent`, `verif-frame`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(captcha): repli reCAPTCHA dans un cadre d'une autre origine, après consentement » et push.

---

### Task 17 : Envoi — scellement, mesures, coupure, pause, annulation

**Files:**
- Create: `web/src/flows/send.svelte.ts`, `send.test.ts`, `web/src/flows/stats.ts`, `stats.test.ts`, `web/src/routes/Sealing.svelte`, `web/src/ui/SealCapsule.svelte`, `UploadStats.svelte`, `PhaseList.svelte`, `web/src/ui/seal.css`, `web/src/app/wakelock.ts`, `web/ui-e2e/send.spec.ts`

**Interfaces:**
```ts
createStats(now: () => number) → { push(sent: number, total: number): void; rate(): number | null /* EMA τ = 3 s, null avant 3 s */;
  eta(): number | null /* null avant 5 s ou si rate ≤ 0 */; percent(): number /* floor */ };
createSender(deps = { createShare, solveCaptcha, now, wakeLock, onBeforeUnload }) → {
  phase: "idle" | "keys" | "captcha" | "fallback" | "upload" | "paused" | "offline" | "finalize" | "sealed" | "cancelled" | "error";
  sent: number; total: number; segments: { done: number; total: number };
  retry?: { inMs: number; offline: boolean }; pauseLeftMs?: number; tooSlow: boolean;
  error?: SendError; retryAfterS?: number; createdOnServer: boolean;
  result?: { link: string; manage: string; expiresInS: number; password: string };
  start(items: Item[], opts): Promise<void>;      // refuse hors "idle"
  pause(): void; resume(): void; cancel(): void; retry(): Promise<void>;
};
type SendError = "reseau" | "interrompu" | "limite" | "plein" | "gele" | "captcha" | "fichier_modifie" | "inattendu";
PAUSE_MAX_MS = 600_000; UPLOAD_WINDOW_MS = 3 * 3600_000; STALL_MS = 10_000;
```

- [ ] **Step 1 : Tests qui échouent** (`createShare` simulé, horloge injectée) : phases `keys` → `captcha` (appel de `solveCaptcha`) → `upload` (`onProgress(0,n)`) → `finalize` (`onBytes(total,total)`) → `sealed` (résolution seulement) ; `start` deux fois → un seul `createShare` ; `onRetry` → `offline` avec `inMs`, retour à `upload` au progrès suivant ; 10 s sans octet → `offline` ; `pause()` → `paused` à la fin du segment, reprise automatique à 10 min, pause refusée à moins de 15 min de la fin de la fenêtre de 3 h ; `cancel()` → `abort()`, phase `cancelled`, `createdOnServer` exact ; `cancel` ignoré en `finalize` ; `tooSlow` quand `eta > fenêtre restante` ; erreurs UI §9.4.6 (`Error("full")` → `plein`, `Error("frozen")` → `gele`, `NotReadableError` → `fichier_modifie` avec l'élément fautif, `bad_request` → un nouvel essai complet puis `captcha`) ; `LimitError(120)` → `retryAfterS` ; `retry()` rappelle `createShare` en entier ; mot de passe gardé seulement dans `result` ; verrou d'écran demandé en `keys`, relâché en pause, à la fin et à l'annulation. `stats.test.ts` : EMA sur une série connue, `percent` jamais 100 avant `sent === total`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §7.3 et §9.4 : capsule (`<rect pathLength="100">`, encoche de départ, pourcentage `--fs-figure`, trait indéterminé, progression en octets par `requestAnimationFrame`, pause et coupure), FLIP aller et retour (composeur `inert` et intact), fermeture du sceau en WAAPI après résolution seulement, `UploadStats` (hiérarchie UI §9.4.1, aide sur la taille de palier), `PhaseList`, bandeaux de coupure et « trop lent », Pause/Reprendre, Annuler + `InlineConfirm` (masqué en `finalize`), `beforeunload` de `keys` à la résolution, `pagehide` → `cancel()`, titre « 42 % · Shhdrop », bascule de langue désactivée, `role="progressbar"`, annonces tous les 10 %.
- [ ] **Step 4 : e2e** (`send.spec.ts`, vrai serveur) : texte + photo → phases dans l'ordre, « Lien prêt » seulement après la réponse de `finalize` (`page.route` qui retarde `finalize` de 2 s : la capsule affiche « Finalisation » pendant ce temps) ; 20 Mo avec `context.setOffline(true)` pendant **60 s** puis `false` → bandeau avec compte à rebours, puis succès ; Pause → plus aucun `PUT` pendant 5 s → Reprendre → succès ; Annuler au milieu → retour au composeur intact, et le partage n'existe plus (`shareStatus` en Node par le lien de gestion intercepté → `NotFoundError`) ; fermeture de la page au milieu (`page.close({ runBeforeUnload: false })`) → partage effacé côté serveur (requête `destroy` `keepalive` reçue) ; double clic → une seule création ; `beforeunload` armé pendant l'envoi seulement ; serveur arrêté → « Le transfert a été interrompu » ; `LimitError` simulée → Réessayer désactivé avec compte à rebours ; 320 px et paysage 844 × 390 sans débordement ; captures `seal-progress`, `seal-offline`, `seal-paused`, `seal-sealed` (mouvement réduit). Démo : envoi complet ajouté, et `?coupure` montre le bandeau puis la reprise.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): envoi (progression réelle, vitesse, reprise, pause, annulation) » et push.

---

### Task 18 : Lien prêt

**Files:**
- Create: `web/src/routes/Ready.svelte`, `web/src/qr/qr.ts`, `qr.test.ts`, `web/src/ui/QrCode.svelte`, `web/ui-e2e/ready.spec.ts`
- Modify: `web/package.json` (`uqr@0.1.3`), `THIRD_PARTY_LICENSES.md`

**Interfaces:** `qrPath(text)` → `{ size; d }` ; `QrCode` par `import()` dynamique.

- [ ] **Step 1 : Tests qui échouent** : `qrPath` d'un lien de 80 caractères (taille attendue, `d` limité à `M h v z` et nombres).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.5 : trois `CopyField`, Partager, QR, Vider le presse-papier, mention d'expiration calculée sur `expiresInS`, Terminé + `InlineConfirm`, **Supprimer ce partage** (séparé, `destroyShare(manage, location.origin)`, dissolution, « Partage supprimé », `NotFoundError` traité comme supprimé, `reseau` → Réessayer), `beforeunload` jusqu'à Terminé ou Supprimer. En démo seulement : bouton « Ouvrir comme destinataire (démo) » (`navigate` vers le lien avec base, sans rechargement).
- [ ] **Step 4 : e2e** : copie du lien (presse-papier = lien entier) et du mot de passe ; `navigator.share` simulé reçoit `{ url }` sans mot de passe ; Vider ; `beforeunload` armé jusqu'à Terminé ; Supprimer → confirmation → « Partage supprimé » et `fetchMeta` en Node → `NotFoundError` ; Terminé → composeur vide, ni lien ni mot de passe dans `document.body.innerText` ; `axe` ; captures `ready`, `ready-qr`, `ready-deleted`. Démo : « Ouvrir comme destinataire » mène à l'écran d'ouverture.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): lien prêt (copie, partage, QR, suppression, garde de sortie) » et push.

---

### Task 19 : Page de gestion

**Files:**
- Create: `web/src/routes/Manage.svelte`, `web/src/flows/manage.svelte.ts`, `manage.test.ts`, `web/src/ui/Dissolve.svelte`, `dissolve.css`, `web/ui-e2e/manage.spec.ts`

**Interfaces:** `createManager(link, deps = { shareStatus, destroyShare, now })` → `{ state: "loading" | "ready" | "draining" | "uploading" | "gone" | "error"; status?; refresh(); destroy() }` ; `Dissolve.play(): Promise<void>`.

- [ ] **Step 1 : Tests qui échouent** : `NotFoundError` → `gone` ; `destroy` → `gone` après la réponse seulement ; `LimitError` → pas de relecture avant `retryAfterS` ; relecture suspendue si `hidden` ou hors ligne ; compte à rebours local à zéro → relecture immédiate.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.6 et §7.4.
- [ ] **Step 4 : e2e** : « Ouvert 1 / 3 · Expire dans … » ; Supprimer → dissolution → « Supprimé », focus ; partage inexistant → « Supprimé » ; état `uploading` (envoi lancé dans un autre contexte, mis en pause) → « Envoi en cours » ; capture en milieu de dissolution et `dissolve-end` ; `axe`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): gestion du partage, dissolution » et push.

---

### Task 20 : Ouverture

**Files:**
- Create: `web/src/routes/Open.svelte`, `web/src/routes/Invalid.svelte`, `web/src/flows/receive.svelte.ts`, `receive.test.ts`, `web/ui-e2e/open.spec.ts`

**Interfaces:** `createReceiver(link, deps = { fetchMeta, openShare, now })` → `{ state: "meta" | "inapp" | "locked" | "unlocking" | "open" | "invalid" | "destroyed_by_password" | "incomplete" | "error"; expiresInS; attemptsLeft?; retryAfterS?; opened?: Opened; continueHere(); unlock(password): Promise<void> }` (aucun mot de passe gardé après `unlock`).

- [ ] **Step 1 : Tests qui échouent** : `NotFoundError` / `lien_invalide` à `fetchMeta` → `invalid` ; `BadPasswordError(3)` → `locked`, `attemptsLeft = 3` ; `attemptsLeft` était 1 puis `NotFoundError` → `destroyed_by_password` ; `LimitError(120)` ; compte à rebours à zéro en `locked` → `invalid` sans appel ; `unlock` deux fois de suite → un seul `openShare` ; navigateur intégré → `inapp` puis `locked` après `continueHere()`, `scrubAddressBar` seulement à ce moment ; après succès, aucune référence au mot de passe dans l'état.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.7 et §9.11 (dont la phrase de démo sur « Lien invalide » quand `import.meta.env.MODE === "demo"` : la chaîne vient du module de démo, pas du dictionnaire de production).
- [ ] **Step 4 : e2e** : deux mauvais mots de passe → « 3 essais restants » ; cinq → « Mot de passe incorrect. Le partage a été détruit. », partage absent en Node ; bon mot de passe → contenu ; sans `#` → « Lien incomplet » sans requête `/api/` ; agent Instagram → bandeau, « Copier le lien » donne le lien avec sa clé ; `page.clock` au-delà de l'expiration sur l'écran verrouillé → « Lien invalide » ; `axe` ; captures `open`, `open-badpw`, `open-inapp`, `invalid`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): ouverture, essais, navigateur intégré, liens invalides » et push.

---

### Task 21 : Contenu et visionneuses natives

**Files:**
- Create: `web/src/routes/Content.svelte`, `web/src/viewers/blobs.ts`, `blobs.test.ts`, `collect.ts`, `collect.test.ts`, `ImageViewer.svelte`, `AudioViewer.svelte`, `VideoViewer.svelte`, `TextViewer.svelte`, `web/ui-e2e/content.spec.ts`, `web/ui-e2e/files/trap.svg`, `trap.html`, `hevc.mov` (échantillon non lisible par Chromium)

**Interfaces:** `TYPE_SUR`, `safeBlobType(kind, manifestMime)` ; `trackUrl(blob)` / `revokeAll()` ; `collectPreview(opened, i, onBytes, signal)` ; `previewQueue()` (un aperçu à la fois) ; `PREVIEW_MAX`, `AUTO_IMAGE_MAX`.

- [ ] **Step 1 : Tests qui échouent** : `safeBlobType` (HTML déclaré image → `null`, `video/quicktime` gardé, type inconnu de vidéo → `video/mp4`, `none` → `null`) ; `collectPreview` (octets cumulés, tranches mises à zéro, `signal`) ; `revokeAll` ; `previewQueue` sérialise deux demandes.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.8 : bandeau collé, groupes par `categoryOfReceived` dans l'ordre du manifeste, règles d'aperçu, image révoquée au `load`, vidéo après téléchargement complet, échec de décodage → message + Enregistrer, texte en `<pre dir="auto">`, expiration pendant la lecture, `NotFoundError` en cours de lecture, `beforeunload` pendant un téléchargement seulement, alerte mémoire.
- [ ] **Step 4 : e2e** : partage texte + JPEG + MP3 + MP4 + `trap.svg` + `trap.html` + `hevc.mov` → groupes et ordre identiques à l'envoi ; texte affiché ; image affichée, `window.__pwned` jamais défini, URL blob invalide après `load` ; audio et vidéo lisibles ; `hevc.mov` sur Chromium → « ne peut pas être lu sur cet appareil » ; `trap.html` → Enregistrer seulement ; expiration (`page.clock`) → bandeau « Expiré », boutons désactivés ; destruction par l'expéditeur pendant la lecture → message `NotFoundError` ; Retour → rechargement, aucun texte du partage ; fichier déposé sur la page → aucune navigation ; `axe` ; captures `content`, `content-image`, `content-expired`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(viewers): contenu, image/audio/vidéo/texte, URL blob maîtrisées » et push.

---

### Task 22 : PDF isolé (prototype bloquant, puis visionneuse)

**Files:**
- Create: `web/pdf-frame.html`, `web/src/viewers/pdf-frame/main.ts`, `frame.css`, `web/src/viewers/pdf-host.ts`, `pdf-host.test.ts`, `PdfViewer.svelte`, `web/vite.pdf-frame.config.ts`, `web/ui-e2e/pdf.spec.ts`, `web/ui-e2e/files/js.pdf`, `simple.pdf`
- Modify: `web/package.json` (`pdfjs-dist@6.5.438`, `build` = builds application + cadre PDF + vérification), `THIRD_PARTY_LICENSES.md`

**Interfaces:** messages `{type:"ready"}`, `{type:"pdf", bytes, labels}` (transféré), `{type:"rendered", pages} | {type:"error"}` ; `mountPdf(container, bytes, labels): Promise<"ok" | "fallback">`.

- [ ] **Step 1 : Prototype (bloquant)** : build IIFE `dist/pdf-frame.js` + `.css` ; `getDocument({ data, disableWorkerRendering: true, enableXfa: false, useWasm: false, isOffscreenCanvasSupported: false })` avec `globalThis.pdfjsWorker` ; e2e `pdf.spec.ts › prototype` sur Chromium **et** WebKit : `simple.pdf` → 2 pages, pixel central non transparent ; aucune violation CSP ; aucune requête hors des trois fichiers. Échec après une demi-journée de correction → visionneuse retirée (`pdf` → Enregistrer seulement), raison consignée dans `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md`, passage à la Task 23. Le même test tourne aussi dans la démo (CORP absent sur Pages : sans effet bloquant, UI §14.3).
- [ ] **Step 2 : Tests qui échouent** (`pdf-host.test.ts`) : `ready` d'une autre `source` ignoré ; octets transférés (source détachée) ; 20 s → `fallback` ; `error` → `fallback`.
- [ ] **Step 3 : Implémenter** UI §13.
- [ ] **Step 4 : e2e** : `js.pdf` → aucune boîte de dialogue, aucune navigation ; `iframe.sandbox` vaut exactement `allow-scripts` ; origine du cadre `"null"` ; capture `pdf`.
- [ ] **Step 5 : Lancer** → SUCCÈS (ou repli consigné).
- [ ] **Step 6 : Commit** « feat(viewers): PDF isolé (pdf.js sans worker, cadre sandbox) » et push.

---

### Task 23 : Enregistrer (flux, repli Blob, fichiers à risque)

**Files:**
- Create: `web/src/viewers/save.ts`, `save.test.ts`, `web/src/ui/SaveButton.svelte`, `web/ui-e2e/save.spec.ts`

**Interfaces:** `saveItemTo(opened, i, deps = { showSaveFilePicker?, collectToBlob, click, now }, onBytes, signal): Promise<"saved" | "cancelled" | "failed" | "disk_full">`.

- [ ] **Step 1 : Tests qui échouent** : sélecteur → `suggestedName = safeName(i)`, écriture, `close()`, `saved` ; erreur de `saveItem` → `abort()`, jamais `close()`, `failed` ; `signal` → `abort()`, `cancelled` ; `AbortError` du sélecteur → `cancelled` sans écriture ; `QuotaExceededError` → `abort()`, `disk_full` ; sans sélecteur → `collectToBlob` puis `<a download>` = `safeName(i)`, URL révoquée à 60 s ; aucun chemin n'utilise le MIME du manifeste.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.9 (confirmation `isRiskyFile`, progression en octets et vitesse, Annuler, messages, note « assemblé en mémoire »).
- [ ] **Step 4 : e2e** : Chromium ordinateur avec faux `showSaveFilePicker` → octets identiques ; coupure du 2ᵉ segment au-delà des essais → `abort` et message ; WebKit et téléphones → événement `download`, fichier identique, nom nettoyé (`facture‮fdp.exe` sans U+202E), avertissement avant ; fichier de 300 Mo → Enregistrer seulement ; captures `save-progress`, `save-risky`.
- [ ] **Step 5 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 6 : Commit** « feat(viewers): enregistrement en flux, abandon du partiel, repli Blob » et push.

---

### Task 24 : Terminer, détruire, signaler

**Files:**
- Create: `web/src/flows/endoflife.ts`, `endoflife.test.ts`, `web/src/ui/ReportSheet.svelte`, `web/ui-e2e/endoflife.spec.ts`
- Modify: `web/src/routes/Content.svelte`

**Interfaces:** `finish(opened)` (`done()` → `wipe()` → `revokeAll()`) ; `destroyFromContent(opened, report: boolean)` → `"destroyed" | "gone" | "network"` : `opened.destroy(report ? "report" : undefined)` puis `wipe()` ; `NotFoundError` → `wipe()` + `gone` ; `Error("reseau")` → rien d'effacé.

- [ ] **Step 1 : Tests qui échouent** : `destroy` appelé avec `"report"` pour Signaler, sans argument pour Détruire ; `wipe` après la réponse seulement ; `NotFoundError` → `gone` ; `reseau` → `network`, `wipe` non appelé ; la dissolution n'est demandée qu'après la résolution.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.8 (pied) et §9.10 : Terminer et effacer, Détruire (`InlineConfirm`), Signaler (`Sheet` **sans choix de motif**, texte UI §9.10), `onPageHide` → `finish`.
- [ ] **Step 4 : e2e** : `maxOpens = 3`, Détruire → « Ce partage a été détruit », `fetchMeta` en Node → `NotFoundError` ; `maxOpens = 1` (`draining`) → Détruire fonctionne ; Signaler → détruit ; Terminer et effacer → dissolution, texte absent de la page ; captures `destroy-confirm`, `report-sheet`, `destroyed`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): fin de vie (terminer, détruire, signaler) » et push.

---

### Task 25 : Pages Sécurité et Confidentialité, 404

**Files:**
- Create: `web/src/routes/PageSecurite.svelte`, `PageConfidentialite.svelte`, `web/src/i18n/pages.fr.ts`, `pages.en.ts`, `web/ui-e2e/pages.spec.ts`

- [ ] **Step 1 : e2e qui échoue** : `/securite` contient les limites de la spec §18 (une par élément de liste), ni « 100 % » ni « sécurisé à » ; `/confidentialite` contient « aucun cookie », la liste de la spec §9 et la section `#verification` (« Google voit votre adresse IP », « jamais votre adresse IP » côté serveur) ; route inconnue → « Cette page n'existe pas » ; mesure ≤ 75 ch ; `axe`. Démo : la page Sécurité affiche en plus le tableau des écarts de UI §14.3 (chaîne fournie par le module de démo).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.12, textes relus sur la spec.
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): pages sécurité, confidentialité, 404 » et push.

---

### Task 26 : PWA (manifeste, icônes, sans service worker)

**Files:**
- Create: `web/public/manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `web/scripts/gen-icons.mjs`, `web/ui-e2e/pwa.spec.ts`
- Modify: `web/index.html`

- [ ] **Step 1 : e2e qui échoue** : manifeste conforme à UI §14.1 (chemins relatifs à la base pour la démo) ; icônes à la bonne taille ; aucun service worker ; aucune balise `og:*` ; **une seule** `theme-color` (`#0B0D12`) ; `robots.txt`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** (icône capsule au contour ouvert, PNG par `gen-icons.mjs` commités).
- [ ] **Step 4 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 5 : Commit** « feat(pwa): manifeste et icônes, sans service worker » et push.

---

### Task 27 : Parcours complets, « le serveur ne voit rien » côté navigateur

**Files:**
- Create: `web/ui-e2e/full.spec.ts`, `web/ui-e2e/sees-nothing-ui.spec.ts`
- Modify: `web/ui-e2e/fixtures.ts`

- [ ] **Step 1 : Tests qui échouent.**
  - `full.spec.ts`, quatre projets, mouvement normal et réduit : expéditeur (dépôt d'une photo, collage d'un texte, PDF, vocal simulé, réordonnancement, renommage, options par défaut 12 h / 1, envoi avec une pause, lien prêt, copies) → destinataire dans un **autre contexte** (mauvais mot de passe une fois, déverrouillage, lecture de chaque élément dans l'ordre de l'envoi, enregistrement, Terminer et effacer) → gestion (« Supprimé », car 1 ouverture). `axe` à chaque écran.
  - Clavier seul (Chromium ordinateur) : parcours expéditeur complet, réordonnancement par Alt + flèches compris.
  - 320 px, police racine 24 px, paysage 844 × 390 : aucun débordement horizontal sur chaque écran.
  - `forced-colors: active` (Chromium) : captures de chaque écran, focus visible.
  - `sees-nothing-ui.spec.ts` : repères dans un texte, un nom de fichier (« ReperNomUI.txt », renommé « ReperRenomUI »), un mot de passe personnel ; aucune requête ni réponse capturée ne contient de repère ni la `K_lien` ; puis contrôle du Plan 1 (`web/e2e/scan.ts`) sur les données et journaux du serveur.
  - Démo : le même parcours expéditeur → destinataire dans le même onglet par « Ouvrir comme destinataire (démo) ».
- [ ] **Step 2 : Lancer** → corriger dans la tâche concernée (commit séparé par correction).
- [ ] **Step 3 : Lancer** `make test && make test-ui` + commande démo → SUCCÈS ; joindre le nombre de tests et la liste des captures.
- [ ] **Step 4 : Commit** « test(ui): parcours complets, garde « le serveur ne voit rien » dans le navigateur » et push.

---

### Task 28 : Contrôle visuel (impeccable) et DESIGN.md

**Files:**
- Create: `DESIGN.md`, `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md` (si absent)
- Modify: fichiers d'interface selon les constats

- [ ] **Step 1 : Détecteur** : `sh /root/.claude/skills/synced/10dfe987-33c2-4162-9258-91020c952592_4f3a0d7a-b152-48de-b27e-2ae49c652950/impeccable/scripts/impeccable detect --json web/src/ui web/src/routes web/src/viewers web/index.html` ; corriger les constats mécaniques ; consigner les autres.
- [ ] **Step 2 : Critique sur rendu** (`critique` d'impeccable sur la démo publiée et sur les captures de la Task 27) : rescorer les heuristiques de UI §18.1 sur le rendu réel ; *craft floor* (contrastes, ombres décalées, espacements, mesure, un seul moment par geste, états complets, surfaces du navigateur thémées, textes dans la langue du produit, couverture de chaque exigence de UI §9) ; interdits (étiquette au-dessus des titres, texte en dégradé, bord gauche épais, verre décoratif, emoji, halo sans décalage).
- [ ] **Step 3 : Corriger**, relancer `make test-ui` et la démo, refaire les captures (dernier passage).
- [ ] **Step 4 : DESIGN.md** : jetons et règles tels que construits ; écarts avec UI §3–§8 signalés au propriétaire.
- [ ] **Step 5 : Liste de vérification manuelle** (spec §14) dans le fichier de décisions : iPhone et Android réels — photo (orientation), vocal croisé, vidéo d'iPhone sur Android, PDF, dépôt et collage, réordonnancement avec VoiceOver et TalkBack (mode déplacement), coupure réseau et passage en arrière-plan pendant l'envoi, pause, annulation, mauvais mot de passe, expiration, destruction, installation PWA, aucun gestionnaire de mots de passe qui propose d'enregistrer, navigateur intégré d'Instagram, repli reCAPTCHA (si Q3 acceptée), démo sur `skoow.github.io/Shhdrop`.
- [ ] **Step 6 : Commit** « docs(ui): DESIGN.md, contrôle visuel, liste manuelle » et push.
