# Shhdrop — Plan 2 : les écrans

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une PWA Svelte 5, en français et en anglais, dans le monde visuel « Nuit chiffrée » (toujours sombre), qui permet de composer (glisser-déposer, coller, catégories, ordre), chiffrer, envoyer (progression réelle, pause, annulation, reprise), gérer, ouvrir, lire, enregistrer, détruire et signaler un partage, en s'appuyant uniquement sur l'API cliente (`web/src/index.ts`, complétée en Task 0), servie par le serveur Go sous la CSP stricte de la spec, avec un anti-robot par preuve de travail maison et un repli reCAPTCHA isolé sur une autre origine ; une démo publiée sur GitHub Pages dès le premier écran ; le tout vérifié par des parcours Playwright sur Chromium et WebKit (téléphone et ordinateur) avec captures, contrôle d'accessibilité et garde « aucune violation CSP, aucune ressource tierce ».

**Architecture:** `web/src/index.ts` reste la seule porte vers la crypto et le réseau. Au-dessus : `web/src/ui/` (jetons, composants, mouvement), `web/src/routes/` (écrans), `web/src/flows/` (machines à états testées), `web/src/i18n/`, `web/src/media/` (vocal, métadonnées, catégories), `web/src/captcha/` (preuve de travail, pré-calcul, cadre de repli), `web/src/viewers/`, `web/src/app/` (routeur, lien, cycle de vie, environnement, crochets de démo), `web/src/demo/` (faux serveur, **absent du build de production**). Logique dans des `.ts` / `.svelte.ts` testés par Vitest ; composants `.svelte` minces. Entrées Vite : `index.html` (application), `pdf-frame.html` (cadre PDF, IIFE), `verif/index.html` (page de vérification, build séparé). Mode `demo` : `base: "/Shhdrop/"`, sortie `dist-demo/`. Le serveur Go sert `web/dist` (`static.go`, déjà sur `main`).

**Tech Stack:** Svelte 5.57.3, `@sveltejs/vite-plugin-svelte` 7.3.1, Vite 8.3.5, TypeScript 7.0.2 (+ `svelte-check` 4.7.8 sur TypeScript 6.0.3 dans un paquet outil séparé), Vitest 5.1.0, `@playwright/test` 1.64.1, `@axe-core/playwright` 4.14.0, `pdfjs-dist` 6.5.438, `@lucide/svelte` 1.68.0, `uqr` 0.1.3, polices Mona Sans et JetBrains Mono (Fontsource 5.3.0, fichiers copiés). Go 1.26.

**Spec:** `docs/superpowers/specs/2026-11-04-shhdrop-ui-design.md` (notée « UI », révision 4) et `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (notée « spec », v2.7 : §37 compte facultatif, §38 offre payante).

**Ordre après la Task 8 (5 novembre)** : Task DA (direction artistique v2, UI §20), puis Tasks K1 à K3 (chiffrement anticipé, lien court, spec §29, §31, §32, §34), puis Task M2 (minimisation serveur, aucune statistique, spec §35.1, §36), puis Tasks 9a à 9c (nettoyage des métadonnées, spec §35.2) et 10 à 24, avec la Task 12b conditionnelle (Q-REC1) et les amendements listés après la Task M2, puis Task R (droits), Task H (historique), Tasks A1 à A3 (compte facultatif, spec §37), Tasks V1 à V3 (coffre), Tasks 25 à 27, Tasks C1 à C4 (code vérifiable, C4 conditionnelle), Task 28. Référence visuelle : `docs/superpowers/design/da-v2/`. Lire UI §0, §7, §9, §12, §14.3, §15, §18 et spec §2, §5, §7.4, §10, §12, §13, §18, §19, §21, §24, §25, §35, §36 avant toute tâche. Tasks P1 à P3 (offre payante, spec §38) : **après la mise en ligne de la V1**, selon le moyen de paiement choisi (Q-P1).

## Global Constraints

- **Tout le travail se fait sur `main`** (CLAUDE.md) : aucune branche ; tests au vert avant chaque push ; `git push origin main` à la fin de chaque tâche (ce qui republie la démo, Task 8).
- **Aucune clé, aucune donnée de contenu chiffrée et aucun appel réseau hors de `web/src/index.ts`** (et de `web/src/transfer/` en Task 0). Les écrans n'importent jamais `transfer/api.ts`, `crypto/*` ni `fetch`, et n'appellent jamais `/api/captcha` eux-mêmes (le pré-calcul passe par `prepareCaptcha` de `index.ts`) ; seul `src/demo/` remplace `fetch`/`XMLHttpRequest`, et seulement en mode démo. Le Worker anti-robot (`captcha/pow.worker.ts`) ne calcule que des SHA-256 WebCrypto sur des données publiques (le défi). Contrôlé par un test de recherche dans les sources (Task 1).
- `expectedOrigin` = `location.origin` partout.
- Le serveur ne reçoit jamais de contenu, de nom, de clé ni de mot de passe en clair : le test « le serveur ne voit rien » du Plan 1 reste vert ; la Task 27 l'étend au navigateur.
- **Aucune ressource tierce** sur les pages de l'application (polices, icônes, scripts, styles, images : tout est servi par le serveur) ; aucun `data:`. Seule exception, et seulement dans les Tasks 15–16 : le document du cadre de vérification, servi par l'origine `SHH_VERIF_ORIGIN`, chargé après consentement (UI §15).
- **CSP** de la spec §10 inchangée, sauf `frame-src 'self' {SHH_VERIF_ORIGIN}` quand le repli est activé, et `frame-ancestors 'self'` (au lieu de `'none'`) sur `/pdf-frame.html` seulement. Aucun script ni style en ligne, aucun attribut `style` statique, aucun `eval` / `new Function`, aucun `{@html}`. Toute violation détectée en e2e fait échouer le test.
- Aucun stockage navigateur, sauf deux exceptions écrites : `web/src/vault/` (coffre chiffré, spec §27) et `web/src/history/` (`S_gestion` chiffré, spec §33), contrôlées par `source-rules.test.ts` ; jamais `K_lien`, mot de passe, `R` ni clair. Aucun secret dans la console, le titre, l'URL après `replaceState` (sauf exception navigateur intégré, UI S4), ni dans un `postMessage`.
- `translate="no"`, attributs de saisie de UI §12.3, aucune balise `<form>` sur l'envoi et l'ouverture.
- Visionneuse par `previewKind(i)`, nom par `safeName(i)`, téléchargement en `application/octet-stream` seulement.
- **Un seul thème, sombre** (UI §0.2 P1) : pas de jetons, tests ni captures en clair.
- Accessibilité : WCAG 2.1 AA ; zones tactiles ≥ 44 px ; `prefers-reduced-motion` et `forced-colors` respectés.
- Jamais « 100 % sécurisé », et aucun nom d'algorithme ni terme technique dans les textes de l'interface (UI §20.8).
- **Aucune statistique** (spec §35.1) : aucun SDK de mesure d'audience, de télémétrie ni de rapport d'erreurs, aucun `sendBeacon`, aucun compteur serveur hors de spec §9.5 ; contrôlé par `no-analytics.test.ts`, `stats_test.go` et `check-dist.mjs` (Task M2).
- Versions exactes, **dernière version stable publiée depuis au moins 7 jours, sauf correctif de sécurité** (spec §24), `npm ci` reproductible, `npm audit --omit=dev --audit-level=high` sans alerte, licences dans `THIRD_PARTY_LICENSES.md`.
- On n'annonce une tâche finie qu'avec la sortie des tests (et les captures quand l'écran change).
- Commits : `git commit --author="Skoow <190851638+Skoow@users.noreply.github.com>" -m "…"` (aucune surcharge de `user.*`).
- **Démo à jour** : à partir de la Task 8, toute tâche qui change un écran finit par `npm run build:demo && node scripts/check-dist.mjs --demo && npx playwright test --project='demo-*'` (SUCCÈS exigé ; projets `demo-chromium-mobile` et `demo-webkit-desktop`) avant le push.

## Review Focus

1. **Le lien ne fuit pas** : après `/s/…#k` et `/m/…#s`, `location.hash === ""`, l'historique ne contient plus le `#`, aucune requête ne porte `K_lien`/`S_gestion` (Tasks 5, 27).
2. **Le contenu reçu ne s'exécute jamais** : SVG avec script, HTML, PDF avec JavaScript → aucune exécution, aucune navigation, aucune violation CSP (Tasks 21, 22).
3. **Google n'approche pas les clés** : aucune requête vers Google depuis le cadre principal ; le cadre de vérification n'a qu'une autre origine ; le jeton n'est accepté que de `event.origin === fallbackOrigin && event.source === iframe.contentWindow` ; rien ne se charge avant le clic de consentement (Tasks 15, 16).
4. **Le code de démo est absent de la production** (Task 8, `check-dist.mjs` en CI).
5. **Annuler et quitter** : annulation et `pagehide` pendant l'envoi détruisent le partage créé (`keepalive`) ; jamais « Lien prêt » avant la résolution de `createShare` (Tasks 0, 17).
6. **Reprise réelle** : une coupure de 60 s pendant l'envoi ne perd pas l'envoi ; une pause est bornée à 10 min et par l'échéance unique « dernier segment acquitté + `SERVER_STALL_MS` » (13 min), la même que celle de la coupure (Tasks 0, 17).
7. **Enregistrement interrompu** : `writable.abort()`, jamais « Enregistré » (Task 23).
8. **Métadonnées** : JPEG d'iPhone avec MPF et image secondaire, HEIC, MOV de téléphone (piste de position, `tmcd`), PDF à révisions, DOCX avec commentaires → aucune trace GPS, appareil, auteur ni date ; orientation, ICC, matrice de rotation intactes ; un échec n'est jamais affiché « Nettoyé » (Tasks 9a à 9c).
9. **Minimisation** : aucune heure d'ouverture ni d'envoi en base, motif de destruction fermé, aucune réponse qui recopie un identifiant, lecture monotone, aucune statistique (Task M2).

---

## Prérequis

- Durcissement fusionné sur `main` (fait : spec v2.5, `web/src/index.ts`, `server/cmd/shhdrop/static.go`).
- Questions UI §19 : **Q3 réglée** (exception reCAPTCHA validée par le propriétaire, spec v2.5 §26 et CLAUDE.md amendés : les Tasks 15 et 16 ne sont plus bloquées) ; **Q2 réglée** (preuve de travail pré-calculée dès le premier élément composé, repli Google seulement si la borne vraie dépasse 60 s) ; **Q1 reste ouverte** : le code est générique sur `SHH_VERIF_ORIGIN` et refuse au démarrage une origine du même site que `SHH_ORIGIN` ; le choix réel (organisation GitHub gratuite proposée) se fait à la migration.
- Task M (mineurs reportés, commit a9af58d) faite avant la Task 0.

## Structure des fichiers

```
web/index.html                          # entrée de l'application (aucun script/style en ligne)
web/pdf-frame.html                      # cadre PDF isolé
web/verif/index.html | verif.ts | verif.css | config.js   # page de vérification (autre origine, build séparé)
web/vite.config.ts                      # Svelte, entrées, mode demo (base /Shhdrop/, dist-demo), demoGuard, CSP meta de démo
web/vite.pdf-frame.config.ts | vite.verif.config.ts
web/playwright.config.ts                # chromium/webkit × ordinateur/téléphone + projets demo-chromium-mobile, demo-webkit-desktop
web/tools/svelte-check/package.json | package-lock.json   # svelte-check 4.7.8 + typescript 6.0.3 (S5)
web/src/env.d.ts                        # vite/client + declare module "*.svelte"
web/public/fonts/*.woff2 | assets/grain.png | icon*.png|svg | manifest.webmanifest | robots.txt | apple-touch-icon.png
web/scripts/copy-fonts.mjs | gen-grain.mjs | gen-icons.mjs | gen-fixtures.mjs | check-dist.mjs
web/src/transfer/*                      # compléments de l'API (Task 0) : upload.ts, prepare.ts
web/src/main.ts | App.svelte
web/src/app/router.svelte.ts | link.ts | lifecycle.ts | env.ts | viewport.ts | demo-hooks.ts
web/src/i18n/fr.ts | en.ts | i18n.svelte.ts | format.ts | pages.fr.ts | pages.en.ts
web/src/ui/tokens.css | fonts.css | base.css | motion.ts | contrast.ts | *.svelte
web/src/media/strip.ts | format.ts | patch.ts | bytes.ts | exif.ts | crc32.ts | clean-label.ts   # porte commune (Task 9a)
web/src/media/jpeg.ts | png.ts | webp.ts | gif.ts | heif.ts | isobmff.ts                       # images (9a)
web/src/media/pdf.ts | zip.ts | xmlattr.ts | ooxml.ts | odf.ts                                # PDF et bureautique (9b)
web/src/media/mp4.ts | ebml.ts | mp3.ts | ogg.ts | flac.ts | wav.ts                           # vidéo et audio (9c)
web/src/media/recorder.ts | camera.ts (12b) ; web/src/transfer/readorder.ts (M2)
web/scripts/gen-media-fixtures.sh                                                              # fichiers d'essai réels, lancé à la main
web/src/flows/compose.svelte.ts | options.svelte.ts | send.svelte.ts | stats.ts | manage.svelte.ts | receive.svelte.ts | endoflife.ts
web/src/captcha/pow.ts | pow.worker.ts | prefetch.ts | verif-host.ts | solve.ts
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

### Task 0 : Compléments de l'API cliente (annulation, octets, pause, reprise, preuve, pré-calcul)

**Files:**
- Modify: `web/src/transfer/client.ts`, `web/src/transfer/api.ts`, `web/src/index.ts`, `web/src/transfer/client.test.ts`, `web/src/transfer/api.test.ts`, `web/e2e/*.ts` (adaptation à `CaptchaProof` et à la clé `captcha_salt`)
- Create: `web/src/transfer/upload.ts`, `web/src/transfer/upload.test.ts`, `web/src/transfer/prepare.ts`, `web/src/transfer/prepare.test.ts`

**Interfaces:**
```ts
type CaptchaProof = { kind: "pow"; payload: string } | { kind: "recaptcha"; token: string };
type CaptchaCtx = { fallbackOrigin: string | null; mode: "pow" | "fallback" };   // createShare passe mode "pow" ; createSender (Task 17) impose "fallback" au dernier essai
// prepare.ts — défi anti-robot récupéré à l'avance (pré-calcul, Q2)
type PreparedCaptcha = { readonly challenge: unknown; readonly fallbackOrigin: string | null; readonly expiresAt: number /* ms, lu dans « expires= » du sel */ };
  // `shownAt` et l'instant de réception restent internes (opaques pour les écrans)
prepareCaptcha(origin: string, net?: Net): Promise<PreparedCaptcha>;   // GET /api/captcha ; note l'instant de réception
type CreateOpts = Net & {
  ttlHours: 1 | 6 | 12 | 24; maxOpens: number; password: string;
  solveCaptcha: (challenge: unknown, ctx: CaptchaCtx) => Promise<CaptchaProof>;
  prepared?: { cap: PreparedCaptcha; proof: Promise<CaptchaProof> };   // utilisé s'il reste plus de 15 s de validité, sinon nouveau défi
  onProgress?: (done: number, total: number) => void;          // segments (inchangé)
  onBytes?: (sent: number, total: number) => void;             // octets chiffrés, maximum atteint (monotone)
  onRetry?: (r: { attempt: number; inMs: number; offline: boolean }) => void;
  pause?: () => Promise<void> | void;                          // attendue avant chaque segment
  signal?: AbortSignal;
};
// upload.ts — transport des PUT de segment
type Uploader = (url: string, headers: Record<string, string>, body: Uint8Array, onBytes: (n: number) => void, signal?: AbortSignal) => Promise<{ status: number; json: unknown }>;
export const xhrUploader: Uploader;      // navigateur : XMLHttpRequest.upload.onprogress
export const fetchUploader: Uploader;    // Node / tests
export const SERVER_STALL_MS = 780_000;  // échéance unique : 13 min après le dernier segment acquitté (le serveur efface à 15 min, spec §7.4 et §24 : marge de 2 min), puis Error("reseau")
// index.ts exporte : createShare, prepareCaptcha, type PreparedCaptcha, type CaptchaProof, type CaptchaCtx, SERVER_STALL_MS, PREVIEW_MAX (de crypto/container),
//   et `export { safeName as cleanName } from "./transfer/safety"`
```
Corps de `POST /api/shares` : `altcha` (preuve de travail) **ou** `recaptcha` (jeton) + **`captcha_salt`** (le sel du défi émis). La clé `salt` du corps reste le sel KDF et n'est pas touchée.

- [ ] **Step 1 : Tests qui échouent** (`client.test.ts`, `upload.test.ts`, `prepare.test.ts`, `fetch` et `Uploader` simulés, horloge injectée) :
  - `signal` annulé avant `solveCaptcha` → `AbortError`, aucun `POST /api/shares` ; annulé pendant l'envoi → `AbortError`, un `POST /destroy` avec `manage` envoyé avec `keepalive: true` ; les générateurs de clés sont espionnés (`vi.spyOn`) pour garder les tableaux rendus : après l'annulation, comme après un succès, tous leurs octets valent 0.
  - `onBytes` : la valeur émise est le **maximum atteint** (monotone), elle finit à la somme exacte de `segmentSize(bucket, n)` ; un segment réessayé n'émet rien tant que son cumul ne dépasse pas ce maximum (test : le segment 2 échoue à 60 %, le nouvel essai n'émet aucune valeur avant d'avoir dépassé ces 60 %).
  - `pause` : tant que la promesse n'est pas résolue, aucun `PUT` suivant.
  - Coupure : 3 minutes d'échecs puis succès → envoi terminé, `onRetry` appelé avec des attentes 1, 2, 4, 8, 16, 30, 30… s ; `Retry-After` d'une 429 respecté (attente = `max(attente, retryAfter)`) ; aucun essai interne : un `PUT` en échec = un seul appel de l'`Uploader` par essai du budget ; l'échéance est « dernier segment acquitté + `SERVER_STALL_MS` » (un segment acquitté la repousse) : au-delà → `Error("reseau")` puis `destroy` ; événement `online` → essai immédiat.
  - `finalize` coupé puis rétabli → succès (budget seul, pas d'essai interne).
  - `solveCaptcha` reçoit `{ fallbackOrigin, mode: "pow" }`, `fallbackOrigin` lu dans `GET /api/captcha` (`fallback` absent → `null`) ; `{kind:"pow"}` → corps `altcha` ; `{kind:"recaptcha"}` → corps `recaptcha` + `captcha_salt`, sans `altcha`, et `salt` (sel KDF) identique à celui d'un envoi `altcha`.
  - `prepared` : défi préparé avec plus de 15 s de validité → `GET /api/captcha` non rappelé, `solveCaptcha` non appelé, `prepared.proof` utilisée ; moins de 15 s → nouveau défi et `solveCaptcha` appelé ; l'attente de 3,1 s (`CAPTCHA_MIN_MS`) se compte depuis la **réception du défi** (défi préparé 5 s plus tôt : aucune attente ; préparé 1 s plus tôt : 2,1 s) ; `prepareCaptcha` lit `fallback` et `expires`.
  - `index.ts` exporte `cleanName`, `prepareCaptcha`, `SERVER_STALL_MS`, `PREVIEW_MAX`, `type CaptchaProof`, `type PreparedCaptcha`.
- [ ] **Step 2 : Lancer** `cd web && npm test -- transfer` → ÉCHEC.
- [ ] **Step 3 : Implémenter.** `upload.ts` : `xhrUploader` (`xhr.upload.onprogress`, `signal` → `xhr.abort()`), `fetchUploader`. `prepare.ts` : `prepareCaptcha` (même lecture du défi que `createShare`). `client.ts` : boucle de segments avec `await o.pause?.()`, `o.signal?.throwIfAborted()` aux points d'attente (défi, attente de 3,1 s, chaque segment) ; le défi n'est lu par `createShare` que si `prepared` est absent ou a moins de 15 s de validité ; budget de coupure (échéance `SERVER_STALL_MS`) autour de `putSegment` et `finalize`, sans essai interne (`retry: true` retiré de `putSegment` dans `api.ts` ; `api.send` inchangé pour les autres routes) ; chemin d'échec existant `api.destroy(…, { sGestion })` passé en `keepalive`. Choix du transport : `xhrUploader` si `XMLHttpRequest` existe et que `net.fetch` n'est pas fourni, sinon `fetchUploader`.
- [ ] **Step 4 : Lancer** `npm test && make test` (le test « le serveur ne voit rien » et les e2e du Plan 1 restent verts) → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(client): annulation, octets envoyés, pause, reprise sur coupure, preuve anti-robot typée, pré-calcul » et push.

---

### Task 1 : Socle Svelte, Vite, contrôles de sources

**Files:**
- Create: `web/index.html`, `web/src/main.ts`, `web/src/App.svelte`, `web/src/env.d.ts`, `web/vite.config.ts`, `web/tools/svelte-check/package.json`, `web/tools/svelte-check/package-lock.json`, `web/src/source-rules.test.ts`
- Modify: `web/package.json`, `web/tsconfig.json`, `web/vitest.config.ts`, `THIRD_PARTY_LICENSES.md`, `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:** scripts npm `build`, `build:demo` (Task 8), `check` = `tsc --noEmit && npm --prefix tools/svelte-check exec -- svelte-check --workspace ../.. --fail-on-warnings` (commande à valider au premier passage), `test` = `tsc --noEmit && vitest run src scripts`. `test:ui` et la cible `make test-ui` viennent en Task 2 (ils ont besoin de la configuration Playwright). Attention : `npm test -- motif` s'ajoute à `src scripts` et lance donc tout ; pour cibler un fichier, `npx vitest run <chemin>`.

- [ ] **Step 1 : Tests qui échouent.** `source-rules.test.ts` parcourt `web/src/**/*.{ts,svelte}` (hors `crypto/`, `transfer/`, `index.ts`, `demo/`, tests) et échoue si : `{@html` ; `style="` dans un `.svelte` ; `eval(` ou `new Function` ; import de `../transfer/`, `../crypto/` ou `fetch(` / `XMLHttpRequest` dans `routes/`, `ui/`, `flows/`, `viewers/`, `media/`, `captcha/`, `app/` ; `localStorage|sessionStorage|indexedDB|document.cookie` ; `console.log` ; import de `demo/` ailleurs que dans `main.ts`, et dans `main.ts` seulement sous la forme `import("./demo/install")`. Plus : `vite.config.ts` résolu a `assetsInlineLimit === 0` et `modulePreload.polyfill === false`. `vitest.config.ts` reste en `environment: "node"` ; les tests qui exigent un DOM (Tasks 5, 6 et 16) portent `// @vitest-environment happy-dom` en tête de fichier.
- [ ] **Step 2 : Lancer** `cd web && npx vitest run src/source-rules.test.ts` → ÉCHEC.
- [ ] **Step 3 : Implémenter.** `npm i -E svelte@5.57.3` ; dev : `@sveltejs/vite-plugin-svelte@7.3.1`, `@playwright/test@1.64.1`, `@axe-core/playwright@4.14.0`, `happy-dom@21.0.4` (`npm i -D -E`, licence MIT, ajoutée à `THIRD_PARTY_LICENSES.md`, `npm audit --omit=dev --audit-level=high` sans alerte ; version à revérifier par `npm view happy-dom version` à l'installation). `tsconfig.json` : `include` = `["src", "e2e", "scripts"]` (le test de la garde de démo, Task 8, tourne ainsi dans `npm test`). `src/env.d.ts` : `/// <reference types="vite/client" />` et `declare module "*.svelte"` (sans quoi `tsc` ne connaît ni les `.svelte` ni `import.meta.env`). `vite.config.ts` : plugin Svelte, `assetsInlineLimit: 0`, `modulePreload: { polyfill: false }`, `sourcemap: false`. `index.html` : `<html lang="fr" translate="no">`, `<meta name="google" content="notranslate">`, `<meta name="color-scheme" content="dark">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`, un seul `<script type="module" src="/src/main.ts">`, aucune balise `og:*`. `tools/svelte-check/package.json` : `svelte-check@4.7.8`, `typescript@6.0.3`, `svelte@5.57.3` ; `package-lock.json` commité (`npm ci` reproductible) ; `--fail-on-warnings`. CI : job `web` ajoute `npm ci --prefix tools/svelte-check`, `npm run build` et `npm run check` (le job `ui` vient en Task 2). `.gitignore` : `web/dist-demo/`, `web/ui-e2e/__captures__/`, `web/test-results/`, `web/playwright-report/`.
- [ ] **Step 4 : Lancer** `npm test && npm run build && npm run check` → SUCCÈS ; `dist/index.html` sans `<script>` sans `src` ni `<style>`.
- [ ] **Step 5 : Commit** « feat(web): socle Svelte 5 + Vite, règles de sources » et push.

---

### Task 2 : En-têtes par chemin et banc Playwright

Le serveur statique existe déjà (`server/cmd/shhdrop/static.go`) ; cette tâche n'ajoute que ce qui manque (UI §14.2).

**Files:**
- Create: `server/internal/api/static_paths.go`, `server/internal/api/static_paths_test.go`, `web/public/robots.txt`, `web/playwright.config.ts`, `web/ui-e2e/fixtures.ts`, `web/ui-e2e/shell.spec.ts`
- Modify: `server/internal/api/headers.go`, `web/package.json` (`test:ui`), `Makefile` (cible `test-ui`), `.github/workflows/ci.yml` (job `ui`)

**Interfaces:**
- Go : `withHeaders` pose, en plus : `X-Robots-Tag: noindex` sur `/s/*` et `/m/*` ; `Cross-Origin-Resource-Policy: cross-origin` sur `/pdf-frame.html`, `/pdf-frame.js`, `/pdf-frame.css` seulement (liste fermée) ; `frame-ancestors 'self'` au lieu de `'none'` dans la CSP de `/pdf-frame.html` **seulement** (le cadre PDF est embarqué par l'application elle-même ; `'none'` le bloquerait en production, la meta de la démo l'ignorant). `frame-src 'self' <origine>` (repli reCAPTCHA) est ajouté en Task 15, avec le champ `VerifOrigin`.
- TS : fixture `shh` = `{ origin, server, cspViolations, foreignRequests }`, serveur Go neuf **par test** (`startServer` de `web/e2e/server.ts`, `SHH_STATIC_DIR` = `web/dist` absolu) ; fin de test : `expect(cspViolations).toEqual([])`, `expect(foreignRequests).toEqual([])`. Helpers `capture(page, nom)` et `axe(page)` (`wcag2a, wcag2aa, wcag21a, wcag21aa`).

- [ ] **Step 1 : Tests Go qui échouent** : `TestRobotsHeaderOnSharePaths` ; `TestPdfFrameCORP` (trois fichiers → `cross-origin`, tout autre → `same-origin`) ; `TestPdfFrameAncestors` (`/pdf-frame.html` → CSP avec `frame-ancestors 'self'` et sans `'none'` ; tout autre chemin, `/pdf-frame.js` compris, garde `frame-ancestors 'none'`) ; `TestFrameSrcDefault` (CSP inchangée) ; `TestSecurityHeadersKept`.
- [ ] **Step 2 : Lancer** `cd server && go test ./internal/api/ -run 'Robots|PdfFrame|FrameSrc|SecurityHeaders'` → ÉCHEC.
- [ ] **Step 3 : Implémenter** ; `robots.txt` : `Disallow: /s/`, `Disallow: /m/`. Script `test:ui` (`playwright test`), cible `make test-ui` (`cd web && npm run test:ui`), job CI `ui` : `npx playwright install --with-deps chromium webkit && make test-ui`, captures en artefact (créé ici, pas en Task 1 : il lui faut la configuration et les tests Playwright).
- [ ] **Step 4 : Tests Playwright qui échouent** (`shell.spec.ts`) : accueil sous la CSP sans violation ni requête tierce ; `/s/x`, `/m/x` servent l'application ; `translate="no"` et meta notranslate. Projets `chromium-desktop` (1440 × 900), `webkit-desktop`, `chromium-mobile` (Pixel 7), `webkit-mobile` (iPhone 15) ; `globalSetup` = `go build` + `npm run build`. Garde CSP : `addInitScript` sur `securitypolicyviolation` + `page.on("console")` « Refused to ». Garde tierce : `page.on("request")` sur `page.mainFrame()` seulement, toute origine autre que `shh.origin` ou `blob:` enregistrée.
- [ ] **Step 5 : Lancer** `go test ./... && cd ../web && npx playwright test shell` → SUCCÈS sur les quatre projets.
- [ ] **Step 6 : Commit** « feat(server): en-têtes par chemin ; banc Playwright ; job CI ui » et push.

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

- [ ] **Step 1 : Tests qui échouent.** `readLink` (valide, sans `#`, mauvais préfixe, avec base `/Shhdrop/`) ; `scrubAddressBar` ; `inAppBrowser` sur 12 agents réels et 5 navigateurs ordinaires, `standalone` → `null` ; `isSupported` faux sans `crypto.subtle`, `WebAssembly`, `Blob.prototype.stream`, `AbortController`, vrai sans `Worker` ; `guardUnload` ; `guardFileDrop` appelle `preventDefault` sur `drop` quand `allow()` est faux ; `keyboardOpen`. Les tests qui touchent `window`, `History` ou des événements portent `// @vitest-environment happy-dom`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** et brancher dans `App.svelte` : `reloadIfRestored`, `isSupported` avant toute route, `guardFileDrop` global, classe `kbd-open` sur `<html>` selon `keyboardOpen` (barres collées repassées dans le flux par CSS).
- [ ] **Step 4 : e2e** (`hygiene.spec.ts`) : `/s/<id>#<clé>` → `location.hash === ""`, Retour ne réaffiche pas le `#` ; idem `/m/` ; agent Instagram → `location.hash` conserve la clé (aucune requête `/api/` n'est partie) ; le clic « Continuer ici quand même » est testé en Task 20, où l'écran existe ; sans `crypto.subtle` → « non pris en charge », aucune requête `/api/` ; fichier déposé sur `/s/x` → l'URL ne change pas (`page.dispatchEvent` de `drop` avec un `DataTransfer`).
- [ ] **Step 5 : Lancer** `npm test && npx playwright test hygiene` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): hygiène du lien, bfcache, dépôt neutralisé, clavier virtuel » et push.

---

### Task 6 : Composants de base

**Files:**
- Create: `web/src/ui/Button.svelte`, `IconButton.svelte`, `TextField.svelte`, `TextArea.svelte`, `Segmented.svelte`, `Stepper.svelte`, `CopyField.svelte`, `Banner.svelte`, `InlineConfirm.svelte`, `Sheet.svelte`, `UndoToast.svelte`, `Countdown.svelte`, `countdown.ts`, `clipboard.ts`, `motion.ts` + tests

**Interfaces:** `createCountdown(expiresInS, now)` → `{ remaining(); display(lang); announceAt() }` (seuils 3600, 900, 300, 60, 0) ; `copyText(text)` → `"copied"` si `navigator.clipboard.writeText` réussit, `"manual"` s'il est absent ou rejette ; `clearClipboard()` ; `reducedMotion()`, `flip(els, mutate)` ; `Button` prop `onpress` avec garde de ré-entrée (désactivé avant tout `await`).

- [ ] **Step 1 : Tests qui échouent** : compte à rebours (horloge injectée, jamais négatif) ; `copyText` (API simulée qui résout → `"copied"` ; qui rejette ou absente → `"manual"`) ; `flip` sans animation en mouvement réduit ; `Button` (fichier `// @vitest-environment happy-dom`) : deux clics synchrones → un seul appel de `onpress`.
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
- Create: `web/src/app/demo-hooks.ts`, `web/src/demo/install.ts`, `fake-server.ts`, `fake-xhr.ts`, `DemoBanner.svelte`, `fake-server.test.ts`, `web/scripts/check-dist.mjs`, `web/scripts/check-dist.test.ts`, `web/ui-e2e/pages-server.ts`, `web/ui-e2e/demo.spec.ts`
- Modify: `web/vite.config.ts` (mode `demo`, greffons `demoGuard` et `demoMeta`, copie `404.html`), `web/src/main.ts`, `web/package.json` (`build:demo`), `web/playwright.config.ts` (projets `demo-chromium-mobile` : Pixel 7, et `demo-webkit-desktop` : un projet Playwright = un appareil), `.github/workflows/pages.yml`, `.github/workflows/ci.yml`, `Makefile`
- Delete: `web/demo-attente/` (page d'attente)

**Interfaces:**
```ts
// fake-server.ts — mêmes routes, corps et codes que server/internal/api (spec §8)
createFakeServer(opts?: { now?: () => number; rateBytesPerS?: number; outage?: { atFraction: number; ms: number } }): {
  handle(req: Request): Promise<Response>;   // /api/* seulement
  shares(): number;                          // pour les tests
};
installDemo(w: Window): void;               // remplace fetch et XMLHttpRequest pour /api/*, monte DemoBanner, préfixe le titre, appelle setDemo(…)
// app/demo-hooks.ts — seul point lu par les écrans (ils n'importent jamais `demo/`, règle de Task 1) ; aucune marque __SHH_DEMO__
type DemoHooks = { solveCaptcha: (challenge: unknown, ctx: CaptchaCtx) => Promise<CaptchaProof>; openAsRecipient(link: string): void; invalidLinkNote: string; securityGaps: string };
getDemo(): DemoHooks | null;                // null en production
setDemo(h: DemoHooks): void;                // appelé par installDemo seulement
```
- `main.ts` : `if (import.meta.env.MODE === "demo") await (await import("./demo/install")).installDemo(window);` **avant** le montage de l'application. Chaque fichier de `src/demo/` contient la marque `const MARK = "__SHH_DEMO__"`.
- En démo, `installDemo` remplit `setDemo({ solveCaptcha, openAsRecipient, invalidLinkNote, securityGaps })` ; le `solveCaptcha` de démo rend `{ kind: "pow", payload: "demo" }` ; le flux d'envoi (Task 17) utilise `getDemo()?.solveCaptcha ?? solveCaptcha`, et le pré-calcul (Task 14) n'est pas branché quand `getDemo() !== null`. Le faux serveur ne vérifie aucune preuve et rend `fallback: null`. Les écrans des Tasks 17, 18, 20 et 25 lisent leurs crochets de démo (preuve factice, bouton destinataire, phrase de « Lien invalide », tableau des écarts) uniquement par `getDemo()`.

- [ ] **Step 1 : Tests qui échouent.**
  - `fake-server.test.ts` : le **vrai** client contre le faux serveur (`net.fetch = (u, i) => fake.handle(new Request(u, i))`) : `createShare` → `openShare` → `saveItem` rend les octets d'origine ; mauvais mot de passe ×5 → `NotFoundError` ensuite ; `maxOpens = 1` → `draining`, `Opened.destroy()` fonctionne ; `shareStatus` ; segment de mauvaise taille → 400 ; expiration (horloge injectée) → 404 ; `destroy` par `S_gestion` en `uploading` ; le faux serveur ne voit jamais de repère en clair (même contrôle que le test « le serveur ne voit rien », sur ses `Request`).
  - `check-dist.test.ts` : sur un dossier factice contenant `__SHH_DEMO__`, `check-dist.mjs` échoue ; sans la marque, il passe ; avec `--demo`, l'inverse est exigé (marque, meta CSP, `404.html` présents).
- [ ] **Step 2 : Lancer** `cd web && npx vitest run src/demo scripts/check-dist.test.ts` → ÉCHEC.
- [ ] **Step 3 : Implémenter.**
  - `vite.config.ts` : `mode === "demo"` → `base: "/Shhdrop/"`, `build.outDir: "dist-demo"`, greffon `demoMeta` (`transformIndexHtml` : CSP meta, `referrer`, `robots` de UI §14.3 en tête de `<head>`), copie `index.html` → `404.html` ; sinon greffon `demoGuard` (`generateBundle` : échec si un module dont l'id contient `/src/demo/` est dans le bundle).
  - `fake-xhr.ts` : `XMLHttpRequest` minimal pour `PUT /api/…/segments/*` (envoie à `handle`, émet `upload.onprogress` au débit simulé, gère `abort`) ; tout autre XHR passe à l'original.
  - `install.ts` : lit `?lent` (1 Mo/s) et `?coupure` ; monte `DemoBanner` dans l'emplacement de `AppShell` (`role="note"`, texte UI §14.3, non fermable, collé en haut, `--warn-tint`) ; titre « Démo · … » ; bouton « Ouvrir comme destinataire (démo) » exposé aux écrans par `getDemo()?.openAsRecipient` (utilisé en Task 18).
  - `check-dist.mjs [--demo]` : parcourt `dist/` (ou `dist-demo/`) et applique les règles ci-dessus ; branché dans `make test-web` et le job `web` de la CI après `npm run build`. `check-dist.test.ts` tourne dans `npm test` (`vitest run src scripts`, `tsconfig.include` couvre `scripts`, Task 1).
  - `pages.yml` : garder déclencheurs (`push` sur `main`, `workflow_dispatch`), permissions et `deploy` ; remplacer l'étape d'artefact par : `actions/setup-node` (épinglée par empreinte, même version de Node que `ci.yml`), `npm ci` dans `web`, `npm run build:demo`, `node scripts/check-dist.mjs --demo`, `actions/upload-pages-artifact` sur `web/dist-demo`. Supprimer `web/demo-attente/`.
  - `pages-server.ts` (tests) : serveur HTTP Node qui imite Pages : sert `dist-demo/` sous `/Shhdrop/`, `404.html` avec le code 404 pour tout chemin absent, **aucun** en-tête de sécurité.
- [ ] **Step 4 : e2e** (`demo.spec.ts`, projets `demo-chromium-mobile` et `demo-webkit-desktop`) : `/Shhdrop/` affiche l'accueil et le bandeau ; `/Shhdrop/s/abc#x` (adresse profonde, servie par `404.html`) est reconnue comme la route d'ouverture (`match` → `open`) et aucune requête ne porte `x` (les messages « Lien invalide » et la phrase de démo sont testés en Task 20, où l'écran existe) ; aucune violation de la CSP meta ; aucune requête hors de l'origine ; `localStorage.length === 0`. Les tâches suivantes ajoutent leur parcours à ce fichier.
- [ ] **Step 5 : Lancer** `npm test && npm run build && node scripts/check-dist.mjs && npm run build:demo && node scripts/check-dist.mjs --demo && npx playwright test --project='demo-*'` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(demo): démo GitHub Pages (faux serveur en mémoire, absente de la production) » et push sur `main` ; vérifier que le workflow `pages` passe et que `https://skoow.github.io/Shhdrop/` affiche l'accueil (capture jointe).

---

### Task DA : Direction artistique v2 — jetons, fond, composants de base, accueil (UI §20)

À faire **juste après la Task 8**, avant la Task 9a : les écrans suivants se construisent sur ces composants. Référence visuelle : `docs/superpowers/design/da-v2/` ; en cas d'écart, UI §20 (corrections K1 à K14) l'emporte.

**Files:**
- Create: `web/scripts/gen-aurora.mjs`, `web/scripts/gen-aurora.test.ts`, `web/public/assets/aurora-mint.png`, `aurora-tide.png`, `aurora-ink.png`, `web/src/ui/Aurora.svelte`, `web/src/ui/decor.ts`, `decor.test.ts`, `web/src/ui/viewTransition.ts`, `viewTransition.test.ts`, `web/src/ui/Vessel.svelte` (contour seulement ; dépôt et catégories en Task 10), `web/ui-e2e/aurora.spec.ts`
- Modify: `web/src/ui/tokens.css`, `tokens.test.ts`, `base.css`, `motion.ts`, `motion.test.ts`, `AppShell.svelte`, `Button.svelte`, `Button.test.ts`, `IconButton.svelte`, `web/src/routes/Home.svelte`, `web/src/ui/Schema.svelte`, `web/src/i18n/fr.ts`, `en.ts`, `i18n.test.ts`, `web/ui-e2e/home.spec.ts`, `web/src/source-rules.test.ts`

**Interfaces:**
```ts
// decor.ts — texte décoratif (UI §20.2 S1) : jamais de crypto, de clé ni de lien
rng(seed: number): () => number;                 // LCG 1664525 / 1013904223, comme da-v2/js/app.js
cipherText(seed: number, cols: number, rows: number): string;   // alphabet base64, déterministe
scramble(text: string, k: number, seed: number): string;        // k ∈ [0,1], même longueur
// viewTransition.ts
runTransition(update: () => void, opts?: { reduced?: boolean }): Promise<void>;
  // update synchrone ; sans document.startViewTransition → update() direct ; skipTransition() au premier pointerdown/keydown (K2)
// motion.ts (ajouts)
capPath(w: number, h: number, r: number): string;   // contour qui part du milieu du bord haut, sens horaire
pressScale: 0.97; iconPressScale: 0.92;
```

- [ ] **Step 1 : Tests qui échouent.**
  - `tokens.test.ts` : valeurs exactes de UI §20.3 (`--bg-deep: #07080C`, `--vessel: rgb(17 20 27 / 0.62)`, `--seal-light: #C9FBE8`, `--aur-mint-o: 0.18`, `--aur-tide-o: 0.34`, `--aur-ink-o: 0.32`, `--r-2xl: 32px`, `--dur-press: 90ms`, `--dur-view: 420ms`, `--dur-reveal: 560ms`, `--ease-view: cubic-bezier(0.22, 1, 0.36, 1)`) ; `contrastFromLuminance(L(--text-2), 0.050) ≥ 4.70` et `contrastFromLuminance(L(--text-3), 0.050) < 4.5` (raison écrite de la règle « `--text-3` jamais sur l'aurore ») ; aucun `backdrop-filter` dans une règle qui utilise `--vessel` (K6).
  - `gen-aurora.test.ts` : trois PNG de 128 × 128, identiques octet pour octet à deux exécutions (graine fixe), couleurs dominantes `#5FE3B5`, `#28809A`, `#3456AA`, total < 16 Ko.
  - `decor.test.ts` : `cipherText(77, 40, 6)` stable (instantané) ; `scramble("abc", 0, 1) === "abc"`, longueur conservée pour k = 1 ; le fichier n'importe rien de `crypto/`, `transfer/` ni `index.ts` (lecture du source).
  - `viewTransition.test.ts` (`// @vitest-environment happy-dom`) : sans `startViewTransition`, `update` appelé une fois, de façon synchrone ; avec une API simulée, `skipTransition` appelé au `pointerdown` ; `reduced: true` → classe `vt-reduced` posée.
  - `motion.test.ts` : `capPath(200, 100, 32)` commence par `M 100 0` ; mouvement réduit → `flip` n'anime rien (inchangé).
  - `Button.test.ts` : avec la pression animée, deux clics synchrones → un seul `onpress` (inchangé).
  - `i18n.test.ts` : règle des mots interdits de UI §20.8 sur `fr.ts` et `en.ts` (les pages viendront en Task 25) ; `destroyed.body` = texte K7 ; `hero.title` intact.
  - `source-rules.test.ts` : `getImageData` interdit hors `viewers/` ; `setAttribute("style"` interdit partout.
  - e2e `home.spec.ts` (ajouts) : à 390 × 844 la rangée d'ajout est visible sans défiler (S4 : schéma sous le réceptacle) ; le `<h1>` a pour nom accessible la phrase entière et la copie animée est `aria-hidden` (K8) ; toutes les animations d'entrée sont finies à 900 ms (`document.getAnimations()` : `endTime` ≤ 900, hors ambiance) (K1) ; un clic sur le réceptacle à 100 ms ouvre le sélecteur (rien n'attend) ; mouvement réduit → aucune animation infinie ; `forced-colors` → aurore `display: none` ; captures `home-v2-390`, `home-v2-1440`, `home-v2-reduced`, `home-v2-forced`, comparées à `docs/superpowers/design/da-v2/shots/01-accueil-*.png`.
  - e2e `aurora.spec.ts` (Chromium) : `main.style.visibility = "hidden"` par CSSOM, capture, luminance relative maximale ≤ **0,050** dans les états repos, `body.dataset.screen = "seal"`, éclat à son pic (animation `aurora-burst` mise en pause à 1 000 ms) et `destroyed` (K4, K5) ; `document.hidden` simulé → animations de l'aurore en pause ; aucune violation CSP.
- [ ] **Step 2 : Lancer** `cd web && npm test && npx playwright test home aurora` → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §20.3, §20.4 (« Ambiance », « Accueil et composeur » pour le titre, le réceptacle vide et le schéma), §20.7 : `gen-aurora.mjs` sur le modèle de `gen-grain.mjs` (sans dépendance), images posées à 128 px et agrandies par `transform: scale()` (K11) ; `Aurora.svelte` monté par `AppShell` (`aria-hidden`, `view-transition-name: aurora`) ; états par `body[data-screen]` ; `Button` : pression 0,97 (`--dur-press`), reflet du bouton principal, cadenas en deux tracés (anse ouverte, anse fermée), accroche du focus ; `IconButton` : 0,92 ; `Home` : titre mot par mot (K1, K8), ordre mobile (S4), suppression du `transition: font-size` ; `Schema` : boucle de 6,4 s dans l'ambiance (K10). Mesurer la mémoire des calques d'aurore (panneau Layers, Chromium, Pixel 7 émulé) : ≤ 32 Mo, valeur consignée dans le fichier de décisions.
- [ ] **Step 4 : Lancer** `npm test && npx playwright test home aurora shell` puis la commande démo des Global Constraints → SUCCÈS ; relire les captures.
- [ ] **Step 5 : Commit** « feat(ui): direction artistique v2 (aurore, jetons, boutons, accueil) » et push.

---

### Task K1 : Chiffrement v2 — clé de contenu aléatoire, enveloppe, paquet « SHH2 », API serveur (spec §29, §31, §34)

Change `web/src/crypto`, `web/src/transfer` et le serveur. Aucune construction maison : HKDF, HMAC, SHA-256, AES-256-GCM (WebCrypto), Argon2id (libsodium). Pas de compatibilité v1 (aucun partage en production) ; la démo suit (faux serveur mis à jour).

**Files:**
- Modify: `web/src/crypto/kdf.ts`, `kdf.test.ts`, `container.ts`, `container.test.ts`, `passphrase.ts`, `passphrase.test.ts`, `types.ts`, `web/src/transfer/client.ts`, `client.test.ts`, `api.ts`, `api.test.ts`, `web/src/index.ts`, `web/e2e/*.ts` (dont le test « le serveur ne voit rien »), `web/src/demo/fake-server.ts`, `fake-server.test.ts`, `server/internal/share/*.go`, `server/internal/store/*.go` (schéma), `server/internal/api/handlers_share.go`, `server/internal/limits/*.go`, `server/internal/blob/*.go`, leurs `*_test.go`
- Create: `web/src/crypto/envelope.ts`, `envelope.test.ts`, `web/src/crypto/password.ts`, `password.test.ts`

**Interfaces:**
```ts
// envelope.ts
type Seed = Uint8Array & { readonly __seed: unique symbol };         // R, 32 octets
newSeed(): Seed;                                                     // crypto.getRandomValues
contentKeys(r: Seed): Promise<{ kContenu: CryptoKey /* AES-GCM, non extractible */; engagement: Uint8Array }>;
  // kContenu = HKDF(R, "shhdrop/v2/contenu") ; engagement = HMAC-SHA-256(R, "shhdrop/v2/engagement")
accessKeys(kLien: KLien, kMdp: Uint8Array): Promise<{ kEnv: CryptoKey; kPreuve: KPreuve; vPreuve: Uint8Array }>;
  // kMaitre = HKDF(kLien ‖ kMdp, "shhdrop/v2/maitre") ; kEnv = HKDF(kMaitre, "shhdrop/v2/enveloppe") ; kPreuve = HKDF(kMaitre, "shhdrop/v2/preuve")
seal(kEnv: CryptoKey, r: Seed, id: Uint8Array, header: Uint8Array): Promise<Uint8Array>;   // 60 octets : nonce ‖ GCM(R), AAD = "shhdrop/v2/enveloppe" ‖ id ‖ header
open(kEnv: CryptoKey, e: Uint8Array, id: Uint8Array, header: Uint8Array): Promise<Seed>;  // erreur unique "paquet_corrompu"
shareId(kLien: KLien): Promise<Uint8Array>;                          // HKDF(kLien, "shhdrop/v2/id"), 16 octets
// password.ts (spec §31)
type GeneratedPassword = string & { readonly __gen: unique symbol };
PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%+=?@";   // 64 symboles
generatePassword(): GeneratedPassword;                                // 8 caractères, 4 familles présentes
// manifeste v2 (container.ts)
type Rights = "voir" | "enregistrer" | "coffre";
type ManifestV2 = { v: 2; rights: Rights; keep_ttl_h?: 1 | 6 | 12 | 24; items: ManifestEntry[] };
parseRights(m: unknown): { rights: Rights; keepTtlH: number | null };   // absent, inconnu, mal typé → "voir"
```
Corps serveur (spec §29.8) : création `id`, `bucket`, `access_v`, `manage_v`, preuve ; `finalize` `salt`, `kdf_ops`, `kdf_mem`, `proof_v`, `envelope` (80 caractères base64url, 60 octets), `ttl_hours`, `max_opens`, `fill_from`, `fill_to` ; `unlock` rend `envelope` ; quotas débités à `finalize` (spec §29.5).

- [ ] **Step 1 : Tests TS qui échouent.**
  - `envelope.test.ts` : aller-retour `seal`/`open` ; `open` échoue (même erreur `paquet_corrompu`) avec un autre `id`, un autre en-tête, un octet de `E` modifié, un autre mot de passe ; `E.length === 60` ; deux `seal` du même `R` → nonces différents ; `contentKeys` : `kContenu.extractable === false` ; vecteurs fixes (`K_lien` = 32 × `0x01`, `K_mdp` = 32 × `0x02`, `R` = 32 × `0x03`) : `shareId`, `vPreuve` et `engagement` égaux aux valeurs calculées par un script Node indépendant (`node:crypto` `hkdfSync`, `createHmac`), consignées dans le test ; étiquettes toutes préfixées `shhdrop/v2/`.
  - `password.test.ts` : 10 000 tirages → longueur 8, uniquement des symboles de `PASSWORD_ALPHABET`, 4 familles présentes, aucun de `0 O 1 l I o` ; fréquence de chaque symbole dans [0,8 ; 1,2] × l'attendu ; `checkPassword` accepte un `GeneratedPassword` de 8 caractères et refuse une chaîne saisie de 8 caractères (12 au moins, inchangé) ; `generatePassphrase` reste exportée pour « Utiliser mon propre mot de passe ».
  - `container.test.ts` : paquet v2 (« SHH2 ») : manifeste en fin de clair, longueur dans les 4 derniers octets ; palier canonique = plus petit palier ≥ fin des données + 4 + 65 536 ; aller-retour sur tous les paliers ; chaque numéro de morceau chiffré au plus une fois (espion sur `encrypt` : aucun doublon de nonce) ; `parseRights` (`{rights:"coffre", keep_ttl_h: 12}` → coffre/12 ; `"coffre"` sans `keep_ttl_h` → `"voir"` ; `"admin"`, `true`, absent → `"voir"`) ; droit par défaut de `createShare` : `"enregistrer"`.
  - `client.test.ts` : `createShare` v2 : création sans `proof_v`, `finalize` avec `envelope`, `fill_from`/`fill_to` corrects pour un palier de 400 morceaux et 9 Mio de données (segments envoyés : 0, 1, 2 et le dernier ; `fill` = [3, 6)) ; `openShare` : `unlock` → `envelope` → lecture ; `C_engagement` faux → `paquet_corrompu` ; `R`, `K_mdp` et `K_maître` mis à zéro après usage (espions, comme en Task 0).
- [ ] **Step 2 : Tests Go qui échouent.** `finalize` refusé si un segment hors `[fill_from, fill_to)` manque, si `fill_to` dépasse le palier, si `fill` touche le dernier segment ; bourrage rempli par `crypto/rand` (le fichier ne contient aucune suite de 4 096 zéros dans `[fill_from, fill_to)`) ; `unlock` rend `envelope` seulement en `ready` ; `proof_v` `NULL` avant `finalize` : `unlock` → 404 uniforme ; `id` existant → 409 ; quotas : 10 créations finalisées par jour (création refusée quand atteint), 2 non finalisées à la fois par connexion, octets abandonnés débités à l'effacement (6 Gio par jour, puis 429) ; JSON strict sur les nouveaux champs (longueurs exactes).
- [ ] **Step 3 : Lancer** `cd web && npm test` et `cd server && go test ./...` → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §29.2, §29.3, §29.5, §29.8, §31, §34 (manifeste v2). Mettre à jour le faux serveur de démo (mêmes routes et règles).
- [ ] **Step 5 : « Le serveur ne voit rien » étendu** (`web/e2e/`) : repères dans un texte, un nom de fichier, un mot de passe saisi, `R` et `K_lien` ; aucun repère dans la base (pages libres et WAL compris), les fichiers, les journaux, les requêtes capturées ni la mémoire exportée ; le bourrage rempli par le serveur ne contient ni repère ni zéros.
- [ ] **Step 6 : Lancer** `make test` (dont « le serveur ne voit rien ») et la commande démo → SUCCÈS.
- [ ] **Step 7 : Commit** « feat(crypto): clé de contenu aléatoire enveloppée, paquet SHH2, mot de passe de 8 caractères, droits du destinataire » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M5, constantes uniques.** Exporter, depuis un seul module, les constantes lues par les écrans pour les chiffres affichés : taille maximale (`CONTENT_MAX`), nombre maximal d'éléments, durée maximale, ouvertures maximales, nombre d'essais de mot de passe. *Contrôle* : `limits.test.ts` : les valeurs égalent celles des tests Go (même nombre côté serveur) ; `source-rules.test.ts` interdit ces chiffres écrits en dur dans `fr.ts` et `en.ts`.
- [ ] **Texte « Le serveur ne reçoit que des données chiffrées, jamais la clé » et « Même les noms de vos fichiers sont chiffrés ».** Ces phrases ne sont vraies que si le serveur ne stocke aucun nom ni type. *Contrôle* : test « le serveur ne voit rien » : dans la base de test et les réponses d'API, aucune sous-chaîne des noms ni du texte saisis, et la réponse de statut ne contient que taille, échéance et compteurs (de quoi construire la fiche S1 de la Task 19, rien de plus).

---

### Task K2 : Lien court et gestion par `V_gestion` (spec §32)

**Files:**
- Modify: `web/src/transfer/link.ts`, `link.test.ts`, `web/src/app/link.ts`, `link.test.ts`, `web/src/app/router.svelte.ts`, `router.test.ts`, `web/src/index.ts`, `web/ui-e2e/hygiene.spec.ts`, `server/internal/api/handlers_share.go`, `server/internal/store/*.go`, `server/cmd/shhdrop/static.go` (repli `/s/`, `/m/` retiré), tests Go
- Create: `server/internal/api/handlers_manage.go`, `handlers_manage_test.go`

**Interfaces:** `shareLink(origin, kLien)` → `${origin}/#${b64u(kLien)}` ; `manageLink(origin, sGestion)` → `${origin}/#m${b64u(sGestion)}` ; `parseLink(url)` → `{kind:"s", origin, kLien}` | `{kind:"m", origin, sGestion}` (l'`id` se calcule par `shareId`) ; `match("/")` + fragment → `open` ou `manage`. Serveur : `GET /api/manage/status`, `POST /api/manage/destroy` (en-tête `X-Shh-Manage`, 43 caractères), recherche par `manage_v`.

- [ ] **Step 1 : Tests qui échouent.** `parseLink` : `/#` + 43 caractères base64url → `s` ; `/#m` + 43 → `m` ; 42 ou 44 caractères, alphabet invalide, `/x#…`, identifiants (`user:pw@`), autre origine → `lien_invalide` ; requête `?fbclid=…` ignorée ; avec la base `/Shhdrop/` (démo) ; longueur du lien de partage = `origin.length + 45`. Routeur : `/` sans fragment → `home`, `/` + fragment valide → `open`/`manage`, fragment invalide → `home` puis retrait. Go : `manage/status` et `manage/destroy` avec `S_gestion` valide / faux (404 uniforme) ; deux partages ne partagent jamais `manage_v` (index unique) ; anciennes routes `/{id}/status` → 404. e2e `hygiene.spec.ts` : `/#<clé>` → `location.hash === ""` après lecture, Retour ne réaffiche pas la clé, aucune requête ne porte la clé ; navigateur intégré : fragment gardé jusqu'à « Continuer ici ».
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §32 ; retirer `X-Robots-Tag` et le repli de `/s/`, `/m/` devenus inutiles (le préfixe `/s/` reste réservé, spec §16).
- [ ] **Step 4 : Lancer** `make test && npx playwright test hygiene` et la commande démo → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(link): lien court à la racine, gestion par V_gestion » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M13 (forme du lien).** La forme réelle du lien court est la référence de l'exemple surligné de la Task 25. *Contrôle* : `link.test.ts` exporte une expression de forme réutilisée par le test de `pages.spec.ts`.
- [ ] **Anti-motif « domaines voisins ».** Un seul domaine ; aucun raccourcisseur tiers ; le mot de passe n'apparaît jamais dans le lien (M18). *Contrôle* : `link.test.ts` : le lien produit ne contient pas le mot de passe, et `parseLink` rejette un lien d'un autre hôte ; `hygiene.spec.ts` : la partie après `#` n'est jamais envoyée au serveur (journal des requêtes).

---

### Task K3 : Envoi anticipé et pré-lecture (spec §29.4, §29.6)

**Files:**
- Create: `web/src/transfer/draft.ts`, `draft.test.ts`, `web/src/transfer/prefetch.ts`, `prefetch.test.ts`
- Modify: `web/src/transfer/client.ts`, `web/src/index.ts`, `server/internal/api/handlers_share.go` (lecture de segment par `K_accès`, budget), `server/internal/limits/*.go`, tests Go, `web/e2e/`, `web/src/demo/fake-server.ts`

**Interfaces:**
```ts
createDraft(origin: string, deps: { solveCaptcha; prepared?; net?; now? }) → {
  sync(items: Item[]): void;             // ajoute à la suite, ou redémarre (élément déjà chiffré retiré/remplacé, palier dépassé)
  precomputePassword(pw: GeneratedPassword | string): void;   // Argon2id en arrière-plan, annulé par un nouvel appel
  send(opts: { password; ttlHours; maxOpens; rights; keepTtlH? }, onBytes?): Promise<{ link; manage; expiresInS }>;
  abort(): void;                          // destroy keepalive ; R mise à zéro
  state(): { phase: "idle" | "uploading" | "caught_up" | "restarting" | "refused"; sentBytes: number; restarts: number };
};
DRAFT_IDLE_MS = 2000; DRAFT_MAX_RESTARTS = 3 /* par 10 min */; PREFETCH_MAX = 64 * 2 ** 20;
prefetchShare(link, expectedOrigin, net?) → { segments: Map<number, Uint8Array>; stop(): void };   // segment de fin, puis données
```
`openShare` utilise les segments pré-lus (même vérification d'authenticité : rien n'est cru avant le déchiffrement).

- [ ] **Step 1 : Tests qui échouent** (horloge et `fetch` simulés) : aucun `POST /api/shares` avant 2 s de composition stable, ni page masquée, ni `saveData` ; ajout qui tient dans le palier → aucun redémarrage, segments suivants envoyés ; retrait d'un élément dont un morceau est chiffré → `destroy` keepalive de l'ancien partage puis nouveau partage, avec **nouveaux** `K_lien`, `R` et `sel` (espions) ; retrait d'un élément jamais chiffré → aucun redémarrage ; renommage et réordonnancement → aucun redémarrage ; 4ᵉ redémarrage en 10 min → refusé, envoi au clic ; aucun numéro de morceau chiffré deux fois sous le même `R` (espion) ; `send` quand tout est rattrapé → au plus 2 `PUT` puis `finalize` ; `precomputePassword` puis `send` avec le même mot de passe → Argon2id appelé une fois ; `abort` → `R` à zéro ; 429 d'envoi anticipé → phase `refused`, `send` fait tout au clic. Pré-lecture : segment de fin d'abord, arrêt à 64 Mio, `stop()` ; Go : `GET segment` avec `K_accès` accepté en `ready`, refusé en `uploading`, `draining`, après expiration, et au-delà de 2 × palier par partage (429) ; ne consomme aucune ouverture.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §29.4 et §29.6.
- [ ] **Step 4 : e2e** (`web/e2e/`, vrai serveur) : composition de 20 Mio → segments partis avant le clic ; clic → « Lien prêt » en moins de 5 s sur la boucle locale ; abandon (page fermée) → partage absent du serveur ; destinataire : segments pré-lus pendant la saisie, ouverture identique ; « le serveur ne voit rien » avec un mot de passe saisi après le début de l'envoi anticipé.
- [ ] **Step 5 : Lancer** `make test` et la commande démo → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(transfer): envoi anticipé pendant la composition, pré-lecture chez le destinataire » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M3, coches justes malgré l'envoi anticipé.** Les segments partent avant le clic, mais « Envoyé » ne s'affiche qu'après l'accusé du dernier segment et « Scellé » après `finalize`. *Contrôle* : e2e : composition de 20 Mio, clic : « Envoyé » n'apparaît pas à l'instant du clic si des segments restent ; il apparaît après l'accusé du dernier.
- [ ] **M9, la pré-lecture ne compte pas comme ouverture.** La phrase de la Task 20 (« L'ouvrir maintenant compte cette ouverture, même si vous rechargez la page ») n'est vraie que si la lecture anticipée de segments pendant la saisie ne consomme pas d'ouverture et que l'ouverture est comptée au déverrouillage. *Contrôle* : e2e : destinataire qui pré-lit pendant la saisie puis recharge sans déverrouiller → `shareStatus` en Node : 0 ouverture ; après déverrouillage → 1. **Signalement (moyenne)** : vérifier ce point contre spec §29.6 avant de figer le texte ; s'il est faux, corriger le texte, pas le test.
- [ ] **Abandon.** « Un partage abandonné est absent du serveur » appuie la phrase « S'efface tout seul ». *Contrôle* : e2e existant (page fermée → partage absent).

---

### Task M2 : minimisation serveur, aucune statistique (spec §35.1, §36)

Chaque étape reprend une ligne « À faire » de spec §36 (repère S…) ou de §35.1. Placée juste après K3 : elle modifie la pré-lecture (K3), `finalize` (K1) et les colonnes de la base. Ce qui touche Caddy, Docker et journald (S1, S2, S3, S17) va au Plan 3, avec les tests décrits en spec §36.

**Files:**
- Create: `server/internal/api/minimize_test.go`, `server/internal/stats_test.go` (recherche dans les sources et `go.sum`), `web/src/no-analytics.test.ts`, `web/src/transfer/readorder.ts`, `readorder.test.ts`
- Modify: `server/internal/store/store.go` (colonnes), `server/internal/share/service.go` (échéances en mémoire, effacement au démarrage, `ttl_hours` à `NULL`), `server/internal/api/handlers_share.go` (`reason`, `/healthz`), `server/internal/api/api.go`, `server/internal/captcha/captcha.go` (heures à la minute), `server/internal/limits/*.go` (méthode `Len()` par compteur, pour les tests), `server/internal/janitor/janitor.go`, `web/src/transfer/prefetch.ts`, `web/src/transfer/draft.ts`, `web/src/transfer/client.ts`, `web/e2e/sees-nothing.test.ts`, `web/e2e/scan.ts`, `web/scripts/check-dist.mjs`

- [ ] **Step 1 : Tests qui échouent — aucune statistique (§35.1).**
  - `web/src/no-analytics.test.ts` : la liste de spec §35.1 cherchée sans tenir compte de la casse dans `web/src`, `web/scripts`, `web/*.html`, les noms de paquets de `package-lock.json` ; `check-dist.mjs` fait la même recherche dans `dist/`, `dist-verif/`, `dist-demo/` ; un fichier piégé de test (`gtag(` dans une chaîne) prouve que la recherche le trouve ; aucun écouteur `error` ni `unhandledrejection` ailleurs que dans une liste blanche vide.
  - `server/internal/stats_test.go` : aucun import interdit (§35.1) dans `server/` ni dans `go.sum` ; toute déclaration `map[` dans `server/internal` hors de la liste blanche (fichier et nom de variable, une entrée par ligne de spec §9.5) fait échouer le test avec le message « nouveau compteur : ajouter une ligne justifiée à spec §9.5 » ; aucun client HTTP sortant (`http.Client`, `http.Get`, `net.Dial`) hors de `captcha/recaptcha.go`.
  - Rotation : horloge injectée, chaque compteur de §9.5 rempli puis vide après sa durée (`Len() == 0`) : minute, heure, 2 min, 3 h, minuit UTC.
  - Schéma : `sqlite_master` ne contient que `shares` et ses index.
- [ ] **Step 2 : Tests qui échouent — base et heures (S5, S11, S12).**
  - Après `finalize` : colonnes `progress_at`, `upload_deadline`, `purge_at` **absentes** du schéma (migration qui les retire) ; `ttl_hours` à `NULL` ; seule date en base : `expires_at`, multiple de 900.
  - Envoi bloqué 15 min, envoi vide 5 à 20 min, échéance de 3 h, `purge_at` de l'état `draining` : mêmes résultats qu'avant (tests existants de `share/` rejoués), avec des échéances tenues en mémoire.
  - Redémarrage simulé (nouveau `Service` sur la même base) : tout partage `uploading` ou `draining` est effacé, fichier compris ; un partage `ready` reste.
  - Anti-robot : les heures gardées pour la difficulté sont des multiples de 60 s ; la difficulté double toujours à chaque création de l'heure.
- [ ] **Step 3 : Tests qui échouent — requêtes (S2, S14, S17, S18, S21).**
  - `minimize_test.go` : recherche dans `server/` : aucun `UserAgent()`, `Referer()`, `RemoteAddr` hors de `clientip.go` et `/healthz` ; aucune lecture d'en-tête hors de `Authorization`, `X-Shh-Client-IP`, `X-Shh-Access`, `X-Shh-Manage`.
  - `destroy` : `reason` absent ou `"report"` → accepté ; `"ReperRaison"`, `""`, `"REPORT"` → 400 `bad_request` ; aucune réponse ne contient « ReperRaison ».
  - Échos : pour chaque route, un identifiant repère (`ReperIdAAAAAAAAAAAAAA`, longueur valide puis invalide), un en-tête `X-Repere: ReperEntete` et un corps repère : aucune réponse (corps et en-têtes) ne les contient ; seules les valeurs d'erreur de la liste fixe sortent.
  - Sorties : stdout et stderr du serveur sur un parcours complet avec `X-Shh-Client-IP: 203.0.113.77` et `User-Agent: ReperUA/1.0` : seulement `SHH_LISTENING …` ; aucune adresse ni repère.
  - `/healthz` (boucle locale) : `{"ok":true,"reports_alert":false}` ; 5 signalements dans l'heure → `true` ; heure suivante → `false` ; aucun autre champ.
- [ ] **Step 4 : Tests qui échouent — client (S4, S9, S10).**
  - `readorder.test.ts` : `planReads(manifest, wanted)` rend, après le segment de fin, une suite **strictement croissante** de numéros de segments ; ouvrir l'élément 5 avant l'élément 2 → les segments des éléments 1 à 5 sont lus dans l'ordre (ceux de 1 à 4 conservés s'ils tiennent dans le cache de lecture de 64 Mio, sinon jetés) ; seul un nouvel essai répète un numéro ; revenir à un élément déjà jeté relit depuis son premier segment, une seule fois (budget de 2 × le paquet, spec §24).
  - `prefetch.test.ts` : la pré-lecture démarre à la réponse de `meta`, dans l'ordre fin, 0, 1, 2… jusqu'à 64 Mio, à un rythme qui ne dépend d'aucun événement clavier (espion : 0 frappe contre 20 frappes → mêmes instants de requête, horloge injectée).
  - `draft.test.ts` : mode « Envoyer seulement quand je clique » → tous les segments de bourrage sont envoyés par le navigateur (octets de `crypto.getRandomValues`, jamais de zéros), `finalize` sans `fill_from` ni `fill_to` ; mode anticipé → inchangé (K1). Côté serveur : `finalize` sans `fill_*` exige que tous les segments soient présents.
- [ ] **Step 5 : « Le serveur ne voit rien » étendu** (`web/e2e/sees-nothing.test.ts`, `scan.ts`) selon spec §36 : IP repère (texte et 4 octets), User-Agent, Referer et Accept-Language repères, identifiant repère dans une route inconnue, `reason` repère ; aucun sur disque (base, WAL, fichiers), dans stdout, stderr ni dans les réponses ; dates de la base multiples de 900 s, colonnes retirées absentes ; en mode « au clic », aucun `finalize` avec `fill_from`. La fouille de la mémoire garde ses repères de contenu et de clés.
- [ ] **Step 6 : Lancer** `make test` → ÉCHEC sur chaque test nouveau (sortie jointe).
- [ ] **Step 7 : Implémenter** : migration de la base (copie dans une nouvelle table `WITHOUT ROWID` sans les trois colonnes, `secure_delete` déjà actif, puis `VACUUM`) ; échéances d'envoi, de blocage et de purge dans une table en mémoire du `Service` ; effacement au démarrage ; `ttl_hours` à `NULL` à `finalize` ; `reason` en énumération ; compteur horaire des signalements et `/healthz` ; heures de l'anti-robot à la minute ; `readorder.ts` branché dans `client.ts` (lecture des éléments et enregistrement) ; pré-lecture à calendrier fixe ; bourrage envoyé par le navigateur en mode « au clic ».
- [ ] **Step 8 : Lancer** `make test && make test-ui` puis la commande démo → SUCCÈS ; joindre le nombre de tests.
- [ ] **Step 9 : Mettre à jour** spec §36 : chaque ligne passée de « À faire M2 » à « Fait », avec le commit ; spec §9.1 (colonnes) ; mêmes changements dans le faux serveur de la démo (`web/src/demo/fake-server.ts`).
- [ ] **Step 10 : Commit** « feat(server): minimisation (heures en mémoire, motif fermé, aucun écho, aucune statistique), lecture monotone » et push.

**Transmis au Plan 3** (spec §36 S1, S2, S3, S17, §35.1) : Caddyfile qui écrase `X-Shh-Client-IP`, retire `User-Agent`, `Referer`, `Accept-Language`, `Cookie`, `Sec-CH-UA*`, `Sec-Fetch-*`, `DNT`, `Priority` avant de transmettre, journaux vers `discard`, `admin off`, pas de `metrics` ; Docker `log-driver: none` ; journald `Storage=volatile` ; test de déploiement : 20 requêtes avec IP et User-Agent repères, puis fouille de `/var/lib/docker`, `/var/log`, du volume de données et de la mémoire du serveur Go (en-têtes retirés absents).

---

### Amendements aux tâches existantes (5 novembre, spec v2.6, UI révision 4)

- **Task 10** : le composeur vit dans `Vessel` (UI §20.4) ; `createComposer` appelle `draft.sync(toApiItems())` à chaque changement (Task K3) ; e2e : ligne « L'envoi chiffré commence en arrière-plan » visible dès le premier élément.
- **Task 13** : `createOptions()` : mot de passe par défaut `generatePassword()` (8 caractères), bouton « Générer un autre », `draft.precomputePassword` à chaque nouveau mot de passe ; `rights: "enregistrer"` par défaut, `RightsPicker` ; « Voir seulement » désactivé avec la raison si un élément ne s'affiche pas dans le navigateur (spec §34) ; textes de UI §10 (révision 4).
- **Task 14** : le pré-calcul anti-robot sert d'abord à la création de l'envoi anticipé (Task K3).
- **Task 17** : `createSender` s'appuie sur `draft.send` ; phases visibles au clic : « Préparation des clés » (souvent instantanée), envoi de ce qui reste, « Finalisation » ; capsule et fermeture du sceau de UI §20.4 (900 ms, K3), `PerformanceObserver` : aucune trame longue > 50 ms ; e2e : clic → « Lien prêt » ≤ 5 s quand l'envoi anticipé a rattrapé.
- **Task 18** : lien court (`/#…`) ; QR en points (UI §20.2 S7) décodé en CI ; bascule « Garder dans mon historique » (Task H) ; rappel « ouvrir dans l'app » si `rights === "coffre"`.
- **Task 19** : `manageStatus` et `manageDestroy` par `S_gestion` (Task K2).
- **Task 20** : pré-lecture pendant la saisie (Task K3) ; note fixe « ouvrez-y ce lien » dans un navigateur de téléphone (spec §27.6).
- **Tasks 21 et 23** : droit `"voir"` : aucun Enregistrer ni Copier, `controlsList="nodownload"`, `disablePictureInPicture`, mention de spec §34 (détails en Task R).
- **Task 25** : page Sécurité en langage courant, liens vers `docs/securite-technique.md` (Task C3) et `/verifier` ; règle des mots interdits étendue à `pages.fr.ts` et `pages.en.ts`.
- **Task 27** : parcours complets avec envoi anticipé, droits et lien court ; « le serveur ne voit rien » avec `R`, et les repères de spec §36 (IP, User-Agent, Referer, identifiant, motif, Task M2) ; fichiers d'essai des Tasks 9a à 9c envoyés puis reçus : aucun repère dans le fichier enregistré par le destinataire.
- **Task 10 (composeur déjà livré, d46f19e)** : interface `strip` et états remplacés par ceux de la Task 9a (`CleanState` à cinq valeurs, échec ajouté en `echec` au lieu d'être refusé, `blockReason` `non_nettoye`, `acceptUncleaned`) ; `STRIP_MAX` ne s'applique plus qu'aux images ; `STRIPPABLE` remplacé par `detectFormat`.
- **Tasks 13 et R (spec §34.1, décision du propriétaire)** : plus de `RightsPicker` à trois choix. Un `Switch` « Autoriser le téléchargement », activé par défaut (`"enregistrer"`), désactivé → `"voir"` ; sous-option « Autoriser aussi une copie chiffrée dans l'app, sur téléphone » (`"coffre"`, `keep_ttl_h` = durée), visible seulement quand l'interrupteur est activé, désactivée par défaut, proposée à tout expéditeur ; interrupteur bloqué activé, avec la liste des éléments en cause, si un élément ne s'affiche pas dans le navigateur. Le manifeste et `allowedActions` ne changent pas. Tests : interrupteur activé au chargement ; le désactiver masque et décoche la sous-option ; `role="switch"` nommé ; `axe`.
- **Tasks 20, 21, 23** : pré-lecture à calendrier fixe et lecture monotone (Task M2) ; aucun numéro de segment plus petit qu'un numéro déjà demandé, sauf nouvel essai.

---

### Tasks 9a à 9c : nettoyage des métadonnées (spec §35.2)

Remplacent l'ancienne Task 9 (JPEG, PNG, WebP seulement). Règles communes, à lire avant chaque sous-tâche : spec §35.2 (tableau par format, états, textes, fichiers d'essai). Analyseurs écrits à la main, sans dépendance ; aucune exception non rattrapée ; aucun fichier entier en mémoire au-delà de `STRIP_MAX` (50 Mio, `web/src/limits.ts`) ; une seule porte : `stripMetadata`.

**Interfaces (communes, posées en 9a) :**
```ts
type CleanState = "nettoye" | "echec" | "protege" | "non_pris_en_charge" | "sans";
type CleanNote = "suivi_modifs" | "pdf_revisions";
type StripResult =
  | { state: "nettoye"; data: Blob; notes: CleanNote[]; family: "image" | "video" | "audio" | "pdf" | "bureautique" | "vocal" }
  | { state: "echec" | "protege"; reason: string }            // reason : code interne, jamais affiché tel quel
  | { state: "non_pris_en_charge" | "sans" };
stripMetadata(file: Blob, mime: string, name: string, opts?: { recorded?: boolean; signal?: AbortSignal }): Promise<StripResult>;
detectFormat(head: Uint8Array, mime: string, name: string): Format;   // octets magiques d'abord, puis MIME, puis extension
type Patch = { at: number; bytes: Uint8Array };                        // correctif à longueur constante
patchedBlob(src: Blob, patches: Patch[], cut?: { from: number; to: number }[]): Blob;   // tranches + correctifs, jamais de copie entière
cleanLabelKey(r: StripResult, category: Category): I18nKey | null;    // le seul endroit qui choisit « Nettoyé · … »
```
Le composeur (déjà livré, `flows/compose.svelte.ts`) passe de `strip?: (Blob, mime) => Promise<Uint8Array>` à `strip?: typeof stripMetadata` ; `CleanState` remplace `"nettoye" | "non_nettoye" | "sans_objet"` ; un échec **ajoute** l'élément en `echec` (au lieu de `failedClean` + refus) et `blockReason()` rend `non_nettoye` tant que la personne n'a pas choisi **Envoyer tel quel** (`composer.acceptUncleaned(id)`) ou **Retirer** (spec §35.2, Q-MD1). Un élément en cours de nettoyage (`status: "nettoyage"`) n'est jamais transmis à `draft.sync` (Task K3).

### Task 9a : Images (JPEG avec MPF, PNG, WebP, GIF, HEIC/HEIF/AVIF) et porte commune

**Files:**
- Create: `web/src/media/strip.ts`, `format.ts`, `patch.ts`, `bytes.ts` (lecteur borné : `u8`, `u16be/le`, `u32be/le`, `u64be`, erreur typée `Malformed` au premier dépassement), `exif.ts` (EXIF minimal à une entrée 0x0112), `jpeg.ts`, `png.ts`, `webp.ts`, `gif.ts`, `heif.ts`, `isobmff.ts` (boîtes : lecture, liste blanche, neutralisation `free`, partagé avec 9c), `crc32.ts`, `clean-label.ts`, tests `*.test.ts` de chacun, `web/scripts/gen-fixtures.mjs` (images), `web/scripts/gen-media-fixtures.sh` (HEIC, AVIF : `heif-enc`, `avifenc`, `exiftool`, versions en tête), `web/src/media/fixtures/*`
- Modify: `web/src/flows/compose.svelte.ts`, `compose.test.ts`, `web/src/flows/kinds.ts` (reste de l'ancienne Task 9 : `categoryOfReceived(previewKind, safeName)`, qui lit la même table par extension que `categoryOf`, déjà livré), `web/src/i18n/fr.ts`, `en.ts` (textes de spec §35.2), `web/ui-e2e/compose.spec.ts`

- [ ] **Step 1 : Fichiers d'essai.** `gen-fixtures.mjs` (sans dépendance, octet par octet ; CI le relance et compare) : `iphone-like.jpg` (EXIF orientation 6 + Make « ReperMake » + Model « ReperModel » + GPS repère 12° 34′ 56″ N, 65° 43′ 21″ O + DateTimeOriginal 2001:02:03 04:05:06 + IFD1 avec vignette, XMP « ReperXMP », XMP étendu, ICC en 2 morceaux, MPF, APP13 IPTC « ReperIPTC », COM « ReperCOM », APP14, image 8 × 8 réelle, EOI, **seconde image avec EXIF « ReperSecond »**, puis un faux MP4 « ReperMotion » de photo animée) ; `progressive.jpg` (plusieurs SOS, RST) ; `meta.png` (tEXt, zTXt, iTXt XMP, tIME, eXIf orientation 8, `iDOT`, iCCP, APNG à 2 images) ; `meta.webp` (VP8X + EXIF + XMP + ICCP + ANIM) ; `simple.webp` (VP8L sans VP8X) ; `meta.gif` (commentaire « ReperGIF », XMP DataXMP, NETSCAPE2.0, 2 images) ; pièges : chaque format tronqué à 50 %, longueur de segment qui dépasse le fichier, PNG au CRC faux, bloc critique inconnu. `gen-media-fixtures.sh` : `meta.heic` (iPhone simulé : Exif GPS repère, XMP, `irot` 90°), `meta.avif` ; résultats commités, chacun sous 200 Kio, coordonnées fictives seulement.
- [ ] **Step 2 : Tests qui échouent.**
  - Commun : aucun repère dans la sortie (ASCII, UTF-16 BE et LE, rationnels EXIF de la latitude repère) ; `state === "nettoye"` ; la sortie, relue par le même analyseur, ne contient plus aucun bloc retiré.
  - JPEG : orientation 6 (seule entrée EXIF, pas d'IFD1), ICC identique octet pour octet et dans l'ordre, APP14 et JFIF présents, flux compressé identique, rien après le premier EOI (ni « ReperSecond », ni « ReperMotion ») ; progressif : tous les SOS gardés.
  - PNG : blocs retirés, `eXIf` réduit à l'orientation 8, iCCP et APNG présents, tous les CRC justes ; CRC faux → `echec` ; bloc critique inconnu → `echec`.
  - WebP : EXIF/XMP absents, drapeaux de `VP8X` et taille RIFF justes ; `simple.webp` → identique.
  - GIF : commentaire et XMP absents, boucle et 2 images présentes, terminateur en dernier.
  - HEIC/AVIF : même longueur que l'entrée ; élément `Exif` = EXIF vide valide puis zéros ; XMP vide valide puis espaces ; `irot` intact ; `iloc` méthode 2 → `echec`.
  - Pièges : chaque fichier tronqué ou piégé → `echec`, sans exception (`expect(() => …).not.toThrow()` sur 1 000 troncatures aléatoires à graine fixe de chaque fixture) ; image au-delà de `STRIP_MAX` → `echec`.
  - `cleanLabelKey` : `nettoye`/image → « Nettoyé · lieu, appareil et date retirés » ; `echec` → texte d'échec ; jamais la clé « Nettoyé » pour un autre état (table exhaustive des états × catégories).
  - Catégories (reste de l'ancienne Task 9) : pour chaque cas de la table de 20 cas de `kinds.test.ts` (SVG, HTML, HEIC, `.docx`, `.zip`, vocal…), `categoryOfReceived(previewKind, safeName) === categoryOf(…)`.
  - Composeur : JPEG en échec → **ajouté** en `echec`, `blockReason() === "non_nettoye"` ; `acceptUncleaned(id)` → débloqué ; Retirer → débloqué ; la phrase générale « Position et appareil retirés des photos » absente dès qu'une image n'est pas `nettoye`.
- [ ] **Step 3 : Lancer** `npm test -- media compose` → ÉCHEC (fonctions absentes).
- [ ] **Step 4 : Implémenter** dans cet ordre : `bytes.ts`, `patch.ts`, `format.ts`, `exif.ts`, puis un format à la fois (test au vert avant le suivant) ; `strip.ts` aiguille selon `detectFormat` ; décodage de contrôle dans l'e2e seulement.
- [ ] **Step 5 : e2e** (`compose.spec.ts`) : dépôt de `iphone-like.jpg` → badge « Nettoyé · lieu, appareil et date retirés » ; l'image nettoyée, relue dans la page, se décode (`createImageBitmap`) avec la même taille et l'orientation appliquée (largeur et hauteur inversées) ; JPEG tronqué → ligne « Pas pu nettoyer… », bouton d'envoi bloqué avec la raison, « Envoyer tel quel » débloque ; HEIC en Chromium (non affichable) → nettoyé quand même ; capture `compose-clean-states`.
- [ ] **Step 6 : Lancer** `npm test && npx playwright test compose` puis la commande démo → SUCCÈS.
- [ ] **Step 7 : Commit** « feat(media): nettoyage des images (JPEG et MPF, PNG, WebP, GIF, HEIF), états honnêtes » et push.

### Task 9b : PDF et bureautique (OOXML, ODF)

**Files:**
- Create: `web/src/media/pdf.ts`, `pdf.test.ts`, `zip.ts` (lecture du répertoire central, réécriture : entrées recopiées, entrées remplacées sans compression, dates fixes, sans champs « extra »), `zip.test.ts`, `ooxml.ts`, `ooxml.test.ts`, `odf.ts`, `odf.test.ts`, `xmlattr.ts` (remplacement borné de valeurs d'attributs et de textes d'éléments nommés, sans `DOMParser`, pour rester utilisable hors fenêtre), `xmlattr.test.ts`
- Modify: `web/scripts/gen-fixtures.mjs` (PDF, DOCX, XLSX, PPTX, ODT), `web/src/media/strip.ts`, `fr.ts`, `en.ts`

- [ ] **Step 1 : Fichiers d'essai** (`gen-fixtures.mjs`) : `meta.pdf` (Info : Author « ReperAuteur », Creator, Producer « ReperLogiciel », CreationDate ; XMP « ReperXMP » ; miniature `/Thumb` ; **mise à jour incrémentale** dont l'ancienne révision a un autre `/Info` « ReperAncien » ; un second flux `/Type /Metadata` sur une page) ; `xref-stream.pdf` (flux xref compressé, prédicteur PNG 12, `/Info` hors flux d'objets) ; `objstm-info.pdf` (`/Info` dans un `ObjStm`) ; `signed.pdf` (`/ByteRange`, `/Sig`) ; `encrypted.pdf` (`/Encrypt`) ; `meta.docx` (core.xml « ReperAuteur », app.xml « ReperSociete », custom.xml « ReperCustom », comments.xml `w:author="ReperCommentateur"` avec `w:date`, people.xml avec `w15:presenceInfo` « ReperCompte », une modification suivie `w:ins w:author="ReperSuivi"`, une image `word/media/image1.jpeg` = `iphone-like.jpg`, entrées avec dates réelles et champ « extra » UT) ; `meta.xlsx` (commentaire `<author>ReperAuteurXL</author>`, `xl/persons/person.xml`) ; `meta.pptx` (`ppt/commentAuthors.xml`) ; `meta.odt` (meta.xml complet « ReperAuteurODF », annotation `dc:creator`, modification suivie) ; `protected.docx` (en-tête OLE) ; `signed.docx` (`_xmlsignatures/`) ; ZIP64 et ZIP au nom en double.
- [ ] **Step 2 : Tests qui échouent.**
  - PDF : aucun repère de `/Info` ni d'XMP, **ancienne révision comprise** ; même longueur que l'entrée ; chaque objet neutralisé commence à la même position (table xref toujours juste : chaque entrée pointe sur `N G obj`) ; ouvert par `pdfjs-dist` (déjà en dépendance, utilisé ici en test seulement) : même nombre de pages, même texte ; note `pdf_revisions` présente pour `meta.pdf` ; `xref-stream.pdf` nettoyé ; `objstm-info.pdf` → `echec` ; `signed.pdf` et `encrypted.pdf` → `protege`.
  - OOXML : core, app et custom minimaux et valides (les noms des parties et `[Content_Types].xml` inchangés) ; aucun repère d'auteur, de société, de compte ; commentaires conservés, auteurs « Auteur », dates absentes ; **`w:ins` et « ReperSuivi » inchangés** et note `suivi_modifs` ; image intégrée nettoyée (orientation et ICC gardés) ; entrées non modifiées : données compressées et CRC identiques ; toutes les dates ZIP au 1980-01-01, aucun champ « extra », commentaire vide ; relu par `zip.ts` sans erreur. XLSX et PPTX : idem pour leurs parties.
  - ODF : `mimetype` premier et sans compression ; `meta.xml` minimal à la même `office:version` ; annotation « Auteur » ; modification suivie gardée, note `suivi_modifs`.
  - Refus : `protected.docx`, `signed.docx` → `protege` ; ZIP64, nom en double, tronqué → `echec` ; `DecompressionStream` absent (simulé) → `echec` pour la bureautique, jamais d'exception.
- [ ] **Step 3 : Lancer** `npm test -- media` → ÉCHEC.
- [ ] **Step 4 : Implémenter** `zip.ts`, `xmlattr.ts`, `ooxml.ts`, `odf.ts`, puis `pdf.ts` (lecture des tables xref de toutes les révisions par la chaîne `/Prev`, décompression des flux xref et `ObjStm` par `DecompressionStream('deflate')` en lecture seule, neutralisation `N G obj null` + espaces + `endobj`).
- [ ] **Step 5 : e2e** : dépôt de `meta.docx` → « Nettoyé · auteur, société et dates retirés, auteurs des commentaires remplacés » et « Les modifications suivies gardent le nom de leurs auteurs. » ; `signed.pdf` → texte `protege` et choix ; `meta.pdf` nettoyé puis ouvert dans la visionneuse PDF (Task 22, quand elle existe ; sinon pdf.js en test unitaire seulement).
- [ ] **Step 6 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 7 : Commit** « feat(media): nettoyage des PDF et des documents Office et ODF » et push.

### Task 9c : Vidéo et audio (MP4, MOV, M4V, M4A, WebM, MKV, MP3, Ogg, FLAC, WAV)

**Files:**
- Create: `web/src/media/mp4.ts` (sur `isobmff.ts` de 9a : liste blanche, `free`, dates, pistes minutées et `tmcd` dont les échantillons sont mis à zéro), `mp4.test.ts`, `ebml.ts`, `ebml.test.ts`, `mp3.ts`, `mp3.test.ts`, `ogg.ts` (pages, CRC Ogg à polynôme 0x04C11DB7 non réfléchi, renumérotation), `ogg.test.ts`, `flac.ts`, `wav.ts`, tests
- Modify: `web/scripts/gen-media-fixtures.sh` (MP4, MOV, M4A, WebM, MKV par `ffmpeg`), `web/scripts/gen-fixtures.mjs` (MP3, Ogg Opus, FLAC, WAV), `web/src/media/strip.ts`, `fr.ts`, `en.ts` (et `home.faq.scan.a` : vidéos et documents ne sont plus « non nettoyés », seulement quand 9b et 9c sont livrées)

- [ ] **Step 1 : Fichiers d'essai.** `gen-media-fixtures.sh` : `phone.mov` (H.264 2 s, `-metadata location=+12.5822-065.7225/`, `com.apple.quicktime.make` « ReperMake », `.model`, `.software`, `.creationdate`, rotation 90° par matrice, piste `tmcd`, piste de métadonnées minutée `mebx` contenant « ReperGPSPiste ») ; `faststart.mp4` (`moov` en tête, `udta` « ReperUdta », `©xyz`, boîte `uuid` XMP « ReperXMP », boîte `free` qui contient « ReperFree ») ; `frag.mp4` (fragmenté, `prft`) ; `tags.m4a` (`ilst` « ReperArtiste », `covr`) ; `meta.webm` et `meta.mkv` (`Tags` « ReperTag », `DateUTC`, `Title` « ReperTitre », `WritingApp` « ReperApp ») ; `recorder.webm` (sortie réelle de `MediaRecorder` Chromium : `Segment` et `Cluster` de taille inconnue). `gen-fixtures.mjs` : `id3.mp3` (ID3v2.3 « ReperID3 » avec image, ID3v1 « ReperV1 », APEv2, trame Xing) ; `tags.opus` (`OpusTags` sur 3 pages avec `METADATA_BLOCK_PICTURE` « ReperOpus ») ; `tags.ogg` (Vorbis, commentaire et configuration sur la même page) ; `tags.flac` ; `bext.wav` (`bext` « ReperOrigine », `LIST/INFO` « ReperINFO », `iXML`). Pièges : tronqués, boîte de taille 0 au milieu, VINT invalide, Ogg chaîné.
- [ ] **Step 2 : Tests qui échouent.**
  - MP4/MOV : aucun repère, « ReperGPSPiste » et « ReperFree » compris ; même longueur que l'entrée (neutralisation en place) ; `mvhd`, `tkhd`, `mdhd` : dates à 0 (versions 0 et 1) ; matrice de `tkhd`, `stsd`, `edts`, `stco` et contenu de `mdat` des pistes audio et vidéo identiques octet pour octet ; pistes `mebx` et `tmcd` devenues `free` et leurs échantillons à zéro ; `frag.mp4` : `prft` neutralisée, `moof` intacts.
  - M4A : `ilst` et `covr` absents, audio identique.
  - WebM/MKV : `Tags`, `DateUTC`, `Title` devenus `Void` de même taille totale ; `WritingApp` et `MuxingApp` « shhdrop » ou vides ; `recorder.webm` (tailles inconnues) nettoyé.
  - MP3 : commence par une trame (synchronisation 0xFFE), finit par la dernière trame, Xing gardée ; aucune étiquette.
  - Ogg : en-tête de commentaires sans encodeur ni commentaire ; CRC de toutes les pages justes ; numéros de page consécutifs ; pages audio identiques hors numéro et CRC ; Ogg chaîné → `echec`.
  - FLAC, WAV : blocs retirés, taille RIFF juste, `data` identique.
  - Lisibilité (e2e Chromium et WebKit) : chaque sortie se charge dans `<video>` ou `<audio>` (`loadedmetadata`), même durée à 0,1 s près, mêmes `videoWidth`/`videoHeight` ; `phone.mov` affiché tourné (WebKit).
  - Pièges → `echec` sans exception (troncatures aléatoires à graine fixe) ; un fichier vidéo de 1 Go creux (`gen` à la volée) est traité sans dépasser 64 Mio de mémoire (`performance.memory` en Chromium, ou nombre d'octets lus mesuré par un `Blob` espion).
- [ ] **Step 3 : Lancer** `npm test -- media` → ÉCHEC.
- [ ] **Step 4 : Implémenter** `mp4.ts`, `ebml.ts`, `mp3.ts`, `ogg.ts`, `flac.ts`, `wav.ts` (un à la fois, test au vert avant le suivant).
- [ ] **Step 5 : e2e** : dépôt de `phone.mov` → « Nettoyé · lieu, appareil et dates retirés » ; lu dans la page après nettoyage ; e2e de la Task 12 : le vocal enregistré passe par `stripMetadata(…, { recorded: true })` et ne contient ni `DateUTC` ni nom de navigateur (WebM), ni date réelle dans `mvhd` (MP4).
- [ ] **Step 6 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 7 : Commit** « feat(media): nettoyage des vidéos et de l'audio sans réencodage » et push.

**Liste manuelle (avant mise en ligne, spec §14)** : photo et vidéo d'un vrai iPhone et d'un vrai Android, localisation activée, et documents Word et LibreOffice avec auteur : fichier reçu passé à `exiftool -a -G1` et `ffprobe -show_format -show_streams` : aucune position, aucun appareil, aucune date de prise.

---

### Task 10 : Composer — liste, catégories, ordre, retrait, renommage, doublons, jauge

> **Accueil v3 (5 novembre, révision 5 de UI §9.1).** L'accueil fournit déjà la fenêtre de dépôt et ses actions : `Home.svelte` expose `onfiles(files, source)` avec `source` ∈ `"fichiers" | "photo" | "video" | "depot"` et `onaction("vocal" | "texte" | "coller")`. Task 10 branche `onfiles` sur `composer.add` (une vidéo de « Vidéo » est nommée « Vidéo {n}.{ext} », comme « Photo {n}.jpg ») et `onaction("texte")` sur l'éditeur de texte ; elle retire l'avis provisoire « N éléments ajoutés » de `Home.svelte`. `DropZone.svelte` n'est plus à créer : le coffre de l'accueil en tient lieu, et un clic sur le verre **n'ouvre pas** le sélecteur (décision du propriétaire). Le voile `DropOverlay.svelte` et le dépôt pleine page (compteur, Échap, dossiers refusés) existent déjà dans `Home.svelte` ; `App.svelte` passe `guardFileDrop(window, allow)` avec `allow()` vrai sur l'accueil.

**Files:**
- Create: `web/src/routes/Compose.svelte`, `web/src/flows/compose.svelte.ts`, `compose.test.ts`, `web/src/ui/CapacityGauge.svelte`, `CategoryGroup.svelte`, `ItemRow.svelte`, `ReorderHandle.svelte`, `DropZone.svelte` (cliquable ici, dépôt en Task 11), `web/src/ui/reorder.ts`, `reorder.test.ts`, `web/ui-e2e/compose.spec.ts`, `web/ui-e2e/files/*` (photo, vidéo courte, PDF, 12 petits fichiers ; fichier creux de 1 Go généré)

**Interfaces:**
```ts
type ComposeItem = { id: string; kind: "file" | "text"; category: Category; base: string; ext: string;
  mime: string; size: number; data: Blob | Uint8Array; clean: ReturnType<typeof cleanStatus> | "nettoye";
  duplicate: boolean; thumb?: string; status: "pret" | "nettoyage" };
createComposer(deps = { strip: stripMetadata, probe: (f: Blob) => Promise<void>, now, onFirstItem?: () => void, onEmpty?: () => void }) → {   // onFirstItem : la liste passe de 0 à 1 élément ; onEmpty : elle redevient vide (déclencheurs du pré-calcul anti-robot, Q2)
  items: ComposeItem[];                         // ordre d'affichage = ordre du manifeste
  groups(): { category: Category; items: ComposeItem[]; count: number; bytes: number }[];
  totalBytes: number; count: number;
  add(files: File[], source: "fichiers" | "photo" | "video" | "depot" | "collage"): Promise<AddReport>;
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

- [ ] **Step 1 : Tests qui échouent** (`compose.test.ts`, `reorder.test.ts`) : JPEG → donnée nettoyée, `clean = "nettoye"` ; JPEG malformé → `failedClean` ; 12 fichiers → 10 ajoutés, 2 dans `refusedCount` ; `probe` rejeté → `unreadable` ; total > `CONTENT_MAX` → ajouté, `blockReason() === "trop_gros"` ; photo de source `photo` → `base = "Photo 1"` ; doublon (même `cleanName` sans casse + même taille) → `duplicate` sur les deux, retiré à la suppression de l'un ; `move` limité à la catégorie, `"premier"`/`"dernier"` en limite ; `toApiItems` suit `CATEGORY_ORDER` puis l'ordre interne, et passe le `File` d'origine tel quel pour les non-images (jamais lu en entier) ; `rename` (vide ; 121 graphèmes → `trop_long`, 120 acceptés ; `/` ; contrôle ; une séquence emoji ZWJ n'est jamais coupée par la borne) ; `onFirstItem` appelé une seule fois à l'ajout du premier élément, `onEmpty` quand le dernier est retiré (espions) ; `remove().undo()` remet à la même place ; extension non modifiable.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.2.1, §9.2.4–§9.2.9 : rangée d'ajout (Fichiers, Photo, Texte ; Vocal et Coller en Tasks 11–12), `DropZone` cliquable (dépôt en Task 11), `CategoryGroup` + `ItemRow` (vignette 40 px des images nettoyées, URL blob révoquée à l'oubli), `ReorderHandle` (Pointer Events + `setPointerCapture`, 150 ms au doigt, défilement automatique, Alt + ↑/↓, mode déplacement Monter/Descendre/Terminé, annonces), renommage en place, `UndoToast`, `CapacityGauge` (deux `role="meter"`, état vide, 90 %, dépassement en `role="alert"`), raisons de blocage reliées au bouton, `beforeunload` si la liste n'est pas vide. Les rappels `onFirstItem` / `onEmpty` sont les seuls déclencheurs du pré-calcul anti-robot ; leur branchement sur `createPowPrefetcher` se fait en Task 14 (`App.svelte`), le prélèvement du résultat en Task 17.
- [ ] **Step 4 : e2e** (`compose.spec.ts`) : photo + texte + PDF → trois catégories dans l'ordre Texte, Photos, Documents, méta « 1 · … » ; deux photos réordonnées à la souris puis au clavier (Alt + ↓) avec annonce lue dans le `LiveRegion` ; mode déplacement sur `webkit-mobile` ; renommage (Entrée, Échap) ; retrait + Annuler ; 12 fichiers → message « 2 éléments n'ont pas été ajoutés » ; fichier creux 1 Go + 1 octet → jauge `--danger`, bouton bloqué avec la raison ; doublon → badge ; nom de 200 caractères et nom arabe → pas de débordement à 320 px ; `axe` ; captures `compose-filled`, `compose-over`, `compose-reorder`. Démo : parcours « ajouter, réordonner, retirer » ajouté à `demo.spec.ts`.
- [ ] **Step 5 : Lancer** `npm test && npx playwright test compose` puis la commande démo des Global Constraints → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): composer (catégories, ordre, renommage, doublons, jauge) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M1, l'outil est l'accroche.** La rangée d'ajout (Fichiers, Photo, Texte) et `DropZone` sont visibles sans défilement à 390 × 844 et à 1440 × 900 ; aucun clic préalable, aucune case « J'accepte les conditions » avant l'ajout. *Contrôle* : e2e `webkit-mobile`, page fraîchement chargée : le bas de la rangée d'ajout est dans la fenêtre (`boundingBox().y + height <= 844`) ; ajouter un texte sans autre interaction fonctionne ; aucun `input[type=checkbox]` n'existe avant le premier élément.
- [ ] **M5, chiffres concrets plutôt qu'adjectifs.** Ligne de preuves sous le titre de l'accueil : « Sans compte · 1 Go · 24 h au plus · 5 essais de mot de passe, puis destruction » ; la jauge affiche des valeurs réelles arrondies (octets et nombre d'éléments, par exemple « 142 Mo sur 1 Go »). Chiffres en `font-variant-numeric: tabular-nums`. Aucun badge (« ultra-sécurisé », « conforme RGPD »). *Contrôle* : test unitaire : la ligne est construite à partir des constantes (`CONTENT_MAX`, nombre maximal d'éléments, durée maximale, nombre d'essais de la Task K1), aucun chiffre écrit en dur dans `fr.ts` ni `en.ts` (changer la constante change la ligne) ; `getComputedStyle(...).fontVariantNumeric` contient `tabular-nums` sur la jauge. **Signalement (faible)** : `CONTENT_MAX` = 1 073 741 824 − 65 540 est un peu sous 1 Gio ; le « 1 Go » affiché et le blocage `trop_gros` doivent venir de la même constante, et la jauge ne doit jamais promettre plus que `CONTENT_MAX` (test à la limite exacte).
- [ ] **Texte de confiance : noms et métadonnées.** Sous la liste : « Même les noms de vos fichiers sont chiffrés. » ; mention « Position et appareil retirés des photos. » **seulement** si toutes les images de la liste sont à l'état `nettoye` (Tasks 9a à 9c, spec §35.2), jamais en phrase générale. *Contrôle* : un élément dont l'état n'est pas `nettoye` ne reçoit pas la mention et affiche son propre avertissement ; test unitaire de la fonction qui choisit le texte.
- [ ] **Raison toujours dite (anti-motif « bouton désactivé sans dire pourquoi »).** Chaque valeur de `blockReason()` (`vide`, `trop_gros`, `texte_trop_long`, `nettoyage`, `hors_ligne`) a une clé de texte en français et en anglais, du type « Ajoutez au moins un élément » pour `vide`. *Contrôle* : `compose.test.ts` énumère les valeurs de `blockReason` et vérifie qu'aucune n'a de clé manquante ; le branchement sur le bouton d'envoi se vérifie en Task 13.

---

### Task 11 : Glisser-déposer et coller

> **Accueil v3.** `DropOverlay.svelte` et le dépôt pleine page sont faits (UI §9.1 révision 5, `ui-e2e/home.spec.ts`). Reste à Task 11 : `flows/intake.ts` (`filesFromDrop` avec `webkitGetAsEntry`, aujourd'hui en ligne dans `Home.svelte`, à y déplacer), le collage (`paste` sur `document`, bouton Coller via `onaction("coller")`), et `allow()` faux pendant un envoi.

**Files:**
- Create: `web/src/ui/DropOverlay.svelte`, `web/src/flows/intake.ts`, `intake.test.ts`, `web/ui-e2e/intake.spec.ts`
- Modify: `web/src/routes/Compose.svelte`, `web/src/ui/DropZone.svelte` (créée en Task 10), `web/src/App.svelte` (`guardFileDrop(window, allow)` avec `allow()` vrai sur l'accueil hors envoi ; `lifecycle.ts` ne change pas)

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

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M1, dépôt dès le premier écran.** Le dépôt pleine page (`DropOverlay`) et le collage fonctionnent sur la page fraîchement chargée, sans écran intermédiaire ni clic préalable. *Contrôle* : e2e : dépôt de 3 fichiers sur l'accueil juste après le chargement, avant toute interaction → 3 éléments ; aucune case ni dialogue de conditions n'apparaît.
- [ ] **Texte de confiance sur le voile.** Ligne secondaire du voile : « Chiffré sur votre appareil, avant de partir. » (la raison du dépôt, pas un badge). *Contrôle* : e2e : le texte est présent pendant `dragenter` et disparu avec le voile (Échap).
- [ ] **Raison toujours dite.** Le message d'un dossier refusé dit quoi faire (ajouter les fichiers du dossier, pas le dossier) ; même règle pour les fichiers refusés par le compteur. *Contrôle* : e2e : le message est lié par `aria-describedby`/annoncé dans le `LiveRegion` et contient une consigne, pas seulement « Refusé ».

---

### Task 12 : Vocal enregistré dans l'interface (spec §35.3)

> **Accueil v3.** Le bouton **Vocal** existe déjà dans le coffre (masqué sans `MediaRecorder`) et appelle `onaction("vocal")` : Task 12 y ouvre `VoiceRecorder`. La **Vidéo** (UI §9.2.1) passe par `<input accept="video/*" capture="environment">` ; la vidéo enregistrée dans la page est la Task 12b, conditionnelle (Q-REC1) : sans elle, la `Permissions-Policy` garde `camera=()`.
>
> **Signalements.** (1) UI §8 décrit un niveau en 5 barres ; la spec §35.3 demande une forme d'onde, la pause et l'écran d'explication : UI §9.2.7 est à aligner par celui qui tient la spécification UI. (2) L'audit de confidentialité (P13) veut interdire `AudioContext` dans `web/src` : exception écrite pour `web/src/media/recorder.ts` seulement, contrôlée par `source-rules.test.ts` ; la forme d'onde est en barres DOM, sans `<canvas>`.

**Files:**
- Create: `web/src/media/recorder.ts`, `recorder.test.ts`, `web/src/ui/VoiceRecorder.svelte`, `web/src/ui/Waveform.svelte`, `web/ui-e2e/voice.spec.ts`
- Modify: `web/src/flows/compose.svelte.ts` (`addVoice` reçoit le résultat de `stripMetadata`), `server/internal/api/headers.go` et son test (`/pdf-frame.html` : `microphone=(), camera=(), geolocation=()`), `web/src/source-rules.test.ts` (exception `AudioContext`), `fr.ts`, `en.ts`

**Interfaces:**
```ts
pickMime(isSupported: (m: string) => boolean): { mime: string; ext: "m4a" | "webm" } | null;
// ordre : audio/mp4;codecs=mp4a.40.2, audio/mp4, audio/webm;codecs=opus, audio/webm
type MicError = "refuse" | "absent" | "occupe" | "bloque" | "inconnu";   // NotAllowedError, NotFoundError, NotReadableError, SecurityError, autre
micPermission(): Promise<"granted" | "denied" | "prompt" | "unknown">;  // permissions.query si présent, sinon "unknown" ; jamais d'appel réseau
startRecording(opts: { maxMs?: number /* 1_800_000 */; warnBeforeMs?: number /* 60_000 */; onWarn?: () => void;
  onLevel?: (rms: number) => void /* ~20 Hz */; now?: () => number; media?: MediaDevicesLike }):
  Promise<{ pause(): void; resume(): void; stop(): Promise<Blob>; cancel(): void;
            state(): "recording" | "paused" | "stopped"; elapsedMs(): number /* pauses exclues */ }>;
WAVE_BARS = 48;   // historique des niveaux affiché par Waveform
```

- [ ] **Step 1 : Tests qui échouent** (`recorder.test.ts`, faux `MediaRecorder`, faux `getUserMedia`, horloge injectée) : ordre de `pickMime` ; `null` → bouton masqué ; chaque `DOMException` → bon `MicError` ; `getUserMedia` appelé avec `{ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }` et **jamais** `video` ; `elapsedMs` n'avance pas en pause ; arrêt automatique à `maxMs` de temps enregistré (pauses exclues) ; `onWarn` une seule fois à `maxMs − 60 s` ; `stop`, `cancel` et `pagehide` : toutes les pistes `stop()`, `AudioContext.close()` ; `visibilitychange → hidden` → `pause()` ; `onLevel` reçoit des valeurs entre 0 et 1.
- [ ] **Step 2 : Lancer** `npm test -- recorder` → ÉCHEC.
- [ ] **Step 3 : Implémenter** :
  - **Avant la demande du navigateur** : écran d'explication (« Shhdrop va demander l'accès au micro. L'enregistrement reste sur votre appareil et n'est chiffré qu'ici. ») et bouton **Autoriser le micro** ; si `micPermission()` rend `denied`, on saute la demande et on affiche directement la marche à suivre (réglages du site, propre à Safari, Chrome, Firefox).
  - **États** : prêt, enregistrement (témoin, chronomètre tabulaire, `Waveform` des 48 derniers niveaux, **Pause**, **Arrêter**, **Annuler**), en pause (**Reprendre**), relecture (`<audio controls>` sur l'URL blob, **Ajouter**, **Recommencer**), erreurs `MicError` avec un texte et une action chacune.
  - Arrêt → `stripMetadata(blob, mime, "Vocal n.ext", { recorded: true })` (Task 9c) → `composer.addVoice` ; si le nettoyage échoue : état `echec` comme pour un fichier (spec §35.2), jamais « Enregistré ici, sans informations cachées ».
  - Nom « Vocal {n}.{ext} », catégorie Audio et vocaux ; URL blob révoquée à l'ajout ou à l'abandon.
- [ ] **Step 4 : e2e** (`voice.spec.ts`) Chromium (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, permission `microphone`) : écran d'explication → Autoriser → 2 s → Pause 1 s (chronomètre figé) → Reprendre 1 s → Arrêter → relecture → Ajouter → « Vocal 1 » > 0 octet dans « Audio et vocaux », badge « Enregistré ici, sans informations cachées » ; permission refusée → message `refuse` et marche à suivre ; aucun appel à `getUserMedia` avant le clic (espion) ; après Arrêter, toutes les pistes `readyState === "ended"` ; en-têtes : `Permissions-Policy` de `/` contient `microphone=(self)`, celle de `/pdf-frame.html` `microphone=()` ; `axe` ; captures `voice-explain`, `voice-recording`, `voice-paused`, `voice-review`. WebKit : `fixme` si pas de faux micro, ligne ajoutée à la liste manuelle (pause comprise).
- [ ] **Step 5 : Lancer** `npm test && npx playwright test voice` puis la commande démo → SUCCÈS (le vocal reste local à la page).
- [ ] **Step 6 : Commit** « feat(media): vocal enregistré dans l'interface (forme d'onde, pause, durée maximale, sans métadonnées) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M1, Vocal dans la rangée d'ajout.** Le bouton Vocal est dans la même rangée visible que Fichiers, Photo, Texte à 390 × 844. *Contrôle* : e2e `webkit-mobile` : le bouton est dans la fenêtre sans défilement.
- [ ] **Texte de confiance.** Pendant et après l'enregistrement : « Chiffré sur votre appareil, avant de partir. » *Contrôle* : e2e Chromium (faux micro) : texte visible ; toutes les requêtes émises pendant l'enregistrement et l'envoi ne contiennent que des octets opaques (le cas « vocal » est ajouté au test « le serveur ne voit rien » de la Task 27).
- [ ] **Anti-motif « animation sans pause ».** Le témoin d'enregistrement ne pulse pas au-delà de 5 s sans moyen de l'arrêter ; en mouvement réduit il est statique ; le chronomètre s'affiche en chiffres tabulaires pour ne pas trembler. *Contrôle* : e2e avec `reducedMotion: "reduce"` : `getComputedStyle(témoin).animationName === "none"` ; `fontVariantNumeric` contient `tabular-nums`.

---

### Task 12b : Vidéo enregistrée dans l'interface (conditionnelle : seulement si Q-REC1 est acceptée)

Recommandation de la spec §35.3 : **ne pas la faire en V1**. Le compromis : elle apporte la webcam sur ordinateur (où `capture` ouvre le sélecteur), mais `camera=(self)` donne à tout code servi par l'origine, y compris un code piégé (spec §18.2), la possibilité de filmer sans nouvelle demande si la personne a choisi « toujours autoriser ».

**Files:**
- Create: `web/src/media/camera.ts`, `camera.test.ts`, `web/src/ui/VideoRecorder.svelte`, `web/ui-e2e/video-rec.spec.ts`
- Modify: `server/internal/api/headers.go` et son test (`camera=(self)` sur `/` seulement ; `camera=()` sur `/pdf-frame.html`), spec §10 déjà prête, `fr.ts`, `en.ts`

- [ ] **Step 1 : Tests qui échouent** : `pickVideoMime` (`video/mp4;codecs=avc1,mp4a`, `video/mp4`, `video/webm;codecs=vp9,opus`, `video/webm;codecs=vp8,opus`) ; `getUserMedia` appelé seulement après le clic **Filmer ici** ; `videoBitsPerSecond = 2_500_000` ; arrêt à 5 min d'enregistrement ; bascule avant/arrière (`facingMode`) qui coupe l'ancienne piste avant d'ouvrir la nouvelle ; toutes les pistes coupées à la fin, à l'annulation, à `pagehide` et à `hidden`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** : même écran d'explication que le vocal (« caméra et micro ») ; aperçu `<video muted playsinline>` ; mêmes états (pause, relecture, Recommencer) ; sortie passée à `stripMetadata(…, { recorded: true })` ; nom « Vidéo {n}.{ext} ».
- [ ] **Step 4 : e2e** Chromium (fausse caméra) : 3 s → Ajouter → élément Vidéo nettoyé, lisible ; aucune piste vivante après l'ajout ; `Permissions-Policy` de `/` contient `camera=(self)` ; `axe` ; captures.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(media): vidéo enregistrée dans l'interface » et push.

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

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M4, options écrites comme une phrase.** Remplacer les contrôles séparés durée/ouvertures par : « S'efface dans **12 h** ou après **1 ouverture**, au premier des deux. » Les mots en gras sont des contrôles segmentés natifs (`<fieldset>` + `<input type="radio">`), chacun avec son nom accessible (« Durée », « Ouvertures ») lisible sans la phrase. *Contrôle* : unit : pluriel (« 1 ouverture », « 3 ouvertures ») et valeurs lues dans les constantes ; e2e : 12 h présélectionné ; flèches dans chaque groupe ; `getByRole("radiogroup", { name: "Durée" })` et `{ name: "Ouvertures" }` existent ; la phrase affichée se met à jour ; `axe` sans violation ; les attributs UI §12.3 sont conservés.
- [ ] **Texte de confiance : mot de passe et essais.** Près du champ : « Un mot de passe en plus du lien. Envoyez-les par deux moyens différents. » et « 5 essais ratés, et le partage est détruit. » (le « 5 » vient de la constante de la Task K1, jamais écrit en dur). *Contrôle* : e2e : les deux phrases sont visibles ; test unitaire qui compare le chiffre affiché à la constante serveur utilisée en Task 20.
- [ ] **M1, conditions en une ligne, sans barrière.** Sous « Chiffrer et envoyer », une seule ligne renvoie à une section « Conditions » ; aucune case à cocher. **Signalement (moyenne, légal)** : le plan ne crée aucune page de conditions (la Task 25 ne livre que Sécurité et Confidentialité) et le texte juridique doit venir du propriétaire. Proposition : section « Conditions » dans `PageConfidentialite.svelte` (Task 25), texte fourni par le propriétaire ; tant qu'elle n'existe pas, la ligne est absente. *Contrôle* : e2e : la ligne n'est affichée que si l'ancre cible existe ; aucun `input[type=checkbox]` sur l'écran.
- [ ] **Anti-motif « bouton désactivé sans dire pourquoi ».** **Signalement (faible)** : l'étape 4 ci-dessus prévoit « bouton bloqué ». L'étude propose un bouton actif dont le clic dit quoi faire (« Ajoutez au moins un élément »). Si le propriétaire accepte : bouton sans `disabled`, clic → message annoncé et focus sur le champ fautif ; sinon : le bouton bloqué garde son message visible et relié (`aria-describedby`). *Contrôle* (dans les deux cas) : pour chaque valeur de `blockReason()` (Task 10), le texte de la raison est visible à l'écran à côté du bouton.

---

### Task 14 : Anti-robot — preuve de travail maison et pré-calcul

**Files:**
- Create: `web/src/captcha/pow.ts`, `pow.worker.ts`, `pow.test.ts`, `prefetch.ts`, `prefetch.test.ts`, `web/src/captcha/solve.ts`, `solve.test.ts`, `web/src/captcha/fixtures/challenge.json` (défi **réel** enregistré depuis `GET /api/captcha` d'un serveur Go, niveau le plus bas ; la commande d'enregistrement est consignée en tête de `pow.test.ts`), `web/ui-e2e/captcha.spec.ts`
- Modify: `web/src/App.svelte` (branche le pré-calcul sur les rappels du composeur, Task 10)

**Interfaces:**
```ts
// pow.worker.ts : message { salt, challenge, maxNumber } → { type: "progress", tried } | { type: "found", number, took } | { type: "notfound" }
// La clé du défi est `maxNumber` (balise JSON d'altcha-lib-go v1.0.0, cf. web/e2e/altcha.ts), jamais l'orthographe tout en minuscules.
solvePow(ch: { algorithm: string; challenge: string; maxNumber: number; salt: string; signature: string },
  opts: { signal: AbortSignal; boundMs?: number /* 60_000 */; onProgress(tried: number, rate: number): void;
          makeWorker?: () => Worker; now?: () => number }): Promise<{ payload: string }>;
          // rejette "pow_echec" | "pow_trop_long" | AbortError
makeSolveCaptcha(deps: { solvePow;
  consent(signal: AbortSignal): Promise<boolean>;                       // feuille de consentement (Task 16) : true = « Continuer avec Google »
  askFallback(origin: string, mount: HTMLElement, signal: AbortSignal, lang: "fr" | "en"): Promise<string>;   // Task 16, même signature
  mount(): HTMLElement; lang(): "fr" | "en";
  onPhase(p: "pow" | "fallback_offer" | "fallback"): void; now?: () => number })
  : (challenge: unknown, ctx: CaptchaCtx) => Promise<CaptchaProof>;      // ctx = { fallbackOrigin, mode } (Task 0)
createPowPrefetcher(deps: { prepare: typeof prepareCaptcha; solvePow; now: () => number }): {
  start(): void;   // idempotent ; sans effet si la page est masquée
  stop(): void;    // termine le Worker, oublie le défi
  take(): { cap: PreparedCaptcha; proof: Promise<CaptchaProof> } | null;   // cède la main (Task 17)
};
```
**Borne de 60 s (Q2 ; plus aucun délai fixe).** `solvePow` mesure sa vitesse. Après 5 s de mesure, si `(maxNumber − tried) / rate > boundMs` (`boundMs = 60_000`), ou si `boundMs` s'est écoulé sans solution, il termine le Worker et rejette `pow_trop_long`. `pow_echec` : `Worker` absent ou erreur à la création, erreur du Worker, `algorithm !== "SHA-256"`, `notfound`. `makeSolveCaptcha` passe `boundMs: 60_000` quand `ctx.fallbackOrigin !== null`, `Infinity` sinon (sans repli possible, le calcul va au bout et l'écran affiche « Encore {durée} au plus »).

**`makeSolveCaptcha`.** `ctx.mode === "pow"` : `solvePow` ; sur `pow_echec` ou `pow_trop_long` → si `fallbackOrigin === null`, rejet `captcha_impossible` ; sinon `onPhase("fallback_offer")`, `await consent(signal)` (`false` → `AbortError`), `onPhase("fallback")`, `askFallback(origin, mount(), signal, lang())` → `{ kind: "recaptcha", token }`. `ctx.mode === "fallback"` : saute la preuve de travail et va directement à `fallback_offer` (rejet `captcha_impossible` si `fallbackOrigin === null`). Rien n'est chargé depuis Google, et `askFallback` n'est pas appelé, avant `consent → true`.

**`createPowPrefetcher` (Q2, P38).** `start()` : si la page est visible, `prepare(location.origin)` puis `solvePow` (sans repli : si `pow_trop_long` ou `pow_echec`, le résultat est abandonné et `take()` rendra `null` ; le repli ne se propose qu'après le clic d'envoi). Le défi est renouvelé quand il reste 30 s de validité (`cap.expiresAt`), **au plus deux renouvellements** ; ensuite plus de pré-calcul, le calcul se fait à l'envoi. `stop()` sur `pagehide`, page masquée (`visibilitychange`) et liste vide. `take()` rend `{ cap, proof }` seulement s'il reste plus de 15 s de validité, et vide le préfetcher ; sinon `null`. Le pré-calcul n'est pas branché en démo (`getDemo() !== null`).

- [ ] **Step 1 : Tests qui échouent** :
  - `solvePow` (Worker simulé par une classe en mémoire qui exécute le même code) résout le **défi réel enregistré** (`fixtures/challenge.json`, clé `maxNumber`, sel « …&expires=…& », SHA-256 de `salt + number`) ; charge utile = base64 du JSON `{algorithm, challenge, number, salt, signature, took}` ; `algorithm !== "SHA-256"` → rejet ; `signal` → `terminate()` appelé ; `makeWorker` qui lève → `pow_echec` immédiat.
  - Borne : Worker simulé à débit constant dont la borne restante vaut 61 s → `pow_trop_long` vers 5 s ; 59 s → aucun rejet ; 60 s écoulées sans solution → `pow_trop_long` ; avec `boundMs: Infinity`, jamais de rejet.
  - `makeSolveCaptcha` : `pow_echec` avec `fallbackOrigin: null` → rejet `captcha_impossible` ; avec origine → `onPhase("fallback_offer")`, puis **`askFallback` jamais appelé avant `consent → true`** ; `consent → false` → `AbortError` ; `mode: "fallback"` ne lance aucun `solvePow`.
  - `createPowPrefetcher` (horloge et `visibilityState` injectés) : `start` page masquée → aucun `prepare` ; `start` deux fois → un seul calcul ; renouvellement à 30 s de validité, plus aucun après le deuxième ; `stop()` → Worker terminé, `take()` rend `null` ; `take()` avec moins de 15 s de validité → `null` ; `take()` rend `{ cap, proof }` puis `null` ; `pow_trop_long` → `take()` rend `null`.
  - Aucun SHA-256 écrit à la main (le Worker appelle `crypto.subtle.digest`).
- [ ] **Step 2 : Lancer** `cd web && npx vitest run src/captcha` → ÉCHEC.
- [ ] **Step 3 : Implémenter** (`new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" })`, lots de 64 condensés parallèles, progression toutes les 250 ms, borne « encore {durée} au plus » = `(maxNumber − tried) / rate`). `App.svelte` : instance unique de `createPowPrefetcher({ prepare: prepareCaptcha, solvePow, now })` (hors démo), `onFirstItem` → `start()`, `onEmpty` → `stop()`, `pagehide` et `visibilitychange` → `stop()` ; elle est transmise au flux d'envoi (Task 17) par contexte Svelte.
- [ ] **Step 4 : e2e** (`captcha.spec.ts`, vrai serveur) : résolution d'un vrai défi de `GET /api/captcha` dans la page → `POST /api/shares` accepté (via `createShare` complet) ; ajout d'un élément au composeur → exactement un `GET /api/captcha`, liste vidée → plus aucune requête ; aucune requête hors origine ; aucune violation CSP (le Worker est un fichier de l'origine) ; `Worker` retiré par `addInitScript` → `makeSolveCaptcha` rejette `captcha_impossible` dans la page (repli non configuré ; le message affiché à l'utilisateur est testé en Task 17).
- [ ] **Step 5 : Lancer** → SUCCÈS sur les quatre projets.
- [ ] **Step 6 : Commit** « feat(captcha): preuve de travail maison (Worker, WebCrypto) et pré-calcul, compatible altcha-lib-go v1 » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **B1, exception reCAPTCHA partout où « aucun tiers » apparaît.** Aucune chaîne produite par cette tâche (états de la vérification, offre de repli `fallback_offer`) ne dit « aucun tiers » ni « aucune ressource externe » sans l'exception. Texte de référence : « Ce site ne charge rien depuis un autre site. Seule exception : si la vérification anti-robot échoue, une vérification Google peut être proposée, et seulement après votre clic, dans un cadre séparé qui n'a jamais accès à vos clés. » *Contrôle* : `i18n.test.ts` : toute chaîne qui correspond à `/aucun tiers|aucune ressource (externe|tierce)|no third part/i` contient aussi « Google » ou « reCAPTCHA » (liste de motifs partagée avec les Tasks 25 et 27).
- [ ] **Texte de confiance.** « Aucun traceur, aucune mesure d'audience, aucune publicité. » reste vrai pendant la preuve de travail. *Contrôle* : e2e `captcha.spec.ts` : pendant le pré-calcul et la résolution, toutes les requêtes ont l'origine de l'application (aucune vers l'origine de vérification ni vers Google).
- [ ] **M3, étape cochée seulement après réalité.** Si la vérification apparaît dans `PhaseList`, sa coche ne s'allume qu'après acceptation de la preuve par le serveur, jamais à l'envoi du calcul. *Contrôle* : e2e : `page.route` retarde la réponse de création ; la coche est absente avant, présente après.

---

### Task 15 : Serveur — repli reCAPTCHA

Q3 réglée (spec v2.5 §26, CLAUDE.md). Q1 reste ouverte : le code est générique sur `SHH_VERIF_ORIGIN` ; seule la règle « site différent » est imposée au démarrage.

**Files:**
- Create: `server/internal/captcha/recaptcha.go`, `server/internal/captcha/recaptcha_test.go`
- Modify: `server/internal/config/config.go`, `config_test.go`, `server/internal/api/handlers_share.go`, `server/internal/api/api.go`, `server/internal/api/headers.go`, `server/internal/api/*_test.go`, `server/cmd/shhdrop/main.go`

**Interfaces:**
```go
// config : RecaptchaSecret string; VerifOrigin string; RecaptchaVerifyURL string; Origin string
//   SHH_ORIGIN = origine publique du site (obligatoire dès que SHH_RECAPTCHA_SECRET est donné)
func sameSite(a, b string) bool        // liste PSL minimale embarquée (github.io, pages.dev) ; sinon les deux derniers labels ; IP ou nom à un seul label : l'hôte entier
type Siteverify interface { Verify(ctx context.Context, token string) (VerifyResult, error) }
type VerifyResult struct { Success bool; Hostname string; ChallengeTS time.Time }
func NewSiteverify(secret, url string, client *http.Client) Siteverify   // POST secret+response, jamais remoteip, délai 5 s
func (c *Captcha) VerifyFallback(ctx context.Context, sv Siteverify, token, salt string, ip netip.Addr, hp string, shownAt time.Time, verifHost string) error
//   consomme le sel SOUS le verrou de Captcha (définitivement), relâche le verrou, PUIS appelle siteverify
func withHeaders(next http.Handler, verifOrigin string) http.Handler     // securityHeaders devient securityHeaders(verifOrigin) : frame-src 'self' <origine> si non vide
```
Corps de création : `recaptcha` (jeton) + **`captcha_salt`** (le sel du défi émis). La clé `salt` du corps est le sel KDF et ne change pas.

- [ ] **Step 1 : Tests qui échouent.**
  - `config_test.go` : secret sans `SHH_VERIF_ORIGIN` → erreur ; secret sans `SHH_ORIGIN` → erreur ; origine de vérification non `https://` (hors boucle locale) → erreur ; `SHH_RECAPTCHA_VERIFY_URL` `http://` hors boucle locale → erreur ; sans secret → repli désactivé. **Même site refusé, site différent accepté** (`sameSite`) : `verif.shhdrop.app` contre `shhdrop.app` → refusé ; `x.github.io` contre `shhdrop.app` → accepté ; `a.github.io` contre `b.github.io` → accepté (`github.io` est un suffixe public) ; `a.pages.dev` contre `b.pages.dev` → accepté ; `127.0.0.1` contre `localhost` → accepté ; origine égale → refusé. Limite écrite en commentaire : les suffixes à plusieurs labels absents de la liste minimale (`co.uk`…) sont traités par les deux derniers labels, donc refusés par prudence.
  - `recaptcha_test.go` (faux `siteverify` en `httptest.Server`) : succès ; `success:false` → `ErrInvalid` ; `hostname` différent → `ErrInvalid` ; `challenge_ts` > 2 min → `ErrInvalid` ; même jeton deux fois → second refusé (empreinte en mémoire) ; sel déjà consommé → refusé ; `shown_at` non lié au sel → refusé ; moins de 3 s → refusé ; délai de Google dépassé → `ErrInvalid` ; le corps envoyé à Google ne contient ni `remoteip` ni l'adresse du client ; une création par repli compte dans la fenêtre d'une heure (le défi suivant de la même connexion a un niveau supérieur). **Verrou** : deux replis dont le `siteverify` met 2 s à répondre, lancés en parallèle ; pendant ce temps `Challenge()` (et une vérification de preuve de travail) répond en moins de 100 ms ; un échec de `siteverify` perd le sel (rejeu refusé).
  - API : `GET /api/captcha` → `"fallback": null` sans secret, l'origine sinon ; `POST /api/shares` avec `altcha` et `recaptcha` → 400 ; `recaptcha` sans `captcha_salt` → 400 ; `recaptcha` de plus de 4 096 caractères → 400 ; **`salt` reste le sel KDF** (une création par repli avec `captcha_salt` ≠ `salt` conserve `salt` tel quel) ; CSP des réponses → `frame-src 'self' <origine>` quand activé, inchangée sinon ; le jeton n'apparaît dans aucun journal (capture du `slog`).
- [ ] **Step 2 : Lancer** `cd server && go test ./...` → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §15.4 (corps de création : champ `recaptcha` et `captcha_salt` optionnels, exactement un des deux modes ; le sel est consommé sous le verrou de `Captcha`, le verrou est relâché, puis `siteverify` est appelé, jamais sous le verrou : un `siteverify` lent ne bloque ni les défis ni les autres vérifications).
- [ ] **Step 4 : Lancer** `go test -race ./... && GOARCH=386 go build ./... && go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...` (même commande que `ci.yml`) → SUCCÈS ; `make test` (dont « le serveur ne voit rien ») vert.
- [ ] **Step 5 : Commit** « feat(server): repli reCAPTCHA vérifié par siteverify, lié au défi, usage unique » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **B1 et « Aucune adresse IP enregistrée ».** L'appel `siteverify` n'envoie que `secret` et `response`, jamais `remoteip` (l'adresse IP de l'utilisateur ne part pas vers Google depuis le serveur) ; aucune ligne de journal ne contient l'adresse IP ni le jeton. *Contrôle* : `recaptcha_test.go` : le faux `siteverify` (`httptest.Server`) enregistre le corps reçu et le test échoue s'il contient `remoteip` ; test de journal : un échec de vérification n'écrit ni jeton ni adresse.
- [ ] **Texte de confiance honnête.** Le repli est la seule exception à « rien depuis un autre site » ; sans `SHH_RECAPTCHA_SECRET`, `GET /api/captcha` renvoie `fallback: null` et l'interface ne propose jamais Google. *Contrôle* : test d'API existant complété par un test e2e (Task 16) vérifiant l'absence de la feuille « Vérification supplémentaire » quand `fallback` vaut `null`.

---

### Task 16 : Cadre de vérification et repli client

**Files:**
- Create: `web/verif/index.html`, `web/verif/verif.ts`, `web/verif/verif.css`, `web/verif/config.js` (valeurs de test), `web/vite.verif.config.ts`, `web/src/captcha/verif-host.ts`, `verif-host.test.ts`, `web/src/ui/VerifFrame.svelte`, `web/ui-e2e/verif-origin.ts`, `web/ui-e2e/verif.spec.ts`, `web/ui-e2e/files/fake-recaptcha.js`
- Modify: `web/src/captcha/solve.ts` (branche `consent` et `askFallback` sur la feuille et `VerifFrame`), `web/scripts/check-dist.mjs` (option `--verif`) et `web/scripts/check-dist.test.ts`, `web/package.json` (`build:verif` ; `build` = application puis `build:verif`, Task 22 y ajoute le cadre PDF), `.gitignore` (`web/dist-verif/`)

**Interfaces:**
```ts
// verif-host.ts
askFallback(origin: string, mount: HTMLElement, signal: AbortSignal, lang: "fr" | "en"): Promise<string>;  // jeton ; même signature que la dépendance de makeSolveCaptcha (Task 14)
acceptMessage(e: MessageEvent, origin: string, frame: Window): { type: "ready" | "token" | "expired" | "error"; token?: string } | null;
// verif.ts (autre origine) : charge grecaptcha (URL depuis config.js), render({ sitekey, callback, "expired-callback" }), postMessage vers APP_ORIGIN exacte
```
Le consentement est modélisé par la dépendance `consent(signal): Promise<boolean>` de `makeSolveCaptcha` (Task 14) : la feuille « Vérification supplémentaire » la résout au clic « Continuer avec Google » ; `askFallback` (donc le chargement du cadre) n'est appelé qu'après.

- [ ] **Step 1 : Tests qui échouent** (`verif-host.test.ts`, fichier `// @vitest-environment happy-dom` : il faut un DOM pour l'`iframe`) : message d'une autre origine → ignoré ; bonne origine mais `source` différente → ignoré ; jeton hors `[A-Za-z0-9_-]{20,4096}` → ignoré ; `v` ≠ 1 → ignoré ; `signal` → cadre retiré ; 15 s sans `ready` → rejet `cadre_muet` ; l'iframe a exactement `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`, `referrerpolicy="no-referrer"`, `allow=""`. `check-dist.test.ts` : `--verif` échoue si `dist-verif/` importe un fichier de `src/`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.4.2, §15.2–§15.3 : `Sheet` « Vérification supplémentaire » (texte de consentement, **rien chargé avant** « Continuer avec Google »), `VerifFrame` (`min(100 %, 400px)` × `min(600px, 85dvh)`), branchement dans `makeSolveCaptcha` par `solve.ts`. Build `vite.verif.config.ts` → `web/dist-verif/` (aucun module partagé avec l'application, vérifié par `check-dist.mjs --verif` : aucun import de `src/`).
- [ ] **Step 4 : e2e** (`verif.spec.ts`) : l'application est servie sur `http://127.0.0.1:<port>` (fixture `shh`, `startServer`) ; `verif-origin.ts` sert `dist-verif/` sur `http://localhost:<port2>` (origines distinctes) avec la CSP de UI §15.2, et `fake-recaptcha.js` à la place de Google ; serveur Go lancé avec `SHH_ORIGIN=http://127.0.0.1:<port>`, `SHH_RECAPTCHA_SECRET`, `SHH_VERIF_ORIGIN=http://localhost:<port2>`, `SHH_RECAPTCHA_VERIFY_URL` vers un faux `siteverify`. Parcours : `Worker` retiré → feuille de consentement, **aucune requête vers l'origine de vérification avant le clic** ; clic → case cochée dans le cadre → jeton → envoi réussi, « Lien prêt ». Contrôles : aucune requête du cadre principal hors `127.0.0.1` sauf le document du cadre ; un `postMessage` forgé depuis la page (`window.postMessage`) n'est pas accepté ; Échap ferme la feuille = envoi annulé ; aucune violation CSP ; captures `verif-consent`, `verif-frame`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(captcha): repli reCAPTCHA dans un cadre d'une autre origine, après consentement » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **B1, le consentement dit l'exception en clair.** Le corps de la feuille « Vérification supplémentaire » reprend la phrase de référence : « si la vérification anti-robot échoue, une vérification Google peut être proposée, et seulement après votre clic, dans un cadre séparé qui n'a jamais accès à vos clés. » **Signalement (moyenne, confidentialité)** : charger reCAPTCHA expose l'adresse IP et des signaux du navigateur à Google, ce que la phrase de l'étude ne dit pas. Proposition : ajouter « Google verra votre adresse IP. » dans la feuille et dans la page Confidentialité (Task 25), à valider par le propriétaire. *Contrôle* : e2e : avant « Continuer avec Google », aucune requête vers l'origine de vérification ni vers `fake-recaptcha.js` ; le texte de la feuille contient « Google », « cadre séparé » et « clés » ; après le clic, les requêtes démarrent.
- [ ] **Sortie visible.** La feuille offre un refus aussi visible que « Continuer avec Google » (anti-motif « raison toujours dite »). *Contrôle* : e2e : le bouton de refus est atteignable au clavier ; son activation ne charge rien et renvoie `captcha_impossible` avec un message qui dit quoi faire.

---

### Task 17 : Envoi — scellement, mesures, coupure, pause, annulation

**Files:**
- Create: `web/src/flows/send.svelte.ts`, `send.test.ts`, `web/src/flows/stats.ts`, `stats.test.ts`, `web/src/routes/Sealing.svelte`, `web/src/ui/SealCapsule.svelte`, `UploadStats.svelte`, `PhaseList.svelte`, `web/src/ui/seal.css`, `web/src/app/wakelock.ts`, `web/ui-e2e/send.spec.ts`

**Interfaces:**
```ts
createStats(now: () => number) → { push(sent: number, total: number): void; rate(): number | null /* EMA τ = 3 s, null avant 3 s */;
  eta(): number | null /* null avant 5 s ou si rate ≤ 0 */; percent(): number /* floor */ };
createSender(deps = { createShare, solveCaptcha, prefetcher?: { take(); stop() }, now, wakeLock, onBeforeUnload }) → {   // prefetcher : Task 14, absent en démo
  phase: "idle" | "keys" | "captcha" | "fallback" | "upload" | "paused" | "offline" | "finalize" | "sealed" | "cancelled" | "error";
  sent: number; total: number; segments: { done: number; total: number };
  retry?: { inMs: number; offline: boolean }; pauseLeftMs?: number; tooSlow: boolean;
  error?: SendError; retryAfterS?: number; createdOnServer: boolean;
  result?: { link: string; manage: string; expiresInS: number; password: string };
  start(items: Item[], opts): Promise<void>;      // refuse hors "idle"
  pause(): void; resume(): void; cancel(): void; retry(): Promise<void>;
};
type SendError = "reseau" | "interrompu" | "limite" | "plein" | "gele" | "captcha" | "fichier_modifie" | "inattendu";
PAUSE_MAX_MS = 600_000; UPLOAD_WINDOW_MS = 3 * 3600_000; STALL_MS = 10_000 /* aucun octet depuis 10 s → offline ; sans rapport avec SERVER_STALL_MS */;
// SERVER_STALL_MS (13 min, importé de index.ts) : seule échéance, partagée par la pause et la coupure.
// deadline() = lastAckAt + SERVER_STALL_MS ; lastAckAt = instant du dernier onProgress (segment acquitté), initialisé à l'entrée en `upload`.
// Reprise automatique d'une pause : à min(début de la pause + PAUSE_MAX_MS, deadline()).
// Ordre des essais de création : (1) preuve pré-calculée (prefetcher.take()) ou preuve de travail ; (2) nouvel essai complet en preuve de travail, SANS pré-calcul ;
//   (3) repli Google (ctx.mode = "fallback") seulement si fallbackOrigin ≠ null ; sinon, ou si (3) échoue : erreur `captcha`. createSender fixe ctx.mode (CaptchaCtx, Task 0).
```

- [ ] **Step 1 : Tests qui échouent** (`createShare` simulé, horloge injectée) : phases `keys` → `captcha` (appel de `solveCaptcha`) → `upload` (`onProgress(0,n)`) → `finalize` (`onBytes(total,total)`) → `sealed` (résolution seulement) ; `start` deux fois → un seul `createShare` ; `onRetry` → `offline` avec `inMs`, retour à `upload` au progrès suivant ; 10 s sans octet → `offline` ; `pause()` → `paused` à la fin du segment, reprise automatique à `min(10 min, deadline())` (cas testé : segment acquitté il y a 5 min, pause demandée → reprise à 8 min de pause, pas à 10), pause refusée à moins de 15 min de la fin de la fenêtre de 3 h ; `cancel()` → `abort()`, phase `cancelled`, `createdOnServer` exact ; `cancel` ignoré en `finalize` ; `tooSlow` quand `eta > fenêtre restante` ; erreurs UI §9.4.6 (`Error("full")` → `plein`, `Error("frozen")` → `gele`, `NotReadableError` → `fichier_modifie` avec l'élément fautif, `bad_request` → ordre des essais ci-dessus, vérifié avec `fallbackOrigin` nul (2 essais puis `captcha`) et non nul (3 essais, le dernier en `mode: "fallback"`), et un `bad_request` sur une preuve pré-calculée relance un essai en preuve de travail sans pré-calcul, pas le repli) ; `LimitError(120)` → `retryAfterS` ; `retry()` rappelle `createShare` en entier (nouveau `take()`) ; `start` prélève la preuve pré-calculée (`prepared`) et le préfetcher est arrêté à l'annulation et à `pagehide` ; mot de passe gardé seulement dans `result` ; verrou d'écran demandé en `keys`, relâché en pause, à la fin et à l'annulation. `stats.test.ts` : EMA sur une série connue, `percent` jamais 100 avant `sent === total`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §7.3 et §9.4 : capsule (`<rect pathLength="100">`, encoche de départ, pourcentage `--fs-figure`, trait indéterminé, progression en octets par `requestAnimationFrame`, pause et coupure), FLIP aller et retour (composeur `inert` et intact), fermeture du sceau en WAAPI après résolution seulement, `UploadStats` (hiérarchie UI §9.4.1, aide sur la taille de palier), `PhaseList`, bandeaux de coupure et « trop lent », Pause/Reprendre, Annuler + `InlineConfirm` (masqué en `finalize`), `beforeunload` de `keys` à la résolution, `pagehide` → `cancel()` (et `prefetcher.stop()`), preuve factice par `getDemo()?.solveCaptcha ?? solveCaptcha`, titre « 42 % · Shhdrop », bascule de langue désactivée, `role="progressbar"`, annonces tous les 10 %.
- [ ] **Step 4 : e2e** (`send.spec.ts`, vrai serveur) : texte + photo → phases dans l'ordre, « Lien prêt » seulement après la réponse de `finalize` (`page.route` qui retarde `finalize` de 2 s : la capsule affiche « Finalisation » pendant ce temps) ; 20 Mo avec `context.setOffline(true)` pendant **60 s** puis `false` → bandeau avec compte à rebours, puis succès ; Pause → plus aucun `PUT` pendant 5 s → Reprendre → succès ; Annuler au milieu → retour au composeur intact, et le partage n'existe plus (`shareStatus` en Node par le lien de gestion intercepté → `NotFoundError`) ; fermeture de la page au milieu (`page.close({ runBeforeUnload: false })`) → partage effacé côté serveur (requête `destroy` `keepalive` reçue) ; double clic → une seule création ; `beforeunload` armé pendant l'envoi seulement ; partage disparu pendant l'envoi (serveur redémarré sur une base vide au même port, ou `page.route` qui répond 404 aux `PUT`) → « Le transfert a été interrompu » (un serveur simplement arrêté est une coupure : `reseau` après l'échéance, testé en unitaire avec l'horloge injectée, pas en e2e) ; `Worker` retiré sans repli → « La vérification anti-robot n'a pas pu se faire sur cet appareil » + Réessayer ; avec une preuve pré-calculée, l'envoi ne rappelle pas `GET /api/captcha` ; `LimitError` simulée → Réessayer désactivé avec compte à rebours ; 320 px et paysage 844 × 390 sans débordement ; captures `seal-progress`, `seal-offline`, `seal-paused`, `seal-sealed` (mouvement réduit). Démo : envoi complet ajouté, et `?coupure` montre le bandeau puis la reprise.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): envoi (progression réelle, vitesse, reprise, pause, annulation) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M3, coches d'étape seulement après progrès réel.** Sous la capsule : « Chiffré sur cet appareil » → « Envoyé » → « Scellé ». « Chiffré sur cet appareil » s'allume quand le contenu et l'enveloppe sont chiffrés (état du brouillon de la Task K3, pas le clic) ; « Envoyé » après l'accusé du dernier segment ; « Scellé » après la réponse de `finalize`. Annonces `aria-live="polite"`, une par étape. *Contrôle* : e2e : `page.route` retarde le dernier `PUT` de 2 s puis `finalize` de 2 s : « Envoyé » est absent (`toHaveCount(0)`) avant l'accusé et présent après, « Scellé » est absent jusqu'à `finalize` ; coupure réseau ou pause → aucune coche supplémentaire ; annulation → aucune coche ne reste ; `send.test.ts` : événements d'étape émis dans l'ordre, un par étape ; espion sur `LiveRegion` : exactement 3 annonces.
- [ ] **M2, montrer ce que reçoit le serveur.** Volet de texte chiffré **décoratif** à côté de la capsule, avec la légende « Voici, en image, ce que le serveur reçoit : des données illisibles. » Le générateur prend une graine fixe, jamais un tampon réel. *Contrôle* : unit : la fonction a la signature `(seed: number) => string` et renvoie deux fois la même chaîne ; `source-rules.test.ts` interdit tout import du conteneur ou des octets dans le module du volet ; e2e `reducedMotion` : volet statique (aucune animation), glyphes `aria-hidden`, légende exposée.
- [ ] **Lien jamais avant `finalize` (motif refusé : lien disponible avant la fin).** *Contrôle* : e2e : pendant le retard de `finalize`, `location.hash` est vide, aucun élément ne contient de lien de partage et `Ready` n'est pas monté.
- [ ] **M12, l'arrêt reste à portée.** « Annuler » et « Pause » sont visibles et focalisables à chaque phase où `cancel()` est permis ; dans la phase où l'annulation ne l'est plus, un texte dit pourquoi (« Finalisation ») au lieu d'un bouton grisé muet. *Contrôle* : e2e : pour chaque phase de `PhaseList`, présence du bouton ou du texte d'explication.
- [ ] **M6 et M5.** La capsule de scellement garde un nom de transition de vue stable (`capsule`) jusqu'à « Lien prêt » ; les mesures (octets, vitesse, pourcentage) sont des valeurs réelles en chiffres tabulaires. *Contrôle* : e2e : `getComputedStyle(...).viewTransitionName === "capsule"` avant et après la fermeture du sceau ; `tabular-nums` sur `UploadStats`.

---

### Task 18 : Lien prêt

**Files:**
- Create: `web/src/routes/Ready.svelte`, `web/src/qr/qr.ts`, `qr.test.ts`, `web/src/ui/QrCode.svelte`, `web/ui-e2e/ready.spec.ts`
- Modify: `web/package.json` (`uqr@0.1.3`), `THIRD_PARTY_LICENSES.md`

**Interfaces:** `qrPath(text)` → `{ size; d }` ; `QrCode` par `import()` dynamique.

- [ ] **Step 1 : Tests qui échouent** : `qrPath` d'un lien de 80 caractères (taille attendue, `d` limité à `M h v z` et nombres, et nombre de modules sombres de `d` égal à celui de la matrice `uqr` du même texte).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.5 : trois `CopyField`, Partager, QR, Vider le presse-papier, mention d'expiration calculée sur `expiresInS`, Terminé + `InlineConfirm`, **Supprimer ce partage** (séparé, `destroyShare(manage, location.origin)`, dissolution, « Partage supprimé », `NotFoundError` traité comme supprimé, `reseau` → Réessayer), `beforeunload` jusqu'à Terminé ou Supprimer. En démo seulement : bouton « Ouvrir comme destinataire (démo) » affiché si `getDemo()` n'est pas `null` et appelant `getDemo().openAsRecipient(link)` (`navigate` vers le lien avec base, sans rechargement).
- [ ] **Step 4 : e2e** : copie du lien (presse-papier = lien entier) et du mot de passe ; `navigator.share` simulé reçoit `{ url }` sans mot de passe ; Vider ; `beforeunload` armé jusqu'à Terminé ; Supprimer → confirmation → « Partage supprimé » et `fetchMeta` en Node → `NotFoundError` ; Terminé → composeur vide, ni lien ni mot de passe dans `document.body.innerText` ; `axe` ; captures `ready`, `ready-qr`, `ready-deleted`. Démo : « Ouvrir comme destinataire » mène à l'écran d'ouverture.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): lien prêt (copie, partage, QR, suppression, garde de sortie) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M18 et S2, deux cartes pour deux secrets.** Carte « Lien » (Copier en action principale, Partager, QR) et carte « Mot de passe » (Copier), séparées physiquement (montée en éventail de 640 ms en `transform`), avec entre elles : « Un mot de passe en plus du lien. Envoyez-les par deux moyens différents. » *Contrôle* : e2e : ordre du DOM carte lien → rappel → carte mot de passe, deux `role="group"` nommés ; le mot de passe n'apparaît ni dans la carte lien, ni dans le QR décodé, ni dans la charge de `navigator.share` ; Copier lit l'état, jamais le DOM (remplacer `textContent` par « x » avant le clic : le presse-papier reçoit encore la vraie valeur) ; `getAnimations()` : durée ≤ 640 ms, aucune animation avec `reducedMotion: "reduce"`, boutons cliquables pendant l'animation.
- [ ] **S5, mode dictée.** Bouton « Lire à voix haute » sous le mot de passe : affichage en gros, caractère par caractère, avec un mot d'aide pour chaque caractère ambigu (« B majuscule », « 7 chiffre », « ! point d'exclamation »). Tout est local, aucune synthèse vocale ni service tiers. *Contrôle* : `dictate.test.ts` : chaque caractère de l'alphabet de `generatePassword()` a une étiquette non vide, et les paires ambiguës (O/0, l/I/1, B/8, S/5, etc.) ont des étiquettes distinctes ; `source-rules.test.ts` : aucune occurrence de `speechSynthesis` ni de requête réseau dans le module ; e2e : Échap ferme le mode, le mot de passe n'est écrit ni dans la console ni dans `localStorage`.
- [ ] **M12, état « en cours » et arrêt visibles.** Pastille « Actif · s'efface vers 9 h 45 » (échéance arrondie au quart d'heure le plus proche, formulation « vers ») et bouton **Supprimer ce partage** toujours à portée. *Contrôle* : e2e avec `page.clock` : échéance 9 h 41 → « vers 9 h 45 », 9 h 36 → « vers 9 h 30 » (espaces normalisés dans l'assertion) ; le bouton est dans la fenêtre à 390 × 844 sans défilement ou fixé en bas.
- [ ] **Texte de confiance : autodestruction.** Remplacer la mention d'expiration par : « S'efface tout seul : après 1 ouverture, ou au bout de 12 h. » avec les valeurs choisies (« 3 ouvertures », « 6 h »). *Contrôle* : e2e : options 3 ouvertures et 6 h → « S'efface tout seul : après 3 ouvertures, ou au bout de 6 h. » ; jamais « disparaît de partout ».
- [ ] **M6 et motif refusé (envoi par e-mail).** La petite capsule scellée prolonge celle de la Task 17 ; aucun champ d'adresse e-mail du destinataire (le serveur la connaîtrait) : `navigator.share` suffit. *Contrôle* : e2e : aucun `input[type=email]` ; le partage ne transmet que `{ url }`.

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

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M11, cycle de vie lisible d'un coup d'œil.** Composant partagé `StateChip.svelte` (réutilisé en Task H) : une icône et un mot par état, jamais la couleur seule : Actif, En cours d'effacement (`draining`), Détruit, Expiré ; ouvertures en « 1 / 3 ». **Signalement (faible)** : le plan emploie « Supprimé » pour l'état final, l'étude « Détruit » ; garder un seul mot d'état. Proposition : « Détruit » (cohérent avec « Ce partage a été détruit » chez le destinataire), l'action restant « Supprimer ce partage ». Le compte à rebours local à zéro donne « Expiré », un `NotFoundError` après `destroy()` donne « Détruit ». *Contrôle* : `manage.test.ts` : matrice état → (mot, icône) ; e2e : chaque état a un mot visible, l'icône est `aria-hidden`, `axe` sans violation de contraste, et le mot reste lisible avec `forcedColors: "active"`.
- [ ] **M12, état et arrêt visibles.** La pastille « Actif » et **Supprimer ce partage** restent visibles dès l'état `ready`. *Contrôle* : e2e à 390 × 844 : le bouton est atteignable sans défilement ou fixé.
- [ ] **S1, la vue du serveur.** Bascule « Ce que voit le serveur » : la capsule se retourne (rotation 3D en `transform`, 420 ms ; fondu en mouvement réduit) et montre : « un bloc illisible d'environ 142 Mo · s'efface vers 9 h 45 · 0 ouverture sur 1 · aucun nom, aucun texte, aucune clé » (valeurs d'exemple). **B5** : les valeurs viennent de `shareStatus` (taille arrondie, échéance au quart d'heure, compteur), la bascule n'existe pas pendant `uploading`. Si `shareStatus` n'expose pas la taille, ne pas ajouter de champ serveur pour cela : omettre ce segment et le consigner dans le fichier de décisions. *Contrôle* : `serverView.test.ts` : fonction pure `serverCard(status)` (aucun paramètre de nom ni de texte) → chaîne attendue ; e2e : bascule absente en `uploading`, présente en `ready` ; avec des noms et textes distinctifs saisis à l'envoi, la fiche ne contient ni eux ni le fragment `#` du lien ; face cachée `inert`, bouton `aria-pressed`.
- [ ] **Motif refusé : options modifiables après création.** Aucun contrôle ne modifie la durée ni le nombre d'ouvertures. *Contrôle* : e2e : la page ne contient aucun champ de durée ou d'ouvertures et n'émet aucune requête de modification.
- [ ] **S3 (branchement).** Le contour de temps restant (`TimeRim`, créé en Task 20) est branché ici dans `Manage.svelte` à la fin de la Task 20.

---

### Task 20 : Ouverture

**Files:**
- Create: `web/src/routes/Open.svelte`, `web/src/routes/Invalid.svelte`, `web/src/flows/receive.svelte.ts`, `receive.test.ts`, `web/ui-e2e/open.spec.ts`

**Interfaces:** `createReceiver(link, deps = { fetchMeta, openShare, now, inAppBrowser: () => string | null, scrub: () => void })` → `{ state: "meta" | "inapp" | "locked" | "unlocking" | "open" | "invalid" | "destroyed_by_password" | "incomplete" | "error"; expiresInS; attemptsLeft?; retryAfterS?; opened?: Opened; continueHere(); unlock(password): Promise<void> }` (aucun mot de passe gardé après `unlock`). `inAppBrowser` enveloppe `inAppBrowser(ua, standalone)` de Task 5 et `scrub` enveloppe `scrubAddressBar(history, pathname)`. Le bouton « Déverrouiller » est désactivé tant que le champ est vide ; si `openShare` lève quand même `Error("mot_de_passe_requis")` (Task M), l'état reste `locked`, `attemptsLeft` ne change pas, aucun essai n'est consommé et l'erreur `mot_de_passe_requis` est exposée (message « Entrez le mot de passe. »).

- [ ] **Step 1 : Tests qui échouent** : `NotFoundError` / `lien_invalide` à `fetchMeta` → `invalid` ; `BadPasswordError(3)` → `locked`, `attemptsLeft = 3` ; `attemptsLeft` était 1 puis `NotFoundError` → `destroyed_by_password` ; `LimitError(120)` ; compte à rebours à zéro en `locked` → `invalid` sans appel ; `unlock` deux fois de suite → un seul `openShare` ; navigateur intégré → `inapp` puis `locked` après `continueHere()`, `scrubAddressBar` seulement à ce moment ; après succès, aucune référence au mot de passe dans l'état ; `unlock("")` / `Error("mot_de_passe_requis")` → message « Entrez le mot de passe. », `attemptsLeft` inchangé, état `locked` ; `inAppBrowser` et `scrub` sont des dépendances injectées (espion : `scrub` n'est appelé qu'après `continueHere()`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.7 et §9.11 (dont la phrase de démo sur « Lien invalide » quand `getDemo() !== null` : la chaîne vient de `getDemo().invalidLinkNote`, pas du dictionnaire de production ; `Open.svelte` n'importe jamais `demo/`).
- [ ] **Step 4 : e2e** : deux mauvais mots de passe → « 3 essais restants » ; cinq → « Mot de passe incorrect. Le partage a été détruit. », partage absent en Node ; bon mot de passe → contenu ; sans `#` → « Lien incomplet » sans requête `/api/` ; agent Instagram → bandeau, `#` conservé jusqu'à « Continuer ici quand même » (cas déplacé de Task 5), qui l'efface, et « Copier le lien » donne le lien avec sa clé ; mot de passe vide → bouton désactivé ; en démo, `/Shhdrop/s/abc#x` → « Lien invalide » avec la phrase de démo (cas déplacé de Task 8) ; `page.clock` au-delà de l'expiration sur l'écran verrouillé → « Lien invalide » ; `axe` ; captures `open`, `open-badpw`, `open-inapp`, `invalid`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): ouverture, essais, navigateur intégré, liens invalides » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M9, le geste irréversible annoncé avant.** Dans les états `meta` et `locked`, avant tout déverrouillage : « Ce partage peut être ouvert encore **1 fois**. L'ouvrir maintenant compte cette ouverture, même si vous rechargez la page. » (pluriel : « encore **3 fois** »). La donnée vient de `fetchMeta`, qui ne consomme rien (UI §0.1). *Contrôle* : e2e : partage avec `maxOpens = 3` → « encore 3 fois » ; deux rechargements sans déverrouiller → toujours « 3 fois » et `shareStatus` en Node montre 0 ouverture consommée ; déverrouillage → 1 ouverture comptée ; rechargement → « encore 2 fois » ; la phrase est reliée au bouton d'ouverture par `aria-describedby` ; unit : singulier et pluriel. Si `fetchMeta` n'expose pas le nombre restant, afficher la seconde phrase seule et le consigner dans le fichier de décisions.
- [ ] **S3, le temps qui reste, dessiné.** Composant `TimeRim.svelte` : le contour de la capsule (même tracé `pathLength="100"` que le scellement) se raccourcit avec le temps restant, mis à jour à la minute (aucune boucle d'animation) ; les ouvertures restantes sont de petites encoches ; texte complet pour lecteurs d'écran (« Expire dans 5 h 12 · 2 ouvertures restantes »). Modifier aussi `Manage.svelte` pour l'employer. *Contrôle* : `rim.test.ts` : décalage du tracé = 100 × restant / total (6 h sur 12 h → 50), nombre d'encoches = ouvertures restantes ; e2e : `page.clock.fastForward(60_000)` met à jour le contour ; aucun appel à `requestAnimationFrame` pendant 5 s d'inactivité ; mouvement réduit → aucune transition. Si `fetchMeta` ne donne pas la durée totale, le contour se calibre sur la première mesure de la session (à consigner).
- [ ] **Texte de confiance.** Sous la capsule verrouillée : « Le serveur ne reçoit que des données chiffrées, jamais la clé. » et, près du champ : « 5 essais ratés, et le partage est détruit. » (constante de la Task K1) en plus de « n essais restants ». *Contrôle* : e2e : les deux textes sont visibles à l'état `locked` ; le chiffre « 5 » égale la constante.
- [ ] **M6, la capsule du destinataire.** Capsule verrouillée qui s'ouvre au déverrouillage (même élément, `data-state="locked"` puis `"open"`). *Contrôle* : e2e : l'attribut passe de `locked` à `open` sans remontage.
- [ ] **Anti-motifs : page du destinataire sans publicité ni tiers.** *Contrôle* : e2e : sur `Open`, toutes les requêtes ont l'origine de l'application ; aucun bandeau, aucune offre dans le DOM.

---

### Task 21 : Contenu et visionneuses natives

**Files:**
- Create: `web/src/routes/Content.svelte`, `web/src/viewers/blobs.ts`, `blobs.test.ts`, `collect.ts`, `collect.test.ts`, `ImageViewer.svelte`, `AudioViewer.svelte`, `VideoViewer.svelte`, `TextViewer.svelte`, `web/ui-e2e/content.spec.ts`, `web/ui-e2e/files/trap.svg`, `trap.html`, `hevc.mov` (échantillon non lisible par Chromium)

**Interfaces:** `TYPE_SUR`, `safeBlobType(kind, manifestMime)` ; `trackUrl(blob)` / `revokeAll()` ; `collectPreview(opened, i, onBytes, signal)` ; `previewQueue()` (un aperçu à la fois) ; `PREVIEW_MAX` (importé de `index.ts`, jamais redéfini : l'écran n'importe pas `crypto/container`), `AUTO_IMAGE_MAX`.

- [ ] **Step 1 : Tests qui échouent** : `safeBlobType` (HTML déclaré image → `null`, `video/quicktime` gardé, type inconnu de vidéo → `video/mp4`, `none` → `null`) ; `collectPreview` (octets cumulés, tranches mises à zéro, `signal`) ; `revokeAll` ; `previewQueue` sérialise deux demandes.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.8 : bandeau collé, groupes par `categoryOfReceived` (même table que `categoryOf`, Task 9a, donc mêmes groupes qu'à l'envoi même quand `previewKind` vaut `none`) dans l'ordre du manifeste, règles d'aperçu, image révoquée au `load`, vidéo après téléchargement complet, échec de décodage → message + Enregistrer, texte en `<pre dir="auto">`, expiration pendant la lecture, `NotFoundError` en cours de lecture, `beforeunload` pendant un téléchargement seulement, alerte mémoire.
- [ ] **Step 4 : e2e** : partage texte + JPEG + MP3 + MP4 + `trap.svg` + `trap.html` + `hevc.mov` → groupes et ordre identiques à l'envoi ; texte affiché ; image affichée, `window.__pwned` jamais défini, URL blob invalide après `load` ; audio et vidéo lisibles ; `hevc.mov` sur Chromium → « ne peut pas être lu sur cet appareil » ; `trap.html` → Enregistrer seulement ; expiration (`page.clock`) → bandeau « Expiré », boutons désactivés ; destruction par l'expéditeur pendant la lecture → message `NotFoundError` ; Retour → rechargement, aucun texte du partage ; fichier déposé sur la page → aucune navigation ; `axe` ; captures `content`, `content-image`, `content-expired`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(viewers): contenu, image/audio/vidéo/texte, URL blob maîtrisées » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **Anti-motif « publicité ou contenu sponsorisé chez le destinataire ».** La page de contenu ne montre rien d'autre que le partage, ses actions et les liens de pied. *Contrôle* : e2e `content.spec.ts` : toutes les requêtes ont l'origine de l'application (journal `page.on("request")`), aucun `<iframe>` hors cadre PDF, aucun encart promotionnel.
- [ ] **M6, la capsule ouverte.** Le bandeau collé reprend la capsule de la Task 20 à l'état `open`, avec le contour de temps (S3) en petit. *Contrôle* : e2e : `data-state="open"` ; le texte complet du temps restant est présent pour les lecteurs d'écran.
- [ ] **B1.** Aucun texte de cette tâche ne dit « aucun tiers » sans l'exception reCAPTCHA. *Contrôle* : couvert par le test partagé des Tasks 14 et 27.

---

### Task 22 : PDF isolé (prototype bloquant, puis visionneuse)

**Files:**
- Create: `web/pdf-frame.html`, `web/src/viewers/pdf-frame/main.ts`, `frame.css`, `web/src/viewers/pdf-host.ts`, `pdf-host.test.ts`, `PdfViewer.svelte`, `web/vite.pdf-frame.config.ts`, `web/ui-e2e/pdf.spec.ts`, `web/ui-e2e/files/js.pdf`, `simple.pdf`
- Modify: `web/package.json` (`pdfjs-dist@6.5.438`, `build` = application + cadre PDF + vérification), `THIRD_PARTY_LICENSES.md`

**Interfaces:** messages `{type:"ready"}`, `{type:"pdf", bytes, labels}` (transféré), `{type:"rendered", pages} | {type:"error"}` ; `mountPdf(container, bytes, labels): Promise<"ok" | "fallback">`.

- [ ] **Step 1 : Prototype (bloquant)** : build IIFE `dist/pdf-frame.js` + `.css` ; `getDocument({ data, isEvalSupported: false, disableWorkerRendering: true, enableXfa: false, useWasm: false, isOffscreenCanvasSupported: false })` avec `globalThis.pdfjsWorker` (`isEvalSupported: false` est indispensable : sinon pdf.js compile les polices par `new Function`, ce que la CSP interdit ; vérifier d'abord, dans `pdfjs-dist@6.5.438`, que chacun de ces noms d'options existe — `disableWorkerRendering` n'est pas une option documentée de pdf.js — et corriger le plan et UI §13 en conséquence) ; `vite.pdf-frame.config.ts` produit `pdf-frame.js` et `pdf-frame.css` **sans empreinte dans le nom** (la liste CORP de Task 2 est fermée) ; e2e `pdf.spec.ts › prototype` sur Chromium **et** WebKit, **contre le serveur Go** (`frame-ancestors 'self'` sur `/pdf-frame.html` et CORP de Task 2 en place) : `simple.pdf` → 2 pages, pixel central non transparent ; aucune violation CSP ; aucune requête hors des trois fichiers. Échec après une demi-journée de correction → visionneuse retirée (`pdf` → Enregistrer seulement), raison consignée dans `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md`, passage à la Task 23. Critère de passage = ce test contre le serveur Go, sur Chromium et WebKit ; le même test dans la démo n'est qu'un contrôle de plus (ni CORP ni `frame-ancestors` sur Pages, UI §14.3).
- [ ] **Step 2 : Tests qui échouent** (`pdf-host.test.ts`) : `ready` d'une autre `source` ignoré ; octets transférés (source détachée) ; 20 s → `fallback` ; `error` → `fallback`.
- [ ] **Step 3 : Implémenter** UI §13.
- [ ] **Step 4 : e2e** : `js.pdf` → aucune boîte de dialogue, aucune navigation ; `iframe.sandbox` vaut exactement `allow-scripts` ; origine du cadre `"null"` ; capture `pdf`.
- [ ] **Step 5 : Lancer** → SUCCÈS (ou repli consigné).
- [ ] **Step 6 : Commit** « feat(viewers): PDF isolé (pdf.js sans worker, cadre sandbox) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **Aucune ressource tierce dans le cadre PDF.** Le travailleur, les polices standard et les cartes de caractères de `pdfjs-dist` viennent de l'application, jamais d'un CDN. *Contrôle* : e2e `pdf.spec.ts` : l'ouverture de `simple.pdf` n'émet que des requêtes d'origine application ; `check-dist.mjs` échoue si le bundle du cadre contient une URL absolue `http(s)://` autre que celles listées.
- [ ] **Anti-motif « fausse sécurité ».** En droit « voir seulement » (Task R), la visionneuse retire Enregistrer, Imprimer et Copier et affiche : « L'expéditeur a choisi « voir seulement ». Cela n'empêche pas une capture d'écran. » *Contrôle* : e2e : texte présent, aucun contrôle de téléchargement ; aucune formule « protégé » ou « sécurisé » dans la visionneuse.

---

### Task 23 : Enregistrer (flux, repli Blob, fichiers à risque)

**Files:**
- Create: `web/src/viewers/save.ts`, `save.test.ts`, `web/src/ui/SaveButton.svelte`, `web/ui-e2e/save.spec.ts`

**Interfaces:** `saveItemTo(opened, i, deps = { showSaveFilePicker?, collectToBlob, click, now }, onBytes, signal): Promise<"saved" | "cancelled" | "failed" | "disk_full">`.

- [ ] **Step 1 : Tests qui échouent** : sélecteur → `suggestedName = safeName(i)`, écriture, `close()`, `saved` ; erreur de `saveItem` → `abort()`, jamais `close()`, `failed` ; `signal` → `abort()`, `cancelled` ; `AbortError` du sélecteur → `cancelled` sans écriture ; `QuotaExceededError` → `abort()`, `disk_full` ; sans sélecteur → `collectToBlob` puis `<a download>` = `safeName(i)`, URL révoquée à 60 s ; aucun chemin de `save.ts` n'utilise le MIME du manifeste (l'aperçu a sa propre liste blanche, `safeBlobType`, Task 21).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.9 (confirmation `isRiskyFile`, progression en octets et vitesse, Annuler, messages, note « assemblé en mémoire »).
- [ ] **Step 4 : e2e** : Chromium ordinateur avec faux `showSaveFilePicker` → octets identiques ; coupure du 2ᵉ segment au-delà des essais → `abort` et message ; WebKit et téléphones → événement `download`, fichier identique, nom nettoyé (`facture‮fdp.exe` sans U+202E), avertissement avant ; fichier de 300 Mo → Enregistrer seulement ; captures `save-progress`, `save-risky`.
- [ ] **Step 5 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 6 : Commit** « feat(viewers): enregistrement en flux, abandon du partiel, repli Blob » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **Anti-motif « bloquer le téléchargement présenté comme une protection ».** En droit « voir seulement », aucun Enregistrer ; la phrase de la Task R accompagne l'écran. *Contrôle* : e2e : pas de `SaveButton` ; texte « Cela n'empêche pas une capture d'écran. » visible.
- [ ] **M5, chiffres réels.** Progression en octets et vitesse mesurées, en chiffres tabulaires. *Contrôle* : e2e : `tabular-nums` ; le nombre d'octets affiché à la fin égale la taille du fichier.
- [ ] **Texte honnête sur la destruction.** Aucune formule du type « disparaît de partout » : ce qui est enregistré reste sur l'appareil, formulation à rapprocher de l'écran détruit (« Ce que vous avez déjà enregistré sur cet appareil n'est pas concerné. »). *Contrôle* : le scan de mots interdits de la Task 27 couvre les messages de `SaveButton`.

---

### Task 24 : Terminer, détruire, signaler

**Files:**
- Create: `web/src/flows/endoflife.ts`, `endoflife.test.ts`, `web/src/ui/ReportSheet.svelte`, `web/ui-e2e/endoflife.spec.ts`
- Modify: `web/src/routes/Content.svelte`

**Interfaces:** `finish(opened)` (`done()` → `wipe()` → `revokeAll()`) ; `destroyFromContent(opened, report: boolean, deps = { onDestroyed: () => void })` → `"destroyed" | "gone" | "network"` (`onDestroyed` lance la dissolution ; appelé après la résolution seulement) : `opened.destroy(report ? "report" : undefined)` puis `wipe()` ; `NotFoundError` → `wipe()` + `gone` ; `Error("reseau")` → rien d'effacé.

- [ ] **Step 1 : Tests qui échouent** : `destroy` appelé avec `"report"` pour Signaler, sans argument pour Détruire ; `wipe` après la réponse seulement ; `NotFoundError` → `gone` ; `reseau` → `network`, `wipe` non appelé ; `onDestroyed` n'est appelé qu'après la résolution de `opened.destroy` (espion : ni avant, ni en cas de `reseau`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.8 (pied) et §9.10 : Terminer et effacer, Détruire (`InlineConfirm`), Signaler (`Sheet` **sans choix de motif**, texte UI §9.10), `onPageHide` → `finish`.
- [ ] **Step 4 : e2e** : `maxOpens = 3`, Détruire → « Ce partage a été détruit », `fetchMeta` en Node → `NotFoundError` ; `maxOpens = 1` (`draining`) → Détruire fonctionne ; Signaler → détruit ; Terminer et effacer → dissolution, texte absent de la page ; captures `destroy-confirm`, `report-sheet`, `destroyed`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): fin de vie (terminer, détruire, signaler) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M10, signaler et supprimer chez le destinataire.** Boutons visibles mais secondaires, en bas, séparés du contenu par un filet ; libellé exact : « Détruire ce partage pour tout le monde » ; texte voisin : « Vous pouvez le détruire à tout moment. » Détruire passe par `InlineConfirm`. *Contrôle* : e2e : les boutons sont le dernier groupe de `Content`, précédés d'un filet (`border-top` ou `<hr>`), leur style n'est pas celui de l'action principale ; libellé exact ; aucune action sans confirmation ; atteignables au clavier à 390 px.
- [ ] **S4, le reçu de destruction.** Après la dissolution, une fiche en chasse fixe : « Effacé du serveur : le contenu chiffré et son entrée. Pas concerné : ce qui a été enregistré sur un appareil. » ; écran final : « Ce partage a été détruit. Il a été effacé du serveur. Ce que vous avez déjà enregistré sur cet appareil n'est pas concerné. » Le composant `DestroyReceipt.svelte` est aussi employé par `Manage.svelte` après « Supprimer ce partage ». *Contrôle* : e2e : le reçu n'apparaît qu'après la réponse du serveur (réponse retardée par `page.route` : absent avant) et seulement pour Détruire et Signaler, pas pour « Terminer et effacer » ; police monospace par jeton ; jamais « il n'existe plus nulle part » (scan Task 27) ; `fetchMeta` en Node renvoie `NotFoundError`.
- [ ] **M6, capsule en pointillés.** La capsule passe à l'état « détruit » (contour en pointillés). *Contrôle* : e2e : `data-state="destroyed"` sur le même élément.
- [ ] **Signalement sans choix de motif** (déjà prévu) : aucune liste de motifs ; vérifier que la feuille ne collecte rien de plus. *Contrôle* : la requête de signalement n'a pas de corps libre.

---

### Task R : Droits du destinataire (spec §34, simplifiés en §34.1)

> **5 novembre, décision du propriétaire (spec §34.1)** : un interrupteur « Autoriser le téléchargement » et une sous-option coffre remplacent `RightsPicker` ; voir les amendements après la Task M2. Les étapes ci-dessous s'appliquent avec ce changement (`RightsPicker.svelte` devient `RightsSwitch.svelte`, « Voir seulement » = interrupteur désactivé).

**Files:**
- Create: `web/src/flows/rights.ts`, `rights.test.ts`, `web/src/ui/RightsPicker.svelte`, `web/ui-e2e/rights.spec.ts`
- Modify: `web/src/routes/Options.svelte`, `web/src/routes/Content.svelte`, `web/src/viewers/*.svelte`, `web/src/ui/SaveButton.svelte`, `web/src/i18n/fr.ts`, `en.ts`

**Interfaces:** `allowedActions(rights: Rights, kind: PreviewKind)` → `{ save: boolean; copy: boolean; keep: boolean }` ; `viewOnlyBlockers(items: ComposeItem[])` → noms des éléments qui ne s'afficheraient pas (`none` ou plus de 200 Mio).

- [ ] **Step 1 : Tests qui échouent** : `allowedActions("voir", "image")` → tout faux ; `("enregistrer", …)` → `save` et `copy` ; `("coffre", …)` → les trois ; droit inconnu → comme `"voir"` (le parseur l'a déjà ramené, double garde) ; `viewOnlyBlockers` avec un `.zip` et une vidéo de 300 Mio → les deux noms. e2e : partage `"voir"` → aucun bouton Enregistrer ni Copier, `<video>` avec `controlslist="nodownload"` et `disablepictureinpicture`, mention honnête visible ; Options : « Voir seulement » désactivé avec la raison quand un `.zip` est présent ; captures `rights-picker`, `content-view-only`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §34, textes de UI §10 (révision 4).
- [ ] **Step 4 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 5 : Commit** « feat(ui): droits du destinataire (voir, enregistrer, coffre) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **Anti-motif « bloquer le téléchargement » présenté comme une protection.** Le texte « L'expéditeur a choisi « voir seulement ». Cela n'empêche pas une capture d'écran. » (spec §34) est affiché côté destinataire dans chaque visionneuse en mode « voir », et la description de « Voir seulement » dans `RightsPicker` contient la même mise en garde avant le choix. *Contrôle* : e2e : en sélectionnant « Voir seulement » la phrase est visible à côté ; en ouvrant le partage elle est visible dans chaque visionneuse ; aucune chaîne « protégé contre la copie », « sécurisé » ou « inviolable » (scan Task 27).
- [ ] **M4, même grammaire de phrase** (adapté à spec §34.1). L'interrupteur se lit comme une phrase (« Le destinataire peut **télécharger** »), sous-option en dessous. *Contrôle* : e2e : `getByRole("switch", { name: "Autoriser le téléchargement" })` ; Espace bascule ; `axe` sans violation.

---

### Task H : Historique local des envois, sans compte (spec §33)

**Files:**
- Create: `web/src/history/store.ts`, `store.test.ts`, `web/src/history/poll.ts`, `poll.test.ts`, `web/src/routes/History.svelte`, `web/ui-e2e/history.spec.ts`
- Modify: `web/src/routes/Ready.svelte` (bascule), `web/src/app/router.svelte.ts` (`/envois`), `web/src/source-rules.test.ts` (IndexedDB permis dans `history/` et `vault/` seulement), `web/src/i18n/*`

**Interfaces:**
```ts
type HistoryEntry = { id: string; manage: string /* S_gestion, chiffré au repos */; label: string; expiresAt: number; maxOpens: number;
  opens: { count: number; between: [number, number] }[]; state: "ready" | "draining" | "gone" };
openHistory(deps?: { idb?: IDBFactory; now? }) → { list(); add(e); remove(id); clear(); update(id, patch) };
  // AES-256-GCM, clé non extractible (generateKey extractable: false) gardée dans IndexedDB ; nonce aléatoire par écriture
pollHistory(h, deps = { manageStatus, now, visible: () => boolean }) → { start(); stop() };   // 60 s, écran visible seulement
HISTORY_KEEP_GONE_MS = 7 * 86_400_000;
```
- [ ] **Step 1 : Tests qui échouent** (`fake-indexeddb` refusé : pas de dépendance ; IndexedDB simulé en mémoire dans le test) : `add` puis lecture brute de la base → aucun octet de `S_gestion` ni du libellé en clair ; la clé enregistrée a `extractable === false` ; jamais de `K_lien` ni de mot de passe dans `HistoryEntry` (type et recherche de source) ; `pollHistory` : compteur 0 → 1 entre deux relectures à 21:00 et 21:01 → `between: [21:00, 21:01]` ; aucune relecture si `visible()` est faux ; `NotFoundError` → `gone` ; entrée `gone` retirée après 7 jours ; `clear()` vide tout.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §33 ; Détruire en un geste (`InlineConfirm`), `manageDestroy`, dissolution de la ligne.
- [ ] **Step 4 : e2e** : envoi → entrée « 1 élément · … » dans `/envois` ; ouverture par un autre contexte → « 1 / 1 », intervalle affiché ; Détruire → « Détruit », `fetchMeta` en Node → `NotFoundError` ; bascule désactivée sur « Lien prêt » → aucune entrée ; démo : historique en mémoire seulement (pas d'IndexedDB sur l'origine partagée) ; `axe` ; captures `history`, `history-destroy`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(history): historique local chiffré des envois, sans compte » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M11, cycle de vie lisible.** La liste réutilise `StateChip.svelte` (Task 19) : icône et mot par état (Actif, En cours d'effacement, Détruit, Expiré), couleur jamais seule, ouvertures en « 1 / 3 ». *Contrôle* : e2e : chaque état d'une entrée a un mot visible ; `axe` ; `forcedColors: "active"` laisse le mot lisible.
- [ ] **M12 et B5, état et arrêt visibles, heures honnêtes.** Chaque entrée active montre « Actif · s'efface vers 9 h 45 » (même fonction d'arrondi qu'en Task 18) et Détruire en un geste. *Contrôle* : unit : la fonction d'arrondi est partagée (un seul module) ; e2e : le texte « vers » apparaît, jamais une heure à la minute.
- [ ] **M5.** Les compteurs (« 1 / 3 ») viennent des valeurs réelles lues sur le serveur ; aucun chiffre inventé hors ligne. *Contrôle* : e2e : hors ligne, l'entrée affiche son dernier état connu avec la mention « non mis à jour » plutôt qu'un chiffre frais.

---

### Tasks A1 à A3 : compte facultatif (spec §37)

Après la Task H, qui fournit l'historique à synchroniser. Prérequis : réponses du propriétaire à Q-A1 à Q-A5 (défauts de spec §37.10 appliqués sinon) ; avis du juriste (spec §37.9) avant d'activer `SHH_ACCOUNTS=1` en public, pas avant de coder. Compte désactivé dans la démo (test). Revues : `golang-backend`, `golang-testing`, `constant-time-analysis` (comparaisons de `V_s` et des jetons de session), `supply-chain-risk-auditor` (go-webauthn), `privacy-review`.

### Task A1 : Serveur — passkeys (go-webauthn), base `accounts.db`, sessions en mémoire (spec §37.1, §37.3 à §37.5, §37.8)

**Files:**
- Create: `server/internal/account/service.go`, `service_test.go`, `server/internal/account/store.go`, `store_test.go`, `server/internal/account/session.go`, `session_test.go`, `server/internal/account/testauthn_test.go` (authentificateur logiciel de test : attestation `none`, ES256, PRF absent côté serveur), `server/internal/api/handlers_account.go`, `handlers_account_test.go`, `server/internal/account/unlinkable_test.go`
- Modify: `server/go.mod`, `go.sum` (`github.com/go-webauthn/webauthn`, **version exacte**, dernière stable publiée depuis au moins 7 jours, spec §24), `THIRD_PARTY_LICENSES.md` (BSD-3-Clause, à vérifier dans le dépôt de la version choisie), `server/internal/config/config.go` (`SHH_ACCOUNTS`, `SHH_ACCOUNTS_MAX`), `server/internal/limits/*` (compteurs de spec §9.5), `server/internal/api/headers.go` (`Permissions-Policy` : `publickey-credentials-create=(self), publickey-credentials-get=(self)` ; `()` sur `/pdf-frame.html`), test de sources de spec §36 S2 (`X-Shh-Session` ajouté à la liste blanche), `server/cmd/shhdrop/*` (nettoyeur : comptes abandonnés)

**Interfaces:**
```go
type Service struct{ /* store, sessions, webauthn.WebAuthn, limits */ }
func NewService(cfg Config, st *Store, now func() time.Time) (*Service, error) // refuse rp.id ≠ hôte de SHH_ORIGIN
func (s *Service) BeginRegistration(conn limits.Key) (options []byte, err error)           // H tiré par crypto/rand, user.name fixe
func (s *Service) FinishRegistration(body []byte) (session string, err error)              // stocke cred_id, public_key, alg, env ; v_s, env_s facultatifs
func (s *Service) BeginLogin() (options []byte, err error)                                  // allowCredentials vide
func (s *Service) FinishLogin(body []byte) (session string, env []byte, blob []byte, gen uint64, err error)
func (s *Service) Recover(aS [32]byte) (session string, envS []byte, blob []byte, gen uint64, err error)
func (s *Service) PutBlob(session string, ifGen uint64, b []byte) error                    // ErrConflict, ErrTooLarge ; palier exact exigé
func (s *Service) AddCredential / RemoveCredential / RenewRecovery / Logout / Delete
// store : accounts(h, created_month, seen_month, blob, gen, v_s, env_s), credentials(cred_id, h, public_key, alg, env) ; WITHOUT ROWID
```
- [ ] **Step 1 : Tests qui échouent** : cérémonie complète avec l'authentificateur de test (création, connexion découvrable par `userHandle`) ; défi rejoué → refus ; défi de plus de 2 min → refus ; `userVerification` absente → refus ; origine ou `rp.id` différents → refus ; après création, `accounts.db` ne contient ni AAGUID, ni compteur de signatures, ni transports, ni attestation (lecture des colonnes et recherche d'octets repères dans le fichier et le WAL) ; `created_month` et `seen_month` sont des premiers du mois à 00:00 UTC ; `PutBlob` : `if_gen` périmé → `ErrConflict`, taille hors palier ou > 1 Mio → refus, 61ᵉ écriture de l'heure → `limit` ; `Recover` avec un `A_s` faux → réponse identique à « inconnu », 11ᵉ essai de l'heure → `limit` ; comparaison de `V_s` en temps constant (`subtle.ConstantTimeCompare`) ; 4ᵉ compte du jour par connexion → `limit` ; `SHH_ACCOUNTS_MAX` atteint → 503 ; sessions : absentes du disque, perdues au redémarrage, expirées à 15 min sans usage et à 2 h ; `Delete` → lignes supprimées, `wal_checkpoint(TRUNCATE)`, aucun octet repère de `B` dans le fichier après arrêt ; nettoyeur : `seen_month` de plus de 13 mois → compte effacé ; `SHH_ACCOUNTS=0` → toutes les routes `/api/compte/*` en 404.
- [ ] **Step 2 : `unlinkable_test.go` (« le serveur ne voit rien », étendu au compte)** : un partage créé et finalisé, un compte dont `B` est un tampon opaque ; IP, User-Agent, Referer repères (spec §36) → aucun repère sur disque, stdout, stderr ni dans les réponses ; aucune valeur commune entre `accounts.db` et `shares.db` (recherche de chaque `V_accès`, `V_gestion` et identifiant de partage dans les octets de `accounts.db`) ; aucune route de partage ne lit `X-Shh-Session` (test de sources) ; aucune requête SQL ne nomme les deux bases.
- [ ] **Step 3 : Lancer** `make test-go` → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §37.1, §37.3 à §37.5, §37.8 ; JSON strict de spec §8 ; erreurs uniformes ; aucun journal qui contienne `H`, un identifiant de passkey ou un jeton.
- [ ] **Step 5 : Lancer** `make test-go` (avec `-race`, `GOARCH=386 go build ./...`), `govulncheck ./...` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(account): compte facultatif par passkey, base séparée, sessions en mémoire » et push.

### Task A2 : Client — PRF, enveloppes, coffre de compte chiffré, synchronisation différée (spec §37.2, §37.4, §37.6)

**Files:**
- Create: `web/src/account/keys.ts`, `keys.test.ts`, `web/src/account/blob.ts`, `blob.test.ts`, `web/src/account/merge.ts`, `merge.test.ts`, `web/src/account/recovery.ts`, `recovery.test.ts`, `web/src/account/session.ts`, `session.test.ts`, `web/src/account/sync.ts`, `sync.test.ts`
- Modify: `web/src/crypto/kdf.ts` (étiquettes `shhdrop/v2/compte/*`, dans le module crypto), `web/src/index.ts` (exporte `openAccount` seulement), `web/src/source-rules.test.ts` (IndexedDB permis aussi dans `account/`, pour `gen` maximal et l'enveloppe locale des appareils sans PRF ; `X-Shh-Session` posé seulement par `account/session.ts`), `web/src/history/store.ts` (source et cible de la synchronisation)

**Interfaces:**
```ts
const PRF_INPUT = sha256("shhdrop/v2/compte/prf/1");
deriveKek(prf: Uint8Array): Promise<CryptoKey>;                 // HKDF, info "shhdrop/v2/compte/enveloppe", non extractible
wrapAccountKey(kek, kCompte, h, credId) / unwrapAccountKey(...)  // AES-256-GCM, AAD "SHH-ENV1" ‖ H ‖ SHA-256(credId)
recoveryFromKey(rk) → { kekS, aS };  formatRecovery(rk): string;  parseRecovery(s): Uint8Array  // base32 Crockford, normalisation
sealBlob(kBlob, h, gen, json) / openBlob(kBlob, h, b, minGen)   // "SHH-ACCT1", paliers 4 Ki…1 Mi ; minGen : refus d'un retour en arrière
mergeBlobs(a, b): BlobJson;                                     // union par id, tombstones 7 j, gone l'emporte
openAccount(deps?: { webauthn?, fetch?, idb?, now?, random? }) → { create(opts); login(); recover(code); logout(); remove(destroyShares: boolean); addDevice(); renewRecovery(); status() };
scheduleSync(delayMs = randomBetween(120_000, 1_800_000));      // jamais immédiat après un envoi
```
- [ ] **Step 1 : Tests qui échouent** (WebAuthn simulé, avec et sans PRF ; IndexedDB en mémoire ; `fetch` intercepté) : vecteurs fixes HKDF et AES-GCM (enveloppe, coffre) recalculés par un script Node indépendant ; toutes les clés `extractable === false` ; corps de toutes les requêtes interceptées : aucun repère de libellé, de `S_gestion` ni de réglage, aucun `P_i`, `RK`, `K_compte` (recherche d'octets) ; `B` toujours à la taille exacte d'un palier ; `openBlob` avec `gen` < `minGen` → refus ; données authentifiées modifiées (`H`, `gen`) → refus ; `parseRecovery` accepte espaces, tirets, minuscules, `I`/`L`/`O`, refuse une longueur fausse ; sans PRF, création sans clé de secours → refus (Q-A1) ; PRF absente au `create` → `get` enchaîné ; 409 → relecture, fusion, réécriture `gen + 1` ; fusion : une entrée `gone` sur un appareil l'emporte, une tombstone de plus de 7 jours disparaît ; `scheduleSync` : aucune écriture dans les 2 min qui suivent un `add` d'historique (horloge simulée) ; jeton de session jamais envoyé vers `/api/shares/*` ni `/api/manage/*` ; `logout()` oublie clés, clair et copie locale ; `remove(true)` appelle `manageDestroy` pour chaque `S_gestion` avant `supprimer`.
- [ ] **Step 2 : Lancer** `npm test` → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §37.2, §37.4, §37.6 ; WebCrypto seulement (aucune dépendance nouvelle).
- [ ] **Step 4 : Lancer** `npm test` (avec `tsc`) → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(account): clés par PRF ou clé de secours, coffre de compte chiffré, synchronisation différée » et push.

### Task A3 : Écrans du compte et « le serveur ne voit rien » de bout en bout (spec §37.7)

**Files:**
- Create: `web/src/routes/Account.svelte` (`/compte`), `web/src/routes/RecoveryKey.svelte`, `web/ui-e2e/account.spec.ts`, `web/ui-e2e/account-sees-nothing.spec.ts`
- Modify: `web/src/ui/AppShell.svelte` (lien « Compte (facultatif) » du menu), `web/src/routes/History.svelte` (« Créer un compte (facultatif) », état de synchronisation), `web/src/routes/Ready.svelte` (lien texte sous la bascule), `web/src/routes/PageSecurite.svelte` (paragraphe « Le compte facultatif », limites de spec §18.18), `web/src/i18n/*` (« Aucun compte nécessaire, ni pour envoyer, ni pour recevoir. » remplace la formule de la Task V2), `web/src/app/router.svelte.ts`

- [ ] **Step 1 : Tests qui échouent** (e2e, authentificateur virtuel de Chromium par CDP `WebAuthn.addVirtualAuthenticator`, une fois avec `hasPrf: true`, une fois sans) : texte exact « Facultatif. Sans e-mail. Votre historique est chiffré : nous ne pouvons pas le lire. » suivi du lien « Ce que le compte ne protège pas » ; annulation de la passkey → retour sans erreur, aucun compte ; création avec PRF → clé de secours refusable ; sans PRF → clé de secours exigée et message de spec §37.7 ; deux contextes (deux « appareils ») avec la même passkey virtuelle : un envoi sur le premier apparaît dans `/envois` du second après la synchronisation (horloge avancée) ; récupération par la clé de secours dans un troisième contexte sans passkey ; Se déconnecter → `/envois` ne montre plus les entrées synchronisées ; Supprimer le compte (case décochée) → le partage vit encore, `GET blob` → 404 ; case cochée → partages détruits ; pages d'ouverture et de contenu : aucune mention du compte (balayage du texte) ; aucune entrée de compte sur le chemin de l'envoi hors du lien texte de « Lien prêt » ; démo → aucune entrée de compte ; `axe` ; captures `account-intro`, `account-recovery`, `account-status`.
- [ ] **Step 2 : `account-sees-nothing.spec.ts`** (SUCCÈS exigé, bloquant comme le test du Plan 1) : parcours complet (création, envoi, synchronisation, second appareil, suppression) ; repères dans les libellés, réglages et `S_gestion` ; exige : aucun repère dans le corps d'une requête ni dans `accounts.db` / WAL après arrêt ; aucune requête de partage avec `X-Shh-Session` ; aucune requête de compte avec un identifiant ou un secret de partage ; écriture de `B` jamais dans les 2 min d'un `finalize`.
- [ ] **Step 3 : Lancer** → ÉCHEC, **implémenter** spec §37.7 et les textes ci-dessus, **relancer** `make test-ui`, la démo (`npm run build:demo && node scripts/check-dist.mjs --demo && npx playwright test --project='demo-*'`) → SUCCÈS.
- [ ] **Step 4 : Liste manuelle** (fichier de décisions) : iPhone (Safari 18+, trousseau iCloud), Android (Chrome, gestionnaire Google), ordinateur avec clé de sécurité sans PRF : créer, second appareil, récupération, suppression.
- [ ] **Step 5 : Commit** « feat(account): écrans du compte facultatif, le serveur ne voit rien étendu au compte » et push.

---

### Task V1 : Coffre — clés et stockage (spec §27.2 à §27.4)

**Files:**
- Create: `web/src/vault/keys.ts`, `keys.test.ts`, `web/src/vault/store.ts`, `store.test.ts`, `web/src/vault/clock.ts`, `clock.test.ts`
- Modify: `web/src/crypto/kdf.ts` (dérivations `shhdrop/v2/coffre/*`, dans le module crypto), `web/src/index.ts` (exporte `openVault` seulement)

**Interfaces:**
```ts
type VaultMode = "prf" | "code";
createVault(mode: VaultMode, secret: { prf: () => Promise<Uint8Array> } | { code: string }) → Promise<Vault>;   // mode figé ensuite
unlockVault(v, secret) → Promise<Unlocked>;      // essais_rates incrémenté AVANT l'essai ; témoin T ; 5 échecs → wipeAll()
Unlocked: { entries(); put(pkg: ReadableStream<Uint8Array>, deadline: number, bucket: number): Promise<string>; open(id); remove(id); lock() };
sweepExpired(now = vaultNow()): Promise<number>;  // sans déverrouillage
vaultNow(): number;                              // max(Date.now(), derniere_heure_vue), enregistré
VAULT_MAX_ATTEMPTS = 5; VAULT_ENTRY_MAX = 2 ** 30; VAULT_TOTAL_MAX = 2 * 2 ** 30; VAULT_ENTRIES_MAX = 20; VAULT_IDLE_LOCK_MS = 120_000;
```
- [ ] **Step 1 : Tests qui échouent** (WebAuthn et OPFS simulés ; IndexedDB en mémoire) : `createVault("code", { code: "court" })` → refus (`checkPassword`) ; mode `prf` puis `unlockVault` avec un code → refus sans repli (V3) ; mauvais secret ×5 → tout effacé (fichiers, base, `sel_prf`) ; `NotAllowedError` de la passkey → compteur inchangé (V4) ; processus « tué » entre l'incrément et le résultat → le compteur reste incrémenté ; clés dérivées `extractable === false` ; `put` puis lecture brute OPFS et IndexedDB → aucun repère du contenu ni des noms ; échéance en clair reculée dans la base → `open` refuse (échéance authentifiée, V5) ; `vaultNow` ne recule pas quand `Date.now()` recule ; `sweepExpired` efface une entrée échue sans déverrouillage ; plafonds (21ᵉ entrée, 2 Gio dépassés) → refus avant tout téléchargement ; `lock()` oublie les clés (accès suivant → `verrouille`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §27.2 à §27.4 ; rescellement par `container.ts` (aucun format nouveau).
- [ ] **Step 4 : Lancer** `npm test` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(vault): clés du coffre (passkey PRF ou code), stockage chiffré, échéance, essais » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M14, limites du coffre à écrire.** Recenser dans `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md` les limites propres au coffre (spec §27 : appareil perdu, sauvegardes du système, copie déjà ouverte, etc.), chacune avec son renvoi de paragraphe de la spec, pour que la Task 25 les reprenne dans « Ce que Shhdrop ne peut pas faire ». *Contrôle* : le fichier contient la liste ; le test de la Task 25 vérifie que chaque limite listée figure dans la page.
- [ ] **Texte de confiance.** Aucune formule absolue sur la protection locale (« inviolable », « personne ne peut lire ») dans les messages d'erreur ou journaux produits par `vault/`. *Contrôle* : le scan de mots interdits de la Task 27 couvre les chaînes de `vault/` ; aucun message n'inclut de nom d'élément ni de clé.

### Task V2 : Coffre — écrans (spec §27.6)

**Files:**
- Create: `web/src/routes/Vault.svelte`, `web/src/routes/OpenLink.svelte` (« Ouvrir un lien reçu »), `web/src/ui/KeepButton.svelte`, `web/ui-e2e/vault.spec.ts`
- Modify: `web/src/routes/Content.svelte` (« Garder dans le coffre » si `allowedActions(...).keep` et app installée sur téléphone), `web/src/routes/Open.svelte` (note fixe), `web/src/flows/endoflife.ts` (Détruire et Signaler effacent aussi la copie), `web/src/app/env.ts` (`isInstalledPhone()` : `display-mode: standalone` et `pointer: coarse`, injectable pour les tests)

- [ ] **Step 1 : Tests qui échouent** (e2e, `isInstalledPhone` forcé par un crochet de test, authentificateur virtuel WebAuthn de Chromium par CDP `WebAuthn.addVirtualAuthenticator` avec `hasPrf: true`) : partage `"coffre"` → « Garder dans le coffre » → création par passkey → « Gardé jusqu'au … » ; `/coffre` verrouillé → Déverrouiller → entrée, compte à rebours ; Ouvrir → contenu sans réseau (`context.setOffline(true)` après le chargement) ; `page.clock` au-delà de l'échéance → dissolution et « sa copie a été effacée » ; Effacer, Vider le coffre ; partage `"enregistrer"` → aucun bouton ; navigateur (pas l'app) → note fixe avant le déverrouillage, aucun bouton ; démo → coffre absent ; `axe` ; captures `vault-locked`, `vault-list`, `vault-keep`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §27.6, textes de UI §10 (révision 4), composants de UI §20.
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(vault): garder dans le coffre, écran du coffre, comptes à rebours » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M11, état lisible.** Chaque élément du coffre affiche une icône et un mot (par exemple conservé, expire bientôt, détruit) via `StateChip.svelte`, jamais la couleur seule ; chiffres issus de l'état réel (jours restants, essais restants lus dans les constantes). *Contrôle* : e2e `vault.spec.ts` : mot visible pour chaque état ; `axe` ; `forcedColors`.
- [ ] **M6, capsule verrouillée.** L'écran du coffre reprend la capsule verrouillée de la Task 20 pour l'élément fermé. *Contrôle* : `data-state="locked"` puis `"open"`.
- [ ] **B2 et textes.** Aucune phrase de l'écran ne dit « le serveur ne voit rien » ; formules autorisées : « Sans compte. Ni pour envoyer, ni pour recevoir. » et « Le serveur ne reçoit que des données chiffrées, jamais la clé. » *Contrôle* : scan Task 27.

### Task V3 : Coffre — vérification et liste manuelle

**Files:**
- Create: `web/ui-e2e/vault-sees-nothing.spec.ts`
- Modify: `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md` (liste manuelle)

- [ ] **Step 1 : Test** : envoi `"coffre"` → garde → aucune requête supplémentaire vers le serveur pendant et après la garde (le serveur ne voit qu'une ouverture ordinaire) ; le corps de toutes les requêtes ne contient ni `rights` ni `keep` ; profil du navigateur fouillé après la garde (dossier IndexedDB et OPFS de Chromium) : aucun repère du contenu, des noms ni du texte.
- [ ] **Step 2 : Lancer** → SUCCÈS exigé.
- [ ] **Step 3 : Liste manuelle** : iPhone (Safari 18+, PWA installée, passkey iCloud), Android (Chrome, passkey Google) : garder, verrouiller en arrière-plan, déverrouiller, 5 échecs avec un code, effacement à l'échéance au relancement, coffre plein.
- [ ] **Step 4 : Commit** « test(vault): le serveur n'apprend rien du coffre, liste manuelle » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **B2, pas de « ne voit rien » dans l'interface.** « Le serveur ne voit rien » reste le nom interne du test, jamais un texte d'écran (le serveur voit l'adresse IP, les tailles, les heures). *Contrôle* : `vault-sees-nothing.spec.ts` capture le texte de tous les écrans du coffre et le passe dans la liste de motifs interdits de la Task 27.
- [ ] **Liste manuelle complétée.** Ajouter à la liste : lecture VoiceOver/TalkBack des états (mot présent), `prefers-reduced-motion` sur la capsule verrouillée, et vérification que « Garder dans le coffre » n'est jamais présenté comme une protection contre la capture d'écran. *Contrôle* : lignes présentes dans le fichier de décisions.

---

### Task 25 : Pages Sécurité et Confidentialité, 404

**Files:**
- Create: `web/src/routes/PageSecurite.svelte`, `PageConfidentialite.svelte`, `web/src/i18n/pages.fr.ts`, `pages.en.ts`, `web/ui-e2e/pages.spec.ts`

- [ ] **Step 1 : e2e qui échoue** : `/securite` contient les limites de la spec §18 (une par élément de liste), ni « 100 % » ni « sécurisé à » ; `/confidentialite` contient « aucun cookie », la liste de la spec §9 et la section `#verification` (« Google voit votre adresse IP », « jamais votre adresse IP » côté serveur) ; route inconnue → « Cette page n'existe pas » ; mesure ≤ 75 ch ; `axe`. Démo : la page Sécurité affiche en plus le tableau des écarts de UI §14.3 (chaîne lue par `getDemo()?.securityGaps`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.12, textes relus sur la spec.
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(ui): pages sécurité, confidentialité, 404 » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M13, expliquer le `#` avec un exemple.** Section « Comment fonctionne le lien » : lien d'exemple fixe de la forme réelle (Task K2), dont la partie après `#` est surlignée par un `<mark>` avec légende : « Cette partie reste dans votre navigateur : elle n'est jamais envoyée au serveur. » Texte long : « La clé est dans la fin du lien, après le signe `#`. Les navigateurs n'envoient jamais cette partie au serveur. Sans elle, ce que nous stockons est illisible, pour nous aussi. » Aucun nom d'algorithme. *Contrôle* : e2e `pages.spec.ts` : l'exemple n'est pas un `<a>` et n'a pas d'`href` ; le texte du `<mark>` égale exactement ce qui suit le premier `#` de l'exemple ; la valeur est une constante marquée « exemple », jamais produite par le générateur de clés ; le surlignage n'est pas porté par la couleur seule (soulignement ou contour, visible avec `forcedColors: "active"`) ; `axe` sans violation.
- [ ] **M14, ce que Shhdrop ne peut pas faire.** Bloc d'ancre `#limites` en langage simple, repris de spec §18 : « Nous ne pouvons pas empêcher une capture d'écran. Le serveur voit l'adresse IP de connexion. Si le site lui-même était piégé, il pourrait voler les clés : c'est pour cela que chaque version est vérifiable. » plus les limites du coffre (Task V1). Lien « Ce que Shhdrop ne peut pas faire → » depuis l'accueil (modifier `Home.svelte`). *Contrôle* : e2e : le lien de l'accueil amène au bloc et le focus y arrive ; chaque limite listée dans le fichier de décisions (spec §18 et coffre) a une phrase correspondante.
- [ ] **B1, exception reCAPTCHA.** Texte « Pas de traçage » : « Aucun traceur, aucune mesure d'audience, aucune publicité. » et, en long, la phrase de la Task 14 avec l'exception Google. Ajouter la ligne sur l'adresse IP : « Votre adresse IP n'est pas enregistrée. » avec le long « Le serveur voit votre adresse IP le temps de la connexion, comme tout site web, mais ne l'écrit nulle part. Elle sert seulement, en mémoire, à limiter les abus. » (et « Google verra votre adresse IP » si le propriétaire valide la Task 16). *Contrôle* : `i18n.test.ts` : le motif « aucun tiers » exige « Google » ou « reCAPTCHA » dans `pages.fr.ts`, `pages.en.ts`.
- [ ] **B3, aucune allégation d'audit ni de pays d'hébergement avant qu'elles soient vraies.** *Contrôle* : `pages.test.ts` : constantes `AUDITS = []` et `HOSTING_COUNTRY = null` ; tant qu'elles sont vides, le scan échoue sur `/audit/i`, « Suisse », « Islande », « Switzerland », « Iceland » ; le jour du choix (spec §15.1), le pays est ajouté à la page Confidentialité et la constante renseignée.
- [ ] **M5.** Les chiffres de la page (24 h au plus, 10 au plus, 5 essais, 1 Go) viennent des constantes, pas du texte. *Contrôle* : changer une constante change la page (test unitaire).
- [ ] **Anti-motifs : cookies, domaine, noms de fichiers.** Phrase « Pas de cookie de mesure, donc pas de bandeau. » ; « Sans compte. Ni pour envoyer, ni pour recevoir. » ; « Même les noms de vos fichiers sont chiffrés. » ; le seul domaine de Shhdrop est écrit en clair (`location.host`), les liens ne sont jamais raccourcis par un service tiers. *Contrôle* : e2e : aucun `role="dialog"` au chargement, `context.cookies()` vide après navigation ; le texte contient `location.host`.
- [ ] **M15, preuves vérifiables.** Pied de page : « Code public » (dépôt) et « Vérifier cette version » (cible livrée en Task C3) ; pas de compteur d'étoiles chargé depuis GitHub. Texte : « Code public. Chaque version peut être vérifiée. » seulement quand C1 à C3 sont livrées. Aucune formule « Audité ». *Contrôle* : e2e : aucune requête vers `api.github.com` ni `shields.io` ; les liens externes ont `rel="noopener noreferrer"`.
- [ ] **Conditions.** Si le propriétaire fournit le texte (voir Task 13), ajouter la section « Conditions » à `PageConfidentialite.svelte` avec ancre ; sinon ne rien afficher. *Contrôle* : l'ancre existe si et seulement si la ligne de la Task 13 existe.

---

### Task 26 : PWA (manifeste, icônes, sans service worker)

**Files:**
- Create: `web/public/manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `web/scripts/gen-icons.mjs`, `web/ui-e2e/pwa.spec.ts`
- Modify: `web/index.html`

- [ ] **Step 1 : e2e qui échoue** : manifeste conforme à UI §14.1 (`start_url` et `scope` valent `"./"` dans les deux builds, production et démo) ; icônes à la bonne taille ; aucun service worker ; aucune balise `og:*` ; **une seule** `theme-color` (`#0B0D12`) ; `robots.txt`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** (icône capsule au contour ouvert, PNG par `gen-icons.mjs` commités).
- [ ] **Step 4 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 5 : Commit** « feat(pwa): manifeste et icônes, sans service worker » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M7, la marque est l'illustration.** Icône : capsule dont le contour a une ouverture de 60°, constante unique `OPENING_DEG = 60` partagée par `gen-icons.mjs` et le composant de logo. Aucune image tierce ni photo. *Contrôle* : `pwa.spec.ts` et test de `gen-icons` : l'écart angulaire calculé sur le tracé de `icon.svg` vaut 60° ± 1° ; `icon.svg` n'a ni `<image>`, ni `href` externe, ni attribut `style` ; l'icône maskable garde la capsule dans la zone sûre.
- [ ] **Anti-motifs « offre » et textes.** Aucun encart d'installation promotionnel : aucun écouteur `beforeinstallprompt` qui affiche une bannière. Le manifeste n'a aucune URL externe et sa description ne contient aucune allégation d'audit ni de pays (B3). *Contrôle* : `source-rules.test.ts` interdit la chaîne `beforeinstallprompt` dans une bannière ; test du manifeste : champs relatifs, description sans mots interdits.

---

### Task 27 : Parcours complets, « le serveur ne voit rien » côté navigateur

**Files:**
- Create: `web/ui-e2e/full.spec.ts`, `web/ui-e2e/sees-nothing-ui.spec.ts`
- Modify: `web/ui-e2e/fixtures.ts`

- [ ] **Step 1 : Tests qui échouent.**
  - `full.spec.ts`, quatre projets, mouvement normal et réduit : expéditeur (dépôt d'une photo, collage d'un texte, PDF, réordonnancement, renommage, options par défaut 12 h / 1, envoi avec une pause, lien prêt, copies) → destinataire dans un **autre contexte** (mauvais mot de passe une fois, déverrouillage, lecture de chaque élément dans l'ordre de l'envoi, enregistrement, Terminer et effacer) → gestion (« Supprimé », car 1 ouverture). `axe` à chaque écran.
  - Étape vocale (vocal simulé, faux micro) : projets Chromium seulement ; WebKit est en `fixme` (Task 12).
  - Clavier seul (Chromium ordinateur) : parcours expéditeur complet, réordonnancement par Alt + flèches compris.
  - 320 px, police racine 24 px, paysage 844 × 390 : aucun débordement horizontal sur chaque écran.
  - `forced-colors: active` (Chromium) : captures de chaque écran, focus visible.
  - `sees-nothing-ui.spec.ts` : repères dans un texte, un nom de fichier (« ReperNomUI.txt », renommé « ReperRenomUI »), un mot de passe personnel ; aucune requête ni réponse capturée ne contient de repère ni la `K_lien` ; puis contrôle du Plan 1 (`web/e2e/scan.ts`) sur les données et journaux du serveur.
  - Démo : le même parcours expéditeur → destinataire dans le même onglet par « Ouvrir comme destinataire (démo) ».
- [ ] **Step 2 : Lancer** → corriger dans la tâche concernée (commit séparé par correction).
- [ ] **Step 3 : Lancer** `make test && make test-ui` + commande démo → SUCCÈS ; joindre le nombre de tests et la liste des captures.
- [ ] **Step 4 : Commit** « test(ui): parcours complets, garde « le serveur ne voit rien » dans le navigateur » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **Scan des textes de confiance sur tous les écrans.** Fichier partagé `web/src/i18n/trust-copy.ts` (liste de motifs interdits, utilisée par `i18n.test.ts` et par ces parcours) : `/100\s?%/`, « inviolable », « impossible à pirater », « ne voit rien », « militaire », « personne, nous compris », « anonyme », « audité » (sauf `AUDITS` non vide, Task 25), « aucun tiers » sans mention de Google, « il n'existe plus nulle part », « disparaît de partout », noms d'algorithmes et tailles de clé. *Contrôle* : `full.spec.ts` récupère `innerText` de chaque écran traversé (accueil, scellement, lien prêt, gestion, ouverture, contenu, détruit, coffre, pages) et échoue sur toute correspondance ; un test négatif prouve que le scan détecte une chaîne piégée.
- [ ] **M3, M9, M6, signatures S1 à S5 dans le parcours.** Le parcours complet vérifie : coches dans l'ordre (M3, avec envoi anticipé) ; phrase d'avertissement avant ouverture et compteur inchangé au rechargement (M9) ; `data-state` de la capsule : `sealing` → `sealed` → `locked` → `open` → `destroyed` (M6) ; fiche du serveur sans nom, sans texte, sans clé (S1) ; deux cartes séparées et mode dictée (S2, S5) ; contour de temps mis à jour à la minute (S3) ; reçu de destruction après la réponse (S4). *Contrôle* : les assertions sont dans `full.spec.ts` ; chaque motif a au moins une assertion nommée par son numéro dans le titre du test.
- [ ] **Aucune ressource tierce.** Journal de toutes les requêtes du parcours : une seule origine, sauf après clic sur « Continuer avec Google » dans le test du repli (B1). *Contrôle* : `sees-nothing-ui.spec.ts` échoue sur toute autre origine ; le cas « vocal » (Task 12) et le cas « fiche du serveur » (Task 19) sont ajoutés au test « le serveur ne voit rien ».

---

### Tasks C1 à C4 : code vérifiable (spec §28)

**Placées ici, après la Task 27 et avant la Task 28**, pour trois raisons : la reproductibilité se prouve sur le bundle final du Plan 2 ; SRI change `index.html` et doit passer sous la garde CSP des parcours complets ; la page « Vérifier cette version » est un écran que le contrôle visuel de la Task 28 doit couvrir. Ce qui touche le serveur de production (vérification dans `deploy.sh`, surveillance externe, étiquettes protégées, TLS hybride) va au Plan 3 (spec §28.7, §30).

### Task C1 : Builds reproductibles et manifeste de version

**Files:**
- Create: `.node-version`, `web/scripts/release-manifest.mjs`, `release-manifest.test.ts`, `web/verif/config.prod.js`, `releases/web/.gitkeep`, `.github/workflows/release.yml`
- Modify: `.github/workflows/ci.yml` (job `repro`), `Makefile` (`release-manifest`, `repro`), `web/vite.verif.config.ts` (lit `config.prod.js`)

- [ ] **Step 1 : Tests qui échouent** : `release-manifest.mjs` sur un dossier factice → `release.json` aux clés ordonnées, fichiers triés par octets, LF final, `SHA256SUMS` lisible par `sha256sum -c` ; deux exécutions → octets identiques ; un fichier caché ou un lien symbolique → échec.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §28.1 et §28.2. `make repro` : deux builds dans `/tmp/shh-a` et `/tmp/shh-b/x/y`, `TZ`, `LANG`, `umask` et `SOURCE_DATE_EPOCH` fixés, comparaison des `SHA256SUMS` de `dist/`, `dist-verif/`, `dist-demo/`. CI : job `repro` sur deux runners, obligatoire. `release.yml` (étiquette `web-v*`) : reconstruction, égalité avec `releases/web/<version>.json`, `cosign sign-blob` sans clé (`sigstore/cosign-installer` épinglé par empreinte), Release avec archive déterministe ; `id-token: write` et `contents: write` dans ce seul job.
- [ ] **Step 4 : Lancer** `make repro` (identique deux fois de suite) et `npm test` → SUCCÈS ; si une différence apparaît, la corriger à sa source, jamais l'exclure de la comparaison.
- [ ] **Step 5 : Commit** « build: builds reproductibles, manifeste de version, workflow de signature » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M15, « chaque version publiée est signée » doit être vrai.** La phrase de confiance « Code public. Chaque version peut être vérifiée. » et le texte long (« Chaque version publiée est signée, et n'importe qui peut vérifier que le site sert exactement ce code ») ne sont publiés qu'une fois `release.yml` produisant le manifeste et sa signature. *Contrôle* : le job de publication échoue sans fichier de signature ; le test de la Task 25 n'affiche la phrase que si `releases/web/<version>` existe.
- [ ] **B3.** Le manifeste de version ne contient aucune allégation d'audit ni de pays. *Contrôle* : `release-manifest.test.ts` : champs autorisés listés, aucun champ libre.

### Task C2 : SRI et absence d'import dynamique

**Files:**
- Create: `web/scripts/vite-sri.ts`, `vite-sri.test.ts`
- Modify: `web/vite.config.ts`, `vite.pdf-frame.config.ts`, `vite.verif.config.ts`, `web/scripts/check-dist.mjs`, `check-dist.test.ts`, `web/src/ui/QrCode.svelte` (import statique)

- [ ] **Step 1 : Tests qui échouent** : `index.html` construit → chaque `<script type="module">`, `<link rel="stylesheet">` et `<link rel="modulepreload">` porte `integrity="sha384-…"` égal au SHA-384 du fichier ; `check-dist.mjs` échoue sur une balise sans `integrity` et sur un `import(` dans `dist/assets/*.js` ; e2e : un octet modifié dans un JS servi → script refusé par le navigateur (événement `error`), et aucune violation CSP dans le parcours normal.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §28.3.
- [ ] **Step 4 : Lancer** `npm test && npm run build && node scripts/check-dist.mjs && make test-ui` → SUCCÈS.
- [ ] **Step 5 : Commit** « build: SRI sur scripts et styles, pas d'import dynamique en production » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **Aucune ressource tierce dans l'application, exception isolée (B1).** La chaîne « recaptcha » n'apparaît que dans `dist-verif/`, jamais dans `dist/`. *Contrôle* : `check-dist.mjs` : échec si `dist/` contient `recaptcha`, `gstatic` ou `google.com` ; seule URL absolue autorisée dans l'application : l'origine de vérification lue de la configuration.
- [ ] **Texte de confiance.** « Ce site ne charge rien depuis un autre site » n'est vrai que si SRI et absence d'import dynamique externe sont vérifiés. *Contrôle* : le test de la Task 25 renvoie à ce contrôle en commentaire.

### Task C3 : Vérificateur, page « Vérifier cette version », documentation technique publique

**Files:**
- Create: `web/scripts/verify-site.mjs`, `verify-site.test.ts`, `web/src/routes/Verify.svelte`, `web/ui-e2e/verify.spec.ts`, `docs/securite-technique.md`, `docs/verifier.md`
- Modify: `web/src/app/router.svelte.ts` (`/verifier`), `web/src/routes/PageSecurite.svelte` (liens), `web/src/i18n/*`

- [ ] **Step 1 : Tests qui échouent** : `verify-site.mjs` contre un serveur de test qui sert `dist/` → code 0 ; un octet modifié, un fichier absent, une erreur réseau, `/x` qui ne rend pas `index.html` → code non nul et message nommant le fichier ; e2e `/verifier` : version et commit affichés, phrase « Cette page ne peut pas prouver sa propre intégrité », aucune empreinte affichée, lien vers la Release ; la règle des mots interdits de UI §20.8 passe (les termes techniques vivent dans `docs/securite-technique.md`, pas dans les dictionnaires).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §28.4 ; `docs/securite-technique.md` : modèle de spec §2, §29, §30, §31 en langage technique ; `docs/verifier.md` : mode d'emploi `cosign` puis `verify-site.mjs`.
- [ ] **Step 4 : Lancer** → SUCCÈS (démo comprise).
- [ ] **Step 5 : Commit** « feat(verify): vérificateur, page Vérifier cette version, documentation technique publique » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M15, preuves vérifiables plutôt que badges.** Page « Vérifier cette version » : « Le code est public. Chaque version publiée est signée, et n'importe qui peut vérifier que le site sert exactement ce code, avec un outil qui ne vient pas de ce site. » ; liens du pied de page « Code public » et « Vérifier cette version ». Pas de compteur d'étoiles chargé depuis un tiers. *Contrôle* : e2e `verifier.spec.ts` : les deux liens existent dans le pied de chaque page ; aucune requête vers `api.github.com` ni `shields.io` ; la page ne contient ni « audité » ni badge.
- [ ] **M14.** La page renvoie à `#limites` (Task 25) : « Ce que Shhdrop ne peut pas faire → ». *Contrôle* : le lien aboutit au bloc.
- [ ] **Texte juste sur la vérification.** Le document technique (`docs/securite-technique.md`) est le seul endroit des noms d'algorithmes (interdits à l'écran). *Contrôle* : le scan de la Task 27 passe sur les pages ; le document peut les nommer.

### Task C4 : Service worker minimal d'épinglage (conditionnelle : seulement si Q-C1 est acceptée)

**Files:**
- Create: `web/src/sw/sw.ts`, `sw.test.ts`, `web/scripts/vite-sw.ts` (embarque le manifeste dans `sw.js`), `web/ui-e2e/sw.spec.ts`
- Modify: `web/src/main.ts` (enregistrement hors démo), `web/src/vault/*` (verrou sur `controllerchange`), `web/scripts/check-dist.mjs`, `server/cmd/shhdrop/static.go` (`sw.js` sans `Service-Worker-Allowed`, `Cache-Control: no-cache`)

- [ ] **Step 1 : Tests qui échouent** : `sw.ts` fait moins de 150 lignes et n'importe rien ; installation : un fichier dont l'empreinte diffère → installation en échec, rien en cache ; `/api/*` jamais intercepté ; requête hors manifeste → réseau, jamais mise en cache ; aucun `skipWaiting` ni `clients.claim` (recherche de source) ; e2e : après une première visite, `context.setOffline(true)` → l'application et le coffre démarrent ; un JS modifié sur le serveur sans changement de `sw.js` → la version en cache est servie et l'avertissement s'affiche ; nouveau `sw.js` → « Nouvelle version {x} : vérifier » ; `controllerchange` → coffre verrouillé ; démo : aucun service worker.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §28.6. Mettre à jour spec §10 et UI §14.1 (règle « pas de service worker » remplacée) dans le même commit.
- [ ] **Step 4 : Lancer** `make test && make test-ui` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(pwa): service worker minimal d'épinglage (hors ligne pour le coffre) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **Honnêteté sur ce que l'épinglage change.** Si Q-C1 est acceptée, la phrase « Si le site lui-même était piégé, il pourrait voler les clés : c'est pour cela que chaque version est vérifiable » (Task 25) reste exacte et ne devient pas « impossible » ; aucune page ne dit « fonctionne hors ligne » au-delà du coffre. *Contrôle* : test de textes : les mots « hors ligne » n'apparaissent que dans le contexte du coffre ; le service worker ne met en cache aucune ressource d'une autre origine (test de portée).

---

### Task 28 : Contrôle visuel (impeccable) et DESIGN.md

**Files:**
- Create: `DESIGN.md`, `docs/superpowers/plans/2026-11-04-shhdrop-ecrans-decisions.md` (si absent)
- Modify: fichiers d'interface selon les constats

- [ ] **Step 1 : Détecteur** : via la compétence `impeccable` (sous-commande `detect --json`) sur `web/src/ui web/src/routes web/src/viewers web/index.html` ; ne pas écrire de chemin propre à la machine ; si l'outil manque, le consigner dans le fichier de décisions sans bloquer ; corriger les constats mécaniques ; consigner les autres.
- [ ] **Step 2 : Critique sur rendu** (`critique` d'impeccable sur la démo publiée et sur les captures de la Task 27) : rescorer les heuristiques de UI §18.1 sur le rendu réel ; *craft floor* (contrastes, ombres décalées, espacements, mesure, un seul moment par geste, états complets, surfaces du navigateur thémées, textes dans la langue du produit, couverture de chaque exigence de UI §9) ; interdits (étiquette au-dessus des titres, texte en dégradé, bord gauche épais, verre décoratif, emoji, halo sans décalage).
- [ ] **Step 3 : Corriger**, relancer `make test-ui` et la démo, refaire les captures (dernier passage).
- [ ] **Step 4 : DESIGN.md** : jetons et règles tels que construits ; écarts avec UI §3–§8 signalés au propriétaire.
- [ ] **Step 5 : Liste de vérification manuelle** (spec §14) dans le fichier de décisions : iPhone et Android réels — photo (orientation), vocal croisé, vidéo d'iPhone sur Android, PDF, dépôt et collage, réordonnancement avec VoiceOver et TalkBack (mode déplacement), coupure réseau et passage en arrière-plan pendant l'envoi, pause, annulation, mauvais mot de passe, expiration, destruction, installation PWA, aucun gestionnaire de mots de passe qui propose d'enregistrer, navigateur intégré d'Instagram, repli reCAPTCHA, démo sur `skoow.github.io/Shhdrop`.
- [ ] **Step 6 : Commit** « docs(ui): DESIGN.md, contrôle visuel, liste manuelle » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M7 et M8, matière de la lumière.** Aurore de luminance ≤ 0,050 derrière le texte (mesurée), grain fixe à 0,035, couches retirées en `prefers-contrast: more` et en `forced-colors`. *Contrôle* : e2e avec `contrast: "more"` et `forcedColors: "active"` : `background-image: none` sur les couches décoratives ; mesure de luminance consignée dans `DESIGN.md` ; aucune ressource d'image tierce, aucun `style=""` dans `dist` (`check-dist.mjs`).
- [ ] **M16 et B4, pause de l'ambiance.** Bouton discret « Mettre l'ambiance en pause » (icône avec nom accessible) qui arrête l'aurore et la lumière du réceptacle ; choix gardé en `localStorage` dans un `try`. **À valider par le propriétaire (B4)** ; si refusé, documenter dans `DESIGN.md` pourquoi l'ambiance est exemptée de WCAG 2.2.2 (mouvement non essentiel, très lent). *Contrôle* : e2e : pause activée → `document.getAnimations()` ne contient aucune animation `running` sur l'accueil, état conservé après rechargement ; `localStorage` qui lève une exception → la page fonctionne ; `reducedMotion` → arrêtée d'office.
- [ ] **M17, sobriété.** Une seule couleur d'accent (menthe) réservée à « scellé, actif, sûr » ; aucun texte en dégradé. *Contrôle* : `grep -rn "background-clip: text\|text-fill-color: transparent" web/src` ne renvoie rien ; la liste des usages du jeton d'accent est relue et consignée dans `DESIGN.md`.
- [ ] **Balayage des anti-motifs.** Aucun bandeau de cookies, aucune offre, aucune publicité, aucun fond saturé, aucune animation sans pause ; tout `button[disabled]` rencontré dans les parcours a une raison visible et reliée. *Contrôle* : balayage Playwright des écrans de la Task 27 ; sortie jointe aux captures.
- [ ] **Accueil : sous-titre, B2, motif 2.** Titre conservé « Un lien, un mot de passe, puis plus rien. » ; sous-titre proposé : « Textes, photos, vidéos, vocaux, documents. Chiffrés sur votre appareil ; le serveur ne reçoit jamais la clé. » ; volet chiffré décoratif immobile en mouvement réduit (M2, Task 17). **B2 (faible)** : le libellé du schéma « Serveur — ne lit rien » peut se lire « ne voit rien » ; proposer « ne peut pas lire » ou « reçoit du chiffré », à trancher par le propriétaire avec UI §9.1, `fr.ts`, `en.ts` et tests. *Contrôle* : décision consignée dans le fichier de décisions ; capture de l'accueil.
- [ ] **B3 sur le build.** *Contrôle* : `grep -rniE "\baudit|suisse|islande|switzerland|iceland" web/dist` est vide tant que `AUDITS` et `HOSTING_COUNTRY` (Task 25) sont vides.
- [ ] **Annexe du plan.** *Contrôle* : `grep -c "Apports de l'étude des concurrents\*\*" docs/superpowers/plans/2026-11-04-shhdrop-ecrans.md` renvoie 31 (une par tâche listée) et l'annexe contient 18 lignes de motifs et 5 lignes de signatures.

---

### Tasks P1 à P3 : offre payante facultative (spec §38) — **après la mise en ligne de la V1**

**Bloquées** tant que le propriétaire n'a pas tranché Q-P1 (moyen de paiement), Q-P2 (exception crypto pour Privacy Pass), Q-P5 (statut juridique), et que le juriste et le comptable n'ont pas validé spec §38.5. La fonction « Demander des fichiers » (Q-P6) exige d'abord sa propre section de spec. Ces tâches ne font pas partie du Plan 2 livrable ; elles sont écrites ici pour que le reste du code ne les rende pas impossibles (aucune dépendance de V1 sur elles). Revues : `golang-backend`, `constant-time-analysis`, `supply-chain-risk-auditor` (circl, blindrsa-ts), `privacy-review`, `sharp-edges`.

### Task P1 : Droit d'usage — pass, webhook du vendeur, jetons Privacy Pass (spec §38.4)

**Files:**
- Create: `server/internal/pass/store.go` (`passes.db` : `passes(q, valid_until_day, tokens_left)`, `spent(token_hash)`), `store_test.go`, `server/internal/pass/issuer.go`, `issuer_test.go` (RFC 9474 et 9578 par `github.com/cloudflare/circl/blindsign/blindrsa`), `server/internal/pass/webhook.go`, `webhook_test.go` (signature du vendeur choisi, rejouage refusé), `web/src/premium/pass.ts`, `pass.test.ts`, `web/src/premium/tokens.ts`, `tokens.test.ts` (`@cloudflare/blindrsa-ts`, ou la variante minimale si Q-P2 est refusée)
- Modify: `go.mod`, `package.json` (versions exactes, ≥ 7 jours, spec §24), `THIRD_PARTY_LICENSES.md`, `CLAUDE.md` **seulement si le propriétaire valide l'exception Q-P2** (commit séparé, de sa main ou sur son accord écrit), `web/src/source-rules.test.ts` (`premium/` seul à manipuler `P` et les jetons)

- [ ] **Step 1 : Tests qui échouent** : vecteurs de test officiels des RFC 9474 (annexe) et 9578 passent côté Go et côté navigateur ; un jeton émis puis présenté → accepté une fois, refusé la seconde (`spent`) ; jeton d'une clé d'époque expirée → refus ; deux jetons d'un même pass présentés : le serveur ne peut pas les relier (aucune donnée de pass dans `spent` ni dans `shares.db`, recherche d'octets) ; webhook non signé, rejoué ou de montant inconnu → refus ; remboursement → ligne supprimée ; `tokens_left` épuisé → refus d'émission ; aucune référence de commande, aucun e-mail, aucune adresse dans `passes.db` ; la clé publique d'émission apparaît dans le manifeste de version signé (Task C1) ; « le serveur ne voit rien » : `P` jamais dans une requête de partage, `Q` jamais dans `shares.db` ni `accounts.db`.
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter** spec §38.4. **Step 4 : Lancer** `make test-go`, `npm test`, `govulncheck`, `npm audit` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(premium): pass prépayé et jetons aveugles Privacy Pass » et push.

### Task P2 : Limites Plus côté serveur (spec §38.2, §38.6)

**Files:**
- Modify: `server/internal/share/*` (paliers 2 et 5 Gio, + morceau du manifeste ; durées 2, 3, 7 j et 30 j jusqu'à 1 Gio ; ouvertures jusqu'à 50 sous taille × ouvertures ≤ 100 Gio ; échéance personnalisée arrondie au quart d'heure), `server/internal/limits/*` (octets Plus du jour, spec §9.5), `server/internal/config/config.go` (`SHH_STORAGE_PLUS_MAX`), `web/src/crypto/container.ts` (paliers Plus, palier canonique toujours vérifié), tests associés

- [ ] **Step 1 : Tests qui échouent** : sans jeton, toute valeur hors limites gratuites → 400 identique à aujourd'hui ; avec jeton valide : 5 Gio et 7 j acceptés, 5 Gio et 30 j refusés, 5 Gio et 21 ouvertures refusés ; réserve Plus pleine → 503 « busy » sans toucher à la réserve gratuite ; quota Plus par connexion et par /48 ; budget de lecture de spec §24 inchangé (2 × le palier) ; palier canonique côté client pour 2 et 5 Gio ; aucune colonne nouvelle dans `shares` qui porte le jeton ou le pass ; « le serveur ne voit rien » vert avec un partage Plus.
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter.** **Step 4 : Lancer** → SUCCÈS. **Step 5 : Commit** « feat(premium): limites Plus, réserve de stockage séparée » et push.

### Task P3 : Écrans — page `/offre`, achat, pass, limites atteintes (spec §38.1, §38.2)

**Files:**
- Create: `web/src/routes/Offer.svelte` (`/offre`), `web/src/routes/PassKey.svelte` (affichage unique de `P`, Copier, Télécharger, Ranger dans mon compte), `web/src/routes/PageCGV.svelte`, `web/ui-e2e/offer.spec.ts`
- Modify: `web/src/routes/Compose.svelte` et `Options.svelte` (choix Plus visibles seulement avec un pass ; ligne neutre « Au-delà de 1 Go : offre Plus, facultative » à la limite), `web/src/ui/AppShell.svelte` (lien de pied de page « Offre Plus »), `web/src/routes/PageConfidentialite.svelte` (vendeur officiel, ce qu'il voit), `web/src/i18n/*`

- [ ] **Step 1 : Tests qui échouent** (e2e, faux vendeur en mémoire) : tableau gratuit / Plus de spec §38.2 affiché tel quel, prix TTC, durée et « rien n'est prélevé à la fin » ; case de renoncement à la rétractation **non cochée** par défaut et obligatoire pour l'usage immédiat ; aucun compte à rebours, prix barré, case précochée ni mot de rareté (balayage de motifs interdits) ; pages d'ouverture, de contenu et du coffre : aucune mention de l'offre (balayage du texte) ; la Task 28 (« aucune offre ») reste vraie partout sauf `/offre`, le lien de pied de page et la ligne de limite, exceptions listées dans le fichier de décisions ; aucune ressource du vendeur chargée sur une page qui détient des clés : le paiement se fait par redirection vers le site du vendeur, depuis `/offre` seulement (aucune clé en mémoire sur cette page, test) ; `axe` ; captures `offer`, `pass-key`.
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter**, textes relus par le juriste (CGV, rétractation, médiateur). **Step 4 : Lancer** `make test-ui` et la démo (offre absente de la démo) → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(premium): page Offre Plus, pass, CGV » et push.

---

## Annexe : apports de l'étude des concurrents, par motif et par tâche

Source : `docs/superpowers/design/benchmark-2026-11.md`. Chaque ligne renvoie à la tâche dont le bloc « Apports de l'étude des concurrents » porte le motif, avec un contrôle. Les motifs qui touchent aussi l'accueil (Task 7, Task DA) sont repris par la Task 10 (composeur, ligne de preuves) et la Task 28 (contrôle visuel).

### Les 18 motifs

| # | Motif | Tâche(s) | Contrôle principal |
|---|---|---|---|
| 1 | L'outil est l'accroche, sans barrière de conditions | 10, 11, 12, 13 | Rangée d'ajout dans la fenêtre à 390 × 844 ; aucune case avant l'ajout |
| 2 | Montrer ce que reçoit le serveur (volet décoratif) | 17, 28 | Générateur à graine fixe, jamais un tampon réel ; statique en mouvement réduit |
| 3 | Coches d'état successives après progrès réel | 14, 17, K3, 27 | « Envoyé » absent avant l'accusé du dernier segment, « Scellé » avant `finalize` |
| 4 | Options écrites comme une phrase | 13, R | Contrôles segmentés natifs ; pluriel testé |
| 5 | Chiffres concrets plutôt qu'adjectifs | 10, 17, 23, 25, H, K1 | Chiffres lus dans les constantes ; `tabular-nums` |
| 6 | Un objet unique qui traverse le parcours (capsule) | 17, 18, 20, 21, 24, V2, 27 | `data-state` de la capsule : `sealing`, `sealed`, `locked`, `open`, `destroyed` |
| 7 | La marque est l'illustration | 26, 28 | Ouverture de 60°, aucune image tierce, aucun `style=""` |
| 8 | Lumière qui a de la matière (grain) | 28 | Luminance ≤ 0,050 ; retirée en contraste renforcé et couleurs forcées |
| 9 | Le geste irréversible annoncé avant | 20, K3, 27 | Phrase avant ouverture ; compteur inchangé au rechargement |
| 10 | Signaler et supprimer chez le destinataire | 24 | Libellé « Détruire ce partage pour tout le monde », filet, style secondaire |
| 11 | Cycle de vie lisible d'un coup d'œil | 19, H, V2 | Icône et mot par état, `forcedColors` |
| 12 | État « en cours » et arrêt toujours visibles | 17, 18, 19, H | Pastille « Actif · s'efface vers 9 h 45 » ; bouton dans la fenêtre |
| 13 | Expliquer le `#` avec un exemple | 25, K2 | `<mark>` = ce qui suit le premier `#` ; exemple non cliquable |
| 14 | L'aveu des limites | 25, V1, C3, C4 | Bloc `#limites` ; lien depuis l'accueil |
| 15 | Preuves vérifiables plutôt que badges | 25, C1, C3 | Pas de compteur tiers ; phrase publiée seulement si la signature existe |
| 16 | Pause visible sur l'animation d'accroche | 28 | Aucune animation `running` après pause ; à valider (B4) |
| 17 | Grande typographie retenue, peu de couleurs | 28 | Aucun `background-clip: text` ; usages de l'accent consignés |
| 18 | Lien prêt hiérarchisé en deux cartes | 18 | Ordre lien, rappel, mot de passe ; Copier lit l'état |

### Les 5 idées signature

| # | Idée | Tâche | Contrôle principal |
|---|---|---|---|
| S1 | La vue du serveur | 19 (et 27) | `serverCard(status)` pure ; absente en `uploading` ; aucune donnée du contenu |
| S2 | Deux chemins pour deux secrets | 18 | Éventail de 640 ms ; deux groupes nommés |
| S3 | Le temps qui reste, dessiné | 20 (branché en 19) | Tracé `pathLength="100"`, mise à jour à la minute, aucune boucle d'animation |
| S4 | Le reçu de destruction | 24 (repris par 19) | Affiché après la réponse du serveur seulement |
| S5 | Le mode dictée | 18 | Étiquette non vide pour chaque caractère de `generatePassword()` ; aucun service tiers |

### Anti-motifs

| Anti-motif | Tâche(s) |
|---|---|
| « 100 % sûr », « impossible à pirater » | 27, 25 |
| « Personne, nous compris, ne peut lire » sans réserve | 25, 27 |
| Badges creux | 25, 28 |
| Noms d'algorithmes à l'écran | 25, 27, C3 |
| Barrière « J'accepte les conditions » | 10, 13 |
| Bannière de cookies | 25 |
| Offre payante, bandeau de soldes | 26, 28 |
| Publicité chez le destinataire | 20, 21 |
| Fond saturé, texte en dégradé | 28 |
| Animation sans pause | 12, 28 |
| Bouton désactivé sans dire pourquoi | 10, 11, 13, 16, 28 |
| Domaines voisins et raccourcisseurs | 25, K2 |
| Bloquer le téléchargement présenté comme une protection | 22, 23, R |
| Motifs à ne pas prendre : lien avant `finalize`, options modifiables, envoi par e-mail, aperçu publicitaire | 17, 19, 18, 21 |

### Signalements

| # | Sujet | Tâche(s) |
|---|---|---|
| B1 | Exception reCAPTCHA à chaque « aucun tiers » | 14, 15, 16, 21, 25, 27, C2 |
| B2 | « Serveur — ne lit rien » | 28, V2, V3 (décision du propriétaire) |
| B3 | Aucune allégation d'audit ni de pays avant qu'elles soient vraies | 25, 26, 28, C1 |
| B4 | Pause de l'ambiance, contrôle et clé `localStorage` | 28 (décision du propriétaire) |
| B5 | La fiche du serveur seulement après scellement, valeurs réelles | 19 |
| B6 | Information (partages de test de l'étude) | Sans objet, rien à faire |
