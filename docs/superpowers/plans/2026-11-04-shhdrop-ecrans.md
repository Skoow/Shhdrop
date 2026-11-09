# Shhdrop — Plan 2 : les écrans

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une PWA Svelte 5, en français et en anglais, dans le monde visuel « Nuit chiffrée » (toujours sombre), qui permet de composer (glisser-déposer, coller, catégories, ordre), chiffrer, envoyer (progression réelle, pause, annulation, reprise), gérer, ouvrir, lire, enregistrer, détruire et signaler un partage, en s'appuyant uniquement sur l'API cliente (`web/src/index.ts`, complétée en Task 0), servie par le serveur Go sous la CSP stricte de la spec, avec un anti-robot par preuve de travail maison et un repli reCAPTCHA isolé sur une autre origine ; une démo publiée sur GitHub Pages dès le premier écran ; le tout vérifié par des parcours Playwright sur Chromium et WebKit (téléphone et ordinateur) avec captures, contrôle d'accessibilité et garde « aucune violation CSP, aucune ressource tierce ».

**Architecture:** `web/src/index.ts` reste la seule porte vers la crypto et le réseau. Au-dessus : `web/src/ui/` (jetons, composants, mouvement), `web/src/routes/` (écrans), `web/src/flows/` (machines à états testées), `web/src/i18n/`, `web/src/media/` (vocal, métadonnées, catégories), `web/src/captcha/` (preuve de travail, pré-calcul, cadre de repli), `web/src/viewers/`, `web/src/app/` (routeur, lien, cycle de vie, environnement, crochets de démo), `web/src/demo/` (faux serveur, **absent du build de production**). Logique dans des `.ts` / `.svelte.ts` testés par Vitest ; composants `.svelte` minces. Entrées Vite : `index.html` (application), `pdf-frame.html` (cadre PDF, IIFE), `verif/index.html` (page de vérification, build séparé). Mode `demo` : `base: "/Shhdrop/"`, sortie `dist-demo/`. Le serveur Go sert `web/dist` (`static.go`, déjà sur `main`).

**Tech Stack:** Svelte 5.57.3, `@sveltejs/vite-plugin-svelte` 7.3.1, Vite 8.3.5, TypeScript 7.0.2 (+ `svelte-check` 4.7.8 sur TypeScript 6.0.3 dans un paquet outil séparé), Vitest 5.1.0, `@playwright/test` 1.64.1, `@axe-core/playwright` 4.14.0, `pdfjs-dist` 6.5.438, `@lucide/svelte` 1.68.0, `uqr` 0.1.3, polices Mona Sans et JetBrains Mono (Fontsource 5.3.0, fichiers copiés). Go 1.26.

**Spec:** `docs/superpowers/specs/2026-11-04-shhdrop-ui-design.md` (notée « UI », révision 6) et `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (notée « spec », v2.10 : journal des décisions en §41 (D41-1 à D41-14) ; §37 compte facultatif, complété en §37.11 ; §38 offre payante, formules Plus et Pro en §38.8 ; §39 salon de discussion ; §40 envoi direct, **plus tard et optionnel** depuis la v2.9).

**Ordre après la Task 8 (5 novembre)** : Task DA (direction artistique v2, UI §20), puis Tasks K1 à K3 (chiffrement anticipé, lien court, spec §29, §31, §32, §34), puis Task M2 (minimisation serveur, aucune statistique, spec §35.1, §36), puis Tasks 9a à 9c (nettoyage des métadonnées, spec §35.2) et 10 à 24, avec la Task 12b conditionnelle (Q-REC1) et les amendements listés après la Task M2, puis **Task Q-1** (nouvelles limites gratuites, 15 éléments et 2 Go, immédiatement après le lot de correctifs issu des scans du 7 novembre), Task R (droits), **Task R2** (page de contenu 2027), Task H (historique et tableau de bord « Vos envois »), Tasks A1 à A3 (compte facultatif, spec §37 et §37.11), Tasks C-1 à C-6 (salon de discussion, WebSocket, exclusion, spec §39), Tasks V1 à V3 (coffre), Tasks 25 à 27, Tasks C1 à C4 (code vérifiable, C4 conditionnelle), Task 28. Référence visuelle : `docs/superpowers/design/da-v2/`. Lire UI §0, §7, §9, §12, §14.3, §15, §18 et spec §2, §5, §7.4, §10, §12, §13, §18, §19, §21, §24, §25, §35, §36 avant toute tâche. Tasks P1 à P3 (offre payante, spec §38) : **après la mise en ligne de la V1**, selon le moyen de paiement choisi (Q-P1). **Tasks D-1 et D-2 (envoi direct, spec §40) : après la V1, optionnelles** (décision du 7 novembre : aucun pair à pair par défaut, spec §41.3). **v2.10 (7 novembre)** : Task E1 (fermeture de l'interface à la disparition pendant un téléchargement, V1) et étapes 3c et 7b de la Task M2 (flux annulables, signal « gone ») ; Tasks P4 (compte à rebours à la première ouverture), P5 (manifeste découpé, Pro illimité) et F0 à F11 (fonctions payantes, spec §38.9) : **après la V1**.

## Global Constraints

- **Tout le travail se fait sur `main`** (CLAUDE.md) : aucune branche ; tests au vert avant chaque push ; `git push origin main` à la fin de chaque tâche (ce qui republie la démo, Task 8).
- **Aucune clé, aucune donnée de contenu chiffrée et aucun appel réseau hors de `web/src/index.ts`** (et de `web/src/transfer/` en Task 0). Les écrans n'importent jamais `transfer/api.ts`, `crypto/*` ni `fetch`, et n'appellent jamais `/api/captcha` eux-mêmes (le pré-calcul passe par `prepareCaptcha` de `index.ts`) ; seul `src/demo/` remplace `fetch`/`XMLHttpRequest`, et seulement en mode démo. Le Worker anti-robot (`captcha/pow.worker.ts`) ne calcule que des SHA-256 WebCrypto sur des données publiques (le défi). Contrôlé par un test de recherche dans les sources (Task 1).
- `expectedOrigin` = `location.origin` partout.
- Le serveur ne reçoit jamais de contenu, de nom, de clé ni de mot de passe en clair : le test « le serveur ne voit rien » du Plan 1 reste vert ; la Task 27 l'étend au navigateur.
- **Aucune ressource tierce** sur les pages de l'application (polices, icônes, scripts, styles, images : tout est servi par le serveur) ; aucun `data:`. Seule exception, et seulement dans les Tasks 15–16 : le document du cadre de vérification, servi par l'origine `SHH_VERIF_ORIGIN`, chargé après consentement (UI §15).
- **CSP** de la spec §10 inchangée, sauf `frame-src 'self' {SHH_VERIF_ORIGIN}` quand le repli est activé, et `frame-ancestors 'self'` (au lieu de `'none'`) sur `/pdf-frame.html` seulement. Aucun script ni style en ligne, aucun attribut `style` statique, aucun `eval` / `new Function`, aucun `{@html}`. Toute violation détectée en e2e fait échouer le test.
- Aucun stockage navigateur, sauf **exceptions écrites** : `web/src/vault/` (coffre chiffré, spec §27), `web/src/history/` (`S_gestion` et données locales chiffrés, spec §33) et, **depuis la v2.9**, `web/src/session/open-grant.ts` ~~et `web/src/chat/session.ts`~~ (`sessionStorage` d'onglet : `K_lien` et octroi d'ouverture, spec §41.4 ; ~~jeton de membre et clé courante du salon, spec §39.13.3~~ : supprimé par D41-24, le salon ne garde rien sur l'appareil), effacés à « Terminer », à la destruction, à l'échéance, après 30 min d'inactivité et à la fermeture de l'onglet ; jamais le mot de passe, `R` ni clair. Risque dit honnêtement : lisible par qui a accès à l'appareil déverrouillé et à l'onglet, ou par un script injecté ; CSP stricte, Trusted Types **non** invoqués (UI S8). Contrôlé par `source-rules.test.ts`. Aucun secret dans la console, le titre, l'URL après `replaceState` (sauf exception navigateur intégré, UI S4), ni dans un `postMessage`.
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
PASSWORD_ALPHABET = "abcdefghkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!?@#$%&*+-=/()";   // 68 symboles (8 novembre : 2^60,15)
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
- [ ] **M9, la pré-lecture ne compte pas comme ouverture.** La phrase de la Task 20 (v2.9 : « Ouvrir ce partage compte une ouverture. Recharger la page ou l'ouvrir dans un autre onglet de ce navigateur n'en compte pas d'autre pendant 30 minutes. ») n'est vraie que si la lecture anticipée de segments pendant la saisie ne consomme pas d'ouverture et que l'ouverture est comptée au déverrouillage. *Contrôle* : e2e : destinataire qui pré-lit pendant la saisie puis recharge sans déverrouiller → `shareStatus` en Node : 0 ouverture ; après déverrouillage → 1. **Signalement (moyenne)** : vérifier ce point contre spec §29.6 avant de figer le texte ; s'il est faux, corriger le texte, pas le test.
- [ ] **Abandon.** « Un partage abandonné est absent du serveur » appuie la phrase « S'efface tout seul ». *Contrôle* : e2e existant (page fermée → partage absent).

---

### Task M2 : minimisation serveur, aucune statistique (spec §35.1, §36)

Chaque étape reprend une ligne « À faire » de spec §36 (repère S…) ou de §35.1. Placée juste après K3 : elle modifie la pré-lecture (K3), `finalize` (K1) et les colonnes de la base. Ce qui touche Caddy, Docker et journald (S1, S2, S3, S17) va au Plan 3, avec les tests décrits en spec §36.

**Files:**
- Create: `server/internal/api/minimize_test.go`, `server/internal/stats_test.go` (recherche dans les sources et `go.sum`), `web/src/no-analytics.test.ts`, `web/src/transfer/readorder.ts`, `readorder.test.ts`
- Modify: `server/internal/store/store.go` (colonnes), `server/internal/share/service.go` (échéances en mémoire, effacement au démarrage, `ttl_hours` à `NULL`), `server/internal/api/handlers_share.go` (`reason`, `/healthz`), `server/internal/api/api.go`, `server/internal/captcha/captcha.go` (heures à la minute), `server/internal/limits/*.go` (méthode `Len()` par compteur, pour les tests), `server/internal/janitor/janitor.go`, `web/src/transfer/prefetch.ts`, `web/src/transfer/draft.ts`, `web/src/transfer/client.ts`, `web/e2e/sees-nothing.test.ts`, `web/e2e/scan.ts`, `web/scripts/check-dist.mjs`
- **v2.10 (spec §41.8, D41-10)** — Create: `server/internal/share/streams.go`, `streams_test.go` (registre de flux annulables), `server/internal/share/detached.go`, `server/internal/api/handlers_watch.go`, `handlers_watch_test.go`. Modify: `server/internal/api/handlers_segment.go` (service d'un segment par le registre, 410 `gone`), `server/internal/share/service.go` (ouvertures actives, fin de grâce, descripteurs détachés), `server/internal/janitor/janitor.go`, `server/internal/stats_test.go` (nouvelles lignes de spec §9.5)

- [ ] **Step 1 : Tests qui échouent — aucune statistique (§35.1).**
  - `web/src/no-analytics.test.ts` : la liste de spec §35.1 cherchée sans tenir compte de la casse dans `web/src`, `web/scripts`, `web/*.html`, les noms de paquets de `package-lock.json` ; `check-dist.mjs` fait la même recherche dans `dist/`, `dist-verif/`, `dist-demo/` ; un fichier piégé de test (`gtag(` dans une chaîne) prouve que la recherche le trouve ; aucun écouteur `error` ni `unhandledrejection` ailleurs que dans une liste blanche vide.
  - `server/internal/stats_test.go` : aucun import interdit (§35.1) dans `server/` ni dans `go.sum` ; toute déclaration `map[` dans `server/internal` hors de la liste blanche (fichier et nom de variable, une entrée par ligne de spec §9.5) fait échouer le test avec le message « nouveau compteur : ajouter une ligne justifiée à spec §9.5 » ; aucun client HTTP sortant (`http.Client`, `http.Get`, `net.Dial`) hors de `captcha/recaptcha.go`.
  - Rotation : horloge injectée, chaque compteur de §9.5 rempli puis vide après sa durée (`Len() == 0`) : minute, heure, 2 min, 3 h, minuit UTC.
  - Schéma : `sqlite_master` ne contient que `shares` et ses index.
- [ ] **Step 2 : Tests qui échouent — base et heures (S5, S11, S12).**
  - Après `finalize` : colonnes `progress_at`, `upload_deadline`, `purge_at` **absentes** du schéma (migration qui les retire) ; `ttl_hours` à `NULL` ; seule date en base : `expires_at`, multiple de 900.
  - Envoi bloqué 15 min, envoi vide 5 à 20 min, échéance de 3 h (6 h depuis la Task Q-1), `purge_at` de l'état `draining` : mêmes résultats qu'avant (tests existants de `share/` rejoués), avec des échéances tenues en mémoire.
  - Redémarrage simulé (nouveau `Service` sur la même base) : tout partage `uploading` ou `draining` est effacé, fichier compris ; un partage `ready` reste.
  - Anti-robot : les heures gardées pour la difficulté sont des multiples de 60 s ; la difficulté double toujours à chaque création de l'heure.
- [ ] **Step 3 : Tests qui échouent — requêtes (S2, S14, S17, S18, S21).**
  - `minimize_test.go` : recherche dans `server/` : aucun `UserAgent()`, `Referer()`, `RemoteAddr` hors de `clientip.go` et `/healthz` ; aucune lecture d'en-tête hors de `Authorization`, `X-Shh-Client-IP`, `X-Shh-Access`, `X-Shh-Manage`.
  - `destroy` : `reason` absent ou `"report"` → accepté ; `"ReperRaison"`, `""`, `"REPORT"` → 400 `bad_request` ; aucune réponse ne contient « ReperRaison ».
  - Échos : pour chaque route, un identifiant repère (`ReperIdAAAAAAAAAAAAAA`, longueur valide puis invalide), un en-tête `X-Repere: ReperEntete` et un corps repère : aucune réponse (corps et en-têtes) ne les contient ; seules les valeurs d'erreur de la liste fixe sortent.
  - Sorties : stdout et stderr du serveur sur un parcours complet avec `X-Shh-Client-IP: 203.0.113.77` et `User-Agent: ReperUA/1.0` : seulement `SHH_LISTENING …` ; aucune adresse ni repère.
  - `/healthz` (boucle locale) : `{"ok":true,"reports_alert":false}` ; 5 signalements dans l'heure → `true` ; heure suivante → `false` ; aucun autre champ.
- [ ] **Step 3c : Tests qui échouent — disparition pendant un téléchargement : flux annulables liés à la révocation des jetons, signal « gone » (spec §41.8, D41-10 ; horloge injectée, fichiers de 40 segments, `-race`, `goleak`).**
  - **Expiration** : une ouverture **active** (segment servi dans les 120 s) continue de recevoir ses segments après `expires_at`, jusqu'à `min(expires_at + 2 h, expiration du jeton)` (6 h et 24 h essayés), puis 410 `gone` ; 120 s de pause puis reprise après l'échéance → refusée (pas de reprise après une pause) ; un segment **en cours d'envoi** à l'échéance n'est pas coupé (flux lent simulé) ; ouverture jamais commencée à l'échéance : `unlock`, octroi, `regrant`, pré-lecture → refusés (404 uniforme sans jeton, 410 avec jeton signé valide) ; fichier et ligne effacés dès qu'aucune ouverture n'est active, au plus tard à la fin de grâce ; redémarrage simulé : tout partage expiré effacé.
  - **Suppression** (`manage/destroy`, `destroy` du destinataire, 5 mots de passe faux) pendant un téléchargement : `meta`, `unlock`, nouveau jeton, autre ouverture → 404 ; l'ouverture active **finit** (les segments suivants viennent du descripteur gardé), le fichier **n'est plus listé** dans le dossier dès la suppression, le descripteur est fermé à la fin de grâce (nombre de descripteurs du processus revenu à sa valeur initiale), l'espace réservé libéré à la fermeture ; **exceptions sans grâce** : `destroy` avec `reason: "report"` et `shhdrop admin destroy` coupent tous les flux (octets reçus < taille), aucune requête suivante servie.
  - **Révocation d'un lien** (Task F5) et **exclusion d'un salon** (Task C-6) : seuls les flux de la clé révoquée sont coupés, ceux des autres liens ou membres intacts ; `Registry` vide ensuite.
  - **Signal « gone »** : 410 `{"error":"gone"}` **seulement** pour un jeton signé valide ; identifiant inexistant, jeton falsifié ou expiré → exactement la réponse d'un partage inconnu (**aucun oracle d'existence**, comparaison octet par octet) ; `GET /api/shares/watch` : 204 après 25 s (horloge), 410 en moins d'une seconde après une suppression ou une expiration, 2 par connexion (la 3ᵉ → 429), 256 au total, non comptée dans les 60 requêtes par minute, aucune goroutine ni descripteur de reste après la fermeture du client.
  - `stats_test.go` : les quatre nouvelles `map` sont dans la liste blanche avec leur ligne de §9.5.
- [ ] **Step 4 : Tests qui échouent — client (S4, S9, S10).**
  - `readorder.test.ts` : `planReads(manifest, wanted)` rend, après le segment de fin, une suite **strictement croissante** de numéros de segments ; ouvrir l'élément 5 avant l'élément 2 → les segments des éléments 1 à 5 sont lus dans l'ordre (ceux de 1 à 4 conservés s'ils tiennent dans le cache de lecture de 64 Mio, sinon jetés) ; seul un nouvel essai répète un numéro ; revenir à un élément déjà jeté relit depuis son premier segment, une seule fois (budget de 2 × le paquet, spec §24).
  - `prefetch.test.ts` : la pré-lecture démarre à la réponse de `meta`, dans l'ordre fin, 0, 1, 2… jusqu'à 64 Mio, à un rythme qui ne dépend d'aucun événement clavier (espion : 0 frappe contre 20 frappes → mêmes instants de requête, horloge injectée).
  - `draft.test.ts` : mode « Envoyer seulement quand je clique » → tous les segments de bourrage sont envoyés par le navigateur (octets de `crypto.getRandomValues`, jamais de zéros), `finalize` sans `fill_from` ni `fill_to` ; mode anticipé → inchangé (K1). Côté serveur : `finalize` sans `fill_*` exige que tous les segments soient présents.
- [ ] **Step 5 : « Le serveur ne voit rien » étendu** (`web/e2e/sees-nothing.test.ts`, `scan.ts`) selon spec §36 : IP repère (texte et 4 octets), User-Agent, Referer et Accept-Language repères, identifiant repère dans une route inconnue, `reason` repère ; aucun sur disque (base, WAL, fichiers), dans stdout, stderr ni dans les réponses ; dates de la base multiples de 900 s, colonnes retirées absentes ; en mode « au clic », aucun `finalize` avec `fill_from`. La fouille de la mémoire garde ses repères de contenu et de clés.
- [ ] **Step 6 : Lancer** `make test` → ÉCHEC sur chaque test nouveau (sortie jointe).
- [ ] **Step 7 : Implémenter** : migration de la base (copie dans une nouvelle table `WITHOUT ROWID` sans les trois colonnes, `secure_delete` déjà actif, puis `VACUUM`) ; échéances d'envoi, de blocage et de purge dans une table en mémoire du `Service` ; effacement au démarrage ; `ttl_hours` à `NULL` à `finalize` ; `reason` en énumération ; compteur horaire des signalements et `/healthz` ; heures de l'anti-robot à la minute ; `readorder.ts` branché dans `client.ts` (lecture des éléments et enregistrement) ; pré-lecture à calendrier fixe ; bourrage envoyé par le navigateur en mode « au clic ».
- [ ] **Step 7b : Implémenter la disparition pendant un téléchargement (spec §41.8).** Registre `Streams` en mémoire : clé de révocation → fonctions d'annulation ; `Revoke(clé, grâce)` ; chaque service de segment passe par lui (copie contrôlée par contexte, contrôle de la fin de grâce **entre** les segments, jamais au milieu) ; table des ouvertures actives ((id, n) → heure du dernier segment, 120 s) ; fichier détaché gardé ouvert par une ouverture active après suppression (fermé à la fin de grâce ou à la fin du téléchargement) ; nettoyeur qui efface à l'échéance quand aucune ouverture n'est active ; 410 `gone` pour un jeton signé valide ; route `GET /api/shares/watch` (25 s) ; `report` et `admin destroy` sans grâce ; les routes `exclure` du salon (Task C-6) et `revoke` des liens (Task F5) appellent `Revoke(clé, sans grâce)`. Mêmes changements dans le faux serveur de la démo.
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

> **Cadenas d'état par élément (D41-25, 8 novembre)** : `ui/lock.ts` (vert seulement à `pret` côté envoi, à `done` ou texte du manifeste côté réception), `ui/LockMark.svelte` ; tests `lock.test.ts`, `ui-e2e/lock.spec.ts` (segment retenu : jamais vert avant la réponse du serveur).

> **Livrée le 8 novembre (D41-22, nettoyage automatique).** Écarts avec ce plan : nettoyage à l'ajout dans le composeur, `prepare` en dernier verrou (`flows/clean-gate.ts`) ; ~~`non_pris_en_charge` bloque l'envoi jusqu'au choix~~ (D41-23 : plus aucun blocage, marque « Non nettoyé » et raison courte, résumé près d'Envoyer, helper e2e `sendAsIs` supprimé) ; `cleanLabelKey(item)` lit l'état de l'élément (pas `StripResult`, catégorie inutile) ; `meta.heic` est une structure synthétique (aucun encodeur HEVC libre ici), `meta.avif` réel (Pillow, `gen-media-fixtures.sh`) ; pièges construits dans les tests (troncatures, CRC, bloc critique, iloc) plutôt qu'en fichiers ; `moov` dans un HEIF → `echec` (suites d'images, Task 9c). Pas fait ici : `categoryOfReceived` (reste de l'ancienne Task 9), à reprendre.

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

> **Livrée le 8 novembre.** Écarts avec ce plan : `office.ts` unique pour OOXML et ODF (au lieu de `ooxml.ts` et `odf.ts`) ; miniatures **retirées** (`docProps/thumbnail.*` et sa relation, `Thumbnails/` et son entrée du manifeste ; la spec §35.2 les disait « laissées ») ; `w15:person` retirés de `people.xml` (au lieu de renommés) ; `pdf.ts` ajoute un dernier filet : `/Author` ou `/Producer` encore lisible hors des objets neutralisés (révision détachée, objet orphelin) → `echec` ; pdf.js absent : lisibilité vérifiée par la structure (chaque entrée xref pointe sur « N G obj », même longueur, texte de page intact ; contrôle manuel `pdfinfo`/`pdftotext` et LibreOffice sur les sorties) ; fichiers d'essai en Deflate « stocké » (mêmes octets partout) ; ZIP64 et nom en double construits dans les tests ; `meta.pptx` minimal n'est pas ouvrable par LibreOffice (l'original non plus). Laissés : suivi des modifications (signalé), nom d'auteur écrit dans le texte des commentaires Excel anciens, `w:rsid*`, `customXml/`, `settings.xml` ODF, auteurs d'annotations PDF (`/T`) et leurs dates, `/Info` dans un `ObjStm` (→ `echec`).

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
- [ ] **Step 4 : e2e** (`compose.spec.ts`) : photo + texte + PDF → trois catégories dans l'ordre Texte, Photos, Documents, méta « 1 · … » ; deux photos réordonnées à la souris puis au clavier (Alt + ↓) avec annonce lue dans le `LiveRegion` ; mode déplacement sur `webkit-mobile` ; renommage (Entrée, Échap) ; retrait + Annuler ; 17 fichiers → message « 2 éléments n'ont pas été ajoutés » (15 au plus depuis la Task Q-1) ; fichier creux 2 Go + 1 octet → jauge `--danger`, bouton bloqué avec la raison ; doublon → badge ; nom de 200 caractères et nom arabe → pas de débordement à 320 px ; `axe` ; captures `compose-filled`, `compose-over`, `compose-reorder`. Démo : parcours « ajouter, réordonner, retirer » ajouté à `demo.spec.ts`.
- [ ] **Step 5 : Lancer** `npm test && npx playwright test compose` puis la commande démo des Global Constraints → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): composer (catégories, ordre, renommage, doublons, jauge) » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M1, l'outil est l'accroche.** La rangée d'ajout (Fichiers, Photo, Texte) et `DropZone` sont visibles sans défilement à 390 × 844 et à 1440 × 900 ; aucun clic préalable, aucune case « J'accepte les conditions » avant l'ajout. *Contrôle* : e2e `webkit-mobile`, page fraîchement chargée : le bas de la rangée d'ajout est dans la fenêtre (`boundingBox().y + height <= 844`) ; ajouter un texte sans autre interaction fonctionne ; aucun `input[type=checkbox]` n'existe avant le premier élément.
- [ ] **M5, chiffres concrets plutôt qu'adjectifs.** Ligne de preuves sous le titre de l'accueil : « Sans compte · 2 Go · 24 h au plus · 5 essais de mot de passe, puis destruction » ; la jauge affiche des valeurs réelles arrondies (octets et nombre d'éléments, par exemple « 142 Mo sur 2 Go »). Chiffres en `font-variant-numeric: tabular-nums`. Aucun badge (« ultra-sécurisé », « conforme RGPD »). *Contrôle* : test unitaire : la ligne est construite à partir des constantes (`CONTENT_MAX`, nombre maximal d'éléments, durée maximale, nombre d'essais de la Task K1), aucun chiffre écrit en dur dans `fr.ts` ni `en.ts` (changer la constante change la ligne) ; `getComputedStyle(...).fontVariantNumeric` contient `tabular-nums` sur la jauge. **Signalement (faible)** : `CONTENT_MAX` = 1 073 741 824 − 65 540 est un peu sous 1 Gio ; le « 2 Go » affiché (v2.9, Task Q-1) et le blocage `trop_gros` doivent venir de la même constante, et la jauge ne doit jamais promettre plus que `CONTENT_MAX` (test à la limite exacte).
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

- [ ] **Step 1 : Tests qui échouent** (`createShare` simulé, horloge injectée) : phases `keys` → `captcha` (appel de `solveCaptcha`) → `upload` (`onProgress(0,n)`) → `finalize` (`onBytes(total,total)`) → `sealed` (résolution seulement) ; `start` deux fois → un seul `createShare` ; `onRetry` → `offline` avec `inMs`, retour à `upload` au progrès suivant ; 10 s sans octet → `offline` ; `pause()` → `paused` à la fin du segment, reprise automatique à `min(10 min, deadline())` (cas testé : segment acquitté il y a 5 min, pause demandée → reprise à 8 min de pause, pas à 10), pause refusée à moins de 15 min de la fin de la fenêtre de 6 h (Task Q-1 ; 3 h avant) ; `cancel()` → `abort()`, phase `cancelled`, `createdOnServer` exact ; `cancel` ignoré en `finalize` ; `tooSlow` quand `eta > fenêtre restante` ; erreurs UI §9.4.6 (`Error("full")` → `plein`, `Error("frozen")` → `gele`, `NotReadableError` → `fichier_modifie` avec l'élément fautif, `bad_request` → ordre des essais ci-dessus, vérifié avec `fallbackOrigin` nul (2 essais puis `captcha`) et non nul (3 essais, le dernier en `mode: "fallback"`), et un `bad_request` sur une preuve pré-calculée relance un essai en preuve de travail sans pré-calcul, pas le repli) ; `LimitError(120)` → `retryAfterS` ; `retry()` rappelle `createShare` en entier (nouveau `take()`) ; `start` prélève la preuve pré-calculée (`prepared`) et le préfetcher est arrêté à l'annulation et à `pagehide` ; mot de passe gardé seulement dans `result` ; verrou d'écran demandé en `keys`, relâché en pause, à la fin et à l'annulation. `stats.test.ts` : EMA sur une série connue, `percent` jamais 100 avant `sent === total`.
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

### Task 19 : Tableau de bord de l'expéditeur et page de gestion (UI §9.6, spec §33.1)

> **v2.9 (7 novembre)** : la page de gestion devient un **tableau de bord** de cartes alimenté par l'historique local chiffré (Task H) ; **aucune empreinte d'appareil**. La carte, `StateChip`, l'accueil « Vos partages actifs » et `/envois` partagent les mêmes composants. L'ordre des tâches reste 19 puis H : la Task 19 livre la vue `#m…` et les composants ; la Task H branche l'historique, la bande de l'accueil et `/envois`.

**Files:**
- Create: `web/src/routes/Manage.svelte` (vue `#m…`, carte en grand), `web/src/flows/manage.svelte.ts`, `manage.test.ts`, `web/src/ui/ShareCard.svelte`, `StateChip.svelte`, `EmptyArt.svelte`, `web/src/ui/Dissolve.svelte`, `dissolve.css`, `web/src/flows/shareCard.ts`, `shareCard.test.ts` (modèle de carte : fonction pure de l'entrée locale et du dernier état), `web/ui-e2e/manage.spec.ts`

**Interfaces:** `createManager(link, deps = { shareStatus, destroyShare, now, local?: HistoryEntry })` → `{ state: "loading" | "ready" | "draining" | "uploading" | "gone" | "expired" | "error"; status?; local?; refresh(); destroy(); addToHistory() }` ; `cardModel(local: HistoryEntry | null, status: ManageStatus | null, now)` → `{ chip: "actif" | "effacement" | "detruit" | "expire"; opens: { used; max } | null; remainingS: number | null; sizeBytes: number | null; itemsCount: number | null; createdAt: number | null; stale: boolean }` ; `Dissolve.play(): Promise<void>`.

- [ ] **Step 1 : Tests qui échouent** : `NotFoundError` → `gone` ; `destroy` → `gone` après la réponse seulement ; `LimitError` → pas de relecture avant `retryAfterS` ; relecture suspendue si `hidden` ou hors ligne ; compte à rebours local à zéro → `expired` puis relecture immédiate ; `cardModel` : matrice état → (mot, icône) ; sans donnée locale, `sizeBytes`, `itemsCount` et `createdAt` sont `null` (affichés « — ») ; hors ligne → `stale: true`, jamais un chiffre recalculé hors du dernier état connu ; **la carte ne contient aucun nom d'élément** (type et recherche de source) ; `addToHistory()` chiffre `S_gestion` via `history/` seulement ; relecture au plus 1 fois / 5 min / partage hors vue détaillée.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.6.1 à §9.6.6 et §7.4 : carte (état, ouvertures « 1 / 3 » avec encoches, compte à rebours et contour de temps, taille, heure de création locale, nombre d'éléments), actions **Copier le lien de gestion**, **Détruire** (`InlineConfirm`), **Détails** (« Ce que voit le serveur », intervalles d'ouverture, échéance « vers 9 h 45 »), états **vide, expiré, détruit** (`DestroyReceipt`), hors ligne.
- [ ] **Step 4 : e2e** : « Ouvert 1 / 3 · Expire dans … » ; carte avec taille, éléments et création quand l'envoi vient du même navigateur ; « — » et « Ce partage n'a pas été créé sur cet appareil » avec **Ajouter à mes envois** sinon ; Copier le lien de gestion (presse-papier = `…/#m…` entier, mention affichée) ; Supprimer → dissolution → « Détruit » avec `DestroyedArt` (Task R2), focus ; partage inexistant → « Détruit » ; compte à rebours à zéro (`page.clock`) → « Expiré » ; état `uploading` (envoi lancé dans un autre contexte, mis en pause) → « Envoi en cours » ; hors ligne → « non mis à jour » ; capture en milieu de dissolution et `dissolve-end` ; captures `manage`, `card-expired`, `card-destroyed`, `card-offline` (390 et 1440 px) ; `axe`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): tableau de bord de l'expéditeur (cartes de partage), page de gestion, dissolution » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M11, cycle de vie lisible d'un coup d'œil.** Composant partagé `StateChip.svelte` (réutilisé en Task H) : une icône et un mot par état, jamais la couleur seule : Actif, En cours d'effacement (`draining`), Détruit, Expiré ; ouvertures en « 1 / 3 ». **Signalement (faible)** : le plan emploie « Supprimé » pour l'état final, l'étude « Détruit » ; garder un seul mot d'état : « Détruit » (cohérent avec « Ce partage a été détruit » chez le destinataire), l'action restant « Supprimer ce partage ». Le compte à rebours local à zéro donne « Expiré », un `NotFoundError` après `destroy()` donne « Détruit ». *Contrôle* : `manage.test.ts` : matrice état → (mot, icône) ; e2e : chaque état a un mot visible, l'icône est `aria-hidden`, `axe` sans violation de contraste, et le mot reste lisible avec `forcedColors: "active"`.
- [ ] **M12 : état et arrêt visibles.** La pastille d'état et **Détruire** restent visibles dès l'état `ready`. *Contrôle* : e2e à 390 × 844 : le bouton est atteignable sans défilement ou fixé.
- [ ] **S1, la vue du serveur.** Bascule « Ce que voit le serveur » dans **Détails** : la carte se retourne (rotation 3D en `transform`, 420 ms ; fondu en mouvement réduit) et montre : « un bloc illisible d'environ 142 Mo · s'efface vers 9 h 45 · 0 ouverture sur 1 · aucun nom, aucun texte, aucune clé » (valeurs d'exemple). **B5** : les valeurs viennent de `shareStatus` (taille arrondie, échéance au quart d'heure, compteur), la bascule n'existe pas pendant `uploading`. Si `shareStatus` n'expose pas la taille, ne pas ajouter de champ serveur pour cela : omettre ce segment et le consigner dans le fichier de décisions. *Contrôle* : `serverView.test.ts` : fonction pure `serverCard(status)` (aucun paramètre de nom ni de texte) → chaîne attendue ; e2e : bascule absente en `uploading`, présente en `ready` ; avec des noms et textes distinctifs saisis à l'envoi, la fiche ne contient ni eux ni le fragment `#` du lien ; face cachée `inert`, bouton `aria-pressed`.
- [ ] **Motif refusé : options modifiables après création.** Aucun contrôle ne modifie la durée ni le nombre d'ouvertures. *Contrôle* : e2e : la page ne contient aucun champ de durée ou d'ouvertures et n'émet aucune requête de modification.
- [ ] **Refus de l'empreinte d'appareil.** *Contrôle* : test de sources : aucun appel à `canvas.toDataURL`, `AudioContext` d'empreinte, `navigator.plugins`, `getClientRects` de mesure de polices ni module nommé `fingerprint` dans `history/`, `routes/Manage.svelte`, `ui/ShareCard.svelte` ; aucune requête de gestion ne porte autre chose que `S_gestion` (e2e).
- [ ] **S3 (branchement).** Le contour de temps restant (`TimeRim`, créé en Task 20) est branché ici dans `ShareCard.svelte` et `Manage.svelte` à la fin de la Task 20.

---

### Task 20 : Ouverture

**Files:**
- Create: `web/src/routes/Open.svelte`, `web/src/routes/Invalid.svelte`, `web/src/flows/receive.svelte.ts`, `receive.test.ts`, `web/ui-e2e/open.spec.ts`

**Interfaces:** `createReceiver(link, deps = { fetchMeta, openShare, now, inAppBrowser: () => string | null, scrub: () => void })` → `{ state: "meta" | "inapp" | "locked" | "reopen" | "unlocking" | "open" | "invalid" | "destroyed_by_password" | "incomplete" | "error"; expiresInS; attemptsLeft?; retryAfterS?; opened?: Opened; continueHere(); unlock(password): Promise<void> }` (aucun mot de passe gardé après `unlock`). `inAppBrowser` enveloppe `inAppBrowser(ua, standalone)` de Task 5 et `scrub` enveloppe `scrubAddressBar(history, pathname)`. Le bouton « Déverrouiller » est désactivé tant que le champ est vide ; si `openShare` lève quand même `Error("mot_de_passe_requis")` (Task M), l'état reste `locked`, `attemptsLeft` ne change pas, aucun essai n'est consommé et l'erreur `mot_de_passe_requis` est exposée (message « Entrez le mot de passe. »).

- [ ] **Step 1 : Tests qui échouent** : `NotFoundError` / `lien_invalide` à `fetchMeta` → `invalid` ; `BadPasswordError(3)` → `locked`, `attemptsLeft = 3` ; `attemptsLeft` était 1 puis `NotFoundError` → `destroyed_by_password` ; `LimitError(120)` ; compte à rebours à zéro en `locked` → `invalid` sans appel ; `unlock` deux fois de suite → un seul `openShare` ; navigateur intégré → `inapp` puis `locked` après `continueHere()`, `scrubAddressBar` seulement à ce moment ; après succès, aucune référence au mot de passe dans l'état ; `unlock("")` / `Error("mot_de_passe_requis")` → message « Entrez le mot de passe. », `attemptsLeft` inchangé, état `locked` ; `inAppBrowser` et `scrub` sont des dépendances injectées (espion : `scrub` n'est appelé qu'après `continueHere()`).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.7 et §9.11 (dont la phrase de démo sur « Lien invalide » quand `getDemo() !== null` : la chaîne vient de `getDemo().invalidLinkNote`, pas du dictionnaire de production ; `Open.svelte` n'importe jamais `demo/`).
- [ ] **Step 4 : e2e** : deux mauvais mots de passe → « 3 essais restants » ; cinq → « Mot de passe incorrect. Le partage a été détruit. », partage absent en Node ; bon mot de passe → contenu ; sans `#` → « Lien incomplet » sans requête `/api/` ; agent Instagram → bandeau, `#` conservé jusqu'à « Continuer ici quand même » (cas déplacé de Task 5), qui l'efface, et « Copier le lien » donne le lien avec sa clé ; mot de passe vide → bouton désactivé ; en démo, `/Shhdrop/s/abc#x` → « Lien invalide » avec la phrase de démo (cas déplacé de Task 8) ; `page.clock` au-delà de l'expiration sur l'écran verrouillé → « Lien invalide » ; `axe` ; captures `open`, `open-badpw`, `open-inapp`, `invalid`. Démo mise à jour.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): ouverture, essais, navigateur intégré, liens invalides » et push.

**Amendement v2.9 (7 novembre) : rechargement et onglets multiples sans ouverture de plus (spec §41.4, UI §9.7.1)**

**Files:**
- Create (client) : `web/src/session/open-grant.ts`, `open-grant.test.ts` (`sessionStorage["shh.og"]`, seul module autorisé), `web/src/session/tabs.ts`, `tabs.test.ts` (`BroadcastChannel("shhdrop-og")`, échange en mémoire), `web/ui-e2e/reopen.spec.ts`
- Create (serveur) : `server/internal/share/grant.go`, `grant_test.go` (octroi signé HMAC : `n` ‖ `exp` ‖ MAC ; vérification ; balayage des échéances en mémoire), `server/internal/api/handlers_grant.go`
- Modify : `server/internal/api/handlers_unlock.go` (en-tête `X-Shh-Grant`, 409 `grant_invalid`, 429 `reopen_limit`), `POST /api/shares/regrant`, budget de lecture par (id, n) = (2 + r) × le fichier, `web/src/transfer/api.ts` et `web/src/index.ts` (`openShare(link, password, origin, { onProgress, grant })` rend aussi `grant`), `web/src/flows/receive.svelte.ts` (état `reopen`), `web/src/routes/Open.svelte`, **`pagehide` n'envoie plus `done()`** (Task 24 : `finish` seulement à « Terminer », destruction, signalement), `web/src/source-rules.test.ts` (`sessionStorage` permis dans `session/` et dans `chat/session.ts` seulement), `web/src/demo/fake-server.ts`, `fr.ts`, `en.ts`

**Interfaces:**
```ts
type OpenGrantEntry = { v: 1; link: string /* K_lien, 43 car. */; grant: string /* 54 car. */; last: number };
saveOpenGrant(e: OpenGrantEntry): void; loadOpenGrant(): OpenGrantEntry | null; clearOpenGrant(): void;
startInactivityGuard(now, onExpire): { touch(); stop() };      // 30 min sans activité → clearOpenGrant
askOtherTabs(tag: string /* SHA-256(K_accès) tronqué à 16 octets */, ms = 400): Promise<string | null>;   // octroi en mémoire d'un autre onglet
answerOtherTabs(getGrant: (tag) => string | null): () => void;
```
```go
const GrantTTL = 30 * time.Minute; const MaxReopens = 10
func IssueGrant(secret [32]byte, id [16]byte, n uint32, exp time.Time) string
func VerifyGrant(secret [32]byte, id [16]byte, g string, now time.Time) (n uint32, ok bool)   // hmac.Equal
```
- [ ] **Step 1 : Tests qui échouent.**
  - Serveur : `unlock` rend un octroi ; `unlock` avec octroi valable et bonne preuve → même `n`, `opens_left` et `opens_issued` inchangés, jeton neuf, octroi renouvelé ; **en `draining`** (plus d'ouverture disponible) l'ouverture non terminée rouvre ; **mauvaise preuve avec octroi → un essai compté** (5 → destruction) ; octroi falsifié, d'un autre partage, d'une autre ouverture, expiré, ou ouverture terminée → 409 `grant_invalid`, `opens_left` et essais inchangés ; 11ᵉ rechargement → 429 `reopen_limit` ; budget (2 + r) × le fichier chiffré + 2 segments 0 par (id, n), non remis à zéro par un nouveau jeton ; `regrant` renouvelle pour 30 min, jamais au-delà du jeton de téléchargement ; octroi expiré sans renouvellement → ouverture terminée (balayage), et un partage `draining` est alors effacé ; `done` explicite termine l'ouverture ; redémarrage → octrois invalides ; **aucune adresse IP, aucun identifiant d'appareil, aucun cookie** dans les réponses et les tables (recherche) ; « le serveur ne voit rien » vert.
  - Client : `saveOpenGrant` appelé **seulement après** un `openShare` réussi ; l'entrée ne contient ni mot de passe, ni `R`, ni clé de contenu (type et recherche de source) ; `clearOpenGrant` sur chaque cause (Terminer, destruction, `NotFoundError`, échéance du partage, 30 min d'inactivité avec `page.clock`, `grant_invalid`, `reopen_limit`) ; un `#` de lien différent efface l'entrée ; état `reopen` quand l'entrée existe et que l'adresse n'a pas de `#` ; le mot de passe est ressaisi ; `askOtherTabs` répond avant 400 ms quand un autre onglet détient l'octroi, `null` sinon ; l'octroi échangé n'est jamais écrit hors mémoire par l'onglet qui répond ; `K_lien` jamais envoyé sur le canal.
- [ ] **Step 2 : Lancer** `make test-go` et `npm test -- session receive` → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §41.4 et UI §9.7.1 (états `reopen`, phrases, renouvellement toutes les 10 min visible et actif).
- [ ] **Step 4 : e2e** (`reopen.spec.ts`, vrai serveur, `maxOpens = 3`) : déverrouillage (1 ouverture) → **rechargement → « Rouvrir ce partage »**, mot de passe ressaisi → contenu, **`shareStatus` en Node : toujours 1 ouverture utilisée, compteur inchangé (« 1 / 3 » avant et après)** ; dix rechargements d'affilée → toujours 1 ; le onzième → « Trop de rechargements : une nouvelle ouverture sera comptée » ; deuxième onglet avec le lien, premier onglet ouvert → « déjà ouvert dans un autre onglet », mot de passe, **toujours 1 ouverture** ; deuxième onglet sans premier onglet → l'écran annonce la consommation, 2 ouvertures après déverrouillage ; mauvais mot de passe après rechargement → « 4 essais restants » ; « Terminer et effacer » puis rechargement → « Lien incomplet » (octroi effacé) ; `maxOpens = 1` (`draining`) : rechargement → rouvre, partage encore présent ; fermeture de l'onglet → partage effacé après l'expiration de l'octroi (`page.clock`, balayage) ; `Object.keys(sessionStorage)` = `["shh.og"]` sans mot de passe dans sa valeur ; `axe` ; captures `open-reopen`, `open-othertab`.
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(open): octroi d'ouverture — recharger ou ouvrir plusieurs onglets ne compte qu'une ouverture » et push.


**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M9, le geste irréversible annoncé avant.** Dans les états `meta` et `locked`, avant tout déverrouillage : « Ce partage peut être ouvert encore **1 fois**. Ouvrir ce partage compte une ouverture. Recharger la page ou l'ouvrir dans un autre onglet de ce navigateur n'en compte pas d'autre pendant 30 minutes. » (pluriel : « encore **3 fois** » ; v2.9, spec §41.4). La donnée vient de `fetchMeta`, qui ne consomme rien (UI §0.1). *Contrôle* : e2e : partage avec `maxOpens = 3` → « encore 3 fois » ; deux rechargements sans déverrouiller → toujours « 3 fois » et `shareStatus` en Node montre 0 ouverture consommée ; déverrouillage → 1 ouverture comptée ; **rechargement après déverrouillage → « Rouvrir ce partage », compteur inchangé (voir l'amendement v2.9 ci-dessous)** ; ouverture d'un second partage → « encore 2 fois » ; la phrase est reliée au bouton d'ouverture par `aria-describedby` ; unit : singulier et pluriel. Si `fetchMeta` n'expose pas le nombre restant, afficher la seconde phrase seule et le consigner dans le fichier de décisions.
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
- [ ] **Step 1b (v2.10, D41-13)** : `isRiskyName` est testé pour **chaque** extension de la liste de la spec §12, y compris les cinq ajoutées le 7 novembre : `.wsh`, `.msp`, `.xll`, `.ps1xml`, `.inf` (en minuscules, majuscules et avec un nom à double extension comme `facture.pdf.wsh`) ; la liste du test est lue de la spec, pas copiée à la main (un test échoue si l'une des extensions manque dans `isRiskyName`).
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
- [ ] **M6, illustration « détruit » (v2.9).** Le cadenas ouvert et la capsule en pointillés sont **retirés** de l'état détruit : `DestroyedArt.svelte` (UI §9.10.1, livré en Task R2) montre un document qui se défait en points de la Trame, et le logo joue `erase()`. *Contrôle* : e2e : `data-state="destroyed"` sur `DestroyedArt`, aucun `lock-open` dans le DOM de l'état (la Task R2 porte les captures).
- [ ] **Signalement sans choix de motif** (déjà prévu) : aucune liste de motifs ; vérifier que la feuille ne collecte rien de plus. *Contrôle* : la requête de signalement n'a pas de corps libre.

---

### Task E1 : Disparition pendant un téléchargement — fermeture de l'interface (spec §41.8, D41-10 ; UI §9.8.9, §10.1)

Client des cas 1 et 2 de la spec §41.8 (le serveur est dans la Task M2, étapes 3c et 7b ; le cas 3, salon, dans la Task C-6). Elle dépend de la Task M2 (étapes 3c et 7b) et de la Task 21.

**Files:**
- Create: `web/src/flows/gone.ts`, `gone.test.ts`, `web/src/transfer/watch.ts`, `watch.test.ts`, `web/src/ui/GoneScreen.svelte`, `web/ui-e2e/gone.spec.ts`
- Modify: `web/src/transfer/api.ts` (`GoneError` pour 410, `watchShare(token, signal)`), `web/src/transfer/client.ts` (suite des téléchargements en cours sans nouvelle requête de lecture hors d'eux), `web/src/routes/Content.svelte`, `web/src/viewers/save.ts` (le tuyau d'écriture survit à `closeToGone`), `web/src/session/open-grant.ts` (effacement), `web/src/i18n/*`

**Interfaces:**
```ts
type GoneCause = "countdown" | "http410" | "watch410" | "destroyed-here";
closeToGone(cause: GoneCause): { finishing: number };   // ferme l'interface, laisse finir les téléchargements en cours
startWatch(token, onGone, deps = { now, fetch }): { stop(): void };   // requête tenue 25 s en boucle, page visible et active
```

- [ ] **Step 1 : Tests qui échouent (unit).**
  - `closeToGone` : liste, galerie, visionneuse, lecteurs audio et vidéo retirés ; **toutes les URL blob révoquées** (`fetch(blobUrl)` échoue) ; tranches et textes mis à zéro (espion) ; `sessionStorage["shh.og"]` absent ; plus aucun appel `meta`, `regrant`, `watch`, pré-lecture, ni démarrage d'un aperçu ou d'un nouvel enregistrement (espion réseau : seules passent les requêtes de segments **des téléchargements déjà en cours**) ; idempotent (deux causes de suite : une seule fermeture).
  - **Téléchargement en cours** : flux vers un faux `showSaveFilePicker` de 40 segments, `closeToGone` au segment 12 → **les 28 segments restants sont demandés et écrits, `close()` appelé**, la clé de contenu mise à zéro seulement après ; repli Blob : l'assemblage se termine puis le `<a download>` part, URL révoquée ensuite ; le serveur répond 410 au segment 20 → `abort()` appelé, **jamais `close()`**, fichier partiel supprimé, ligne « Téléchargement interrompu. ».
  - Causes : compte à rebours à zéro (horloge injectée, **aucune requête**) ; 410 d'une requête de segment ; 410 de `watch` ; destruction faite ici.
  - `startWatch` : boucle de 25 s, redémarre après 204, **s'arrête** page cachée ou inactive 30 min et reprend au retour, s'arrête après `gone` ; aucune requête avant l'`unlock`.
  - Texte : « Ce partage n'est plus disponible. » identique pour l'expiration et la suppression (jamais « supprimé par l'expéditeur ») ; la ligne `gone.finishing` ne contient **ni nom ni taille** de fichier (scan) ; focus rendu au titre de l'écran de fin, `aria-live="assertive"`.
- [ ] **Step 2 : e2e qui échouent** (`gone.spec.ts`, vrai serveur, fichier de 200 Mio en deux contextes). (a) **Expiration** : horloge avancée à l'échéance pendant un téléchargement → l'interface se ferme **aussitôt** (liste, galerie, visionneuse absents du DOM, `document.body.innerText` sans nom de fichier), la ligne « Un téléchargement se termine en arrière-plan » apparaît, **le fichier enregistré est complet** (SHA-256 identique) ; un nouveau téléchargement ou un rechargement ensuite → « Ce partage n'est plus disponible. ». (b) **Suppression par l'expéditeur** (second contexte, lien de gestion) pendant le téléchargement : l'interface du destinataire se ferme **en moins d'une seconde** (via `watch`), le fichier se termine complet ; une **autre** ouverture du lien → « Lien invalide ». (c) **Signalement** (`report`) : l'interface se ferme et le téléchargement est **interrompu** (fichier partiel supprimé). (d) Grâce : téléchargement mis en pause 3 min puis repris après l'expiration → « Téléchargement interrompu. ». (e) `axe`, mouvement réduit, captures `gone`, `gone-finishing`. (f) « le serveur ne voit rien » : aucun message de fermeture ne passe par le réseau.
- [ ] **Step 3 : Lancer** → ÉCHEC. **Step 4 : Implémenter** UI §9.8.9. **Step 5 : Lancer** `npm test && make test-ui` puis la démo (le faux serveur simule `gone`) → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(ui): l'interface se ferme à la disparition du partage, le téléchargement en cours se termine » et push.

---

### Task Q-1 : nouvelles limites gratuites (15 éléments, 2 Go) (spec §4, §24, §29.3, §29.5, §41.2 ; UI §9.2.5, §10.1)

Placée **immédiatement après le lot de correctifs** issu des scans du 7 novembre (commits `fix(ui)` et `fix(security)` en cours) et avant la Task R. Décision du propriétaire du 7 novembre : gratuit à **15 éléments et 2 Go** par partage ; les autres limites gratuites ne changent pas. Prérequis : Task 8 (démo), Tasks K1 à K3 (paquet v2, quotas), Task 10 (jauge), Task 17 (envoi). Revues : `golang-backend`, `golang-testing`, `svelte`.

**Files:**
- Modify (client) : `web/src/crypto/container.ts` (`CONTENT_MAX` = 2 147 483 648, `ITEMS_MAX` = 15, paliers `[1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385, 32769]`, `fileSizeOf(bucket)` = 48 + B × 65 552 ; palier canonique recalculé), `web/src/transfer/*` (jeton d'envoi : délais 6 h, 24 h au-delà de 2 Gio ; bandeau « envoi trop lent » recalculé sur 6 h, UI A6), `web/src/flows/compose.svelte.ts` (15 éléments, `trop_gros` à 2 Go), `web/src/ui/CapacityGauge.svelte` (« 340 Mo / 2 Go » et « 3 / 15 », 15 crans), `web/src/routes/Home.svelte` (ligne de preuves), `web/src/i18n/fr.ts` et `en.ts` (toutes les chaînes de UI §10.1 ; **aucun chiffre écrit en dur**, tout vient des constantes), `web/src/media/*` (seuils : aucun changement attendu, à vérifier)
- Modify (serveur) : `server/internal/share/*` (palier maximum 32 769, `MaxItems` n'existe pas côté serveur : le serveur ne connaît que le palier), `server/internal/limits/*` (6 et 12 Gio utiles par jour par connexion et par /48 ; octets abandonnés 12 et 24 Gio ; octets payants du jour, spec §41.2), `server/internal/config/config.go` (`SHH_STORAGE_MAX` = 200 Gio par défaut ; `SHH_STORAGE_PLUS_MAX` = 300 Gio, inactif tant que P2 n'est pas fait ; démarrage : espace libre ≥ `SHH_STORAGE_MAX` + 1 Gio), jetons (`upload_deadline`, jeton de téléchargement, `purge_at` à 6 h ; seuil « aucun segment » à `upload_deadline` − 5 h 55), `server/internal/janitor/*` (nouveaux seuils), tests associés
- Modify (démo) : `web/src/demo/fake-server.ts` (paliers, quotas, plafond d'éléments, délais), `web/src/demo/*` (texte de démo sur les limites)
- Modify (docs) : `docs/securite-technique.md` (paliers), page `/securite` (« 2 Go »), Task 25 (pages), constantes citées dans les Tasks 10 et 28 (« 15 éléments · 2 Go »)

- [ ] **Step 1 : Tests qui échouent.**
  - Client (`container.test.ts`, `compose.test.ts`, `limits.test.ts`) : `fileSizeOf(32769)` === 2 148 073 536 ; palier canonique d'un contenu de 2 147 483 648 octets de données → 32 769 ; de 2 147 483 649 → `trop_gros` ; 16 ajouts de fichiers → le 16ᵉ refusé avec son nom (« 1 élément n'a pas été ajouté : 15 au plus. ») ; 15 éléments acceptés ; la jauge affiche « 3 / 15 » (15 crans) et « Trop gros : 2,2 Go sur 2 Go. Retirez 200 Mo. » à la limite exacte + 1 octet (la valeur affichée et le blocage viennent de la même constante `CONTENT_MAX`) ; test de recherche : aucune occurrence de « 1 Go », « 10 éléments » ni `16384` dans `fr.ts`, `en.ts`, `Home.svelte` ni la jauge ; changer `ITEMS_MAX` change la ligne de preuves de l'accueil et le message de refus (test unitaire, UI M5) ; `PREVIEW_MAX` (200 Mio) inchangé ; envoi de 2 Gio creux : mémoire bornée (`performance.memory` ou lecture par tranches vérifiée, UI §9.2.8).
  - Serveur : création avec palier 32 769 → acceptée, palier 32 770 → 400 ; quotas : 3 partages de 2 Gio finalisés par connexion en un jour → le 4ᵉ refusé (429) ; 7 partages de 1 Gio → 7ᵉ refusé ; octets abandonnés 12 Gio → au-delà 429 et retour à l'envoi au clic ; `SHH_STORAGE_MAX` = 200 Gio par défaut (test de configuration) ; démarrage refusé si l'espace libre est inférieur à 201 Gio ; jeton d'envoi valable 6 h ; envoi sans segment effacé à 5 h 55 avant `upload_deadline` (5 à 20 min après la création) ; budget de lecture 2 × le fichier chiffré du nouveau palier ; fichier réservé de 2 148 073 536 octets (`fallocate`), segment 512 (le dernier) d'un seul morceau ; « le serveur ne voit rien » vert avec un partage de 2 Gio (taille à 4 Mio près, spec §18.12, inchangée).
  - Démo : le faux serveur refuse un 16ᵉ élément et un contenu de plus de 2 Gio avec les mêmes messages.
- [ ] **Step 2 : Lancer** `npm test -- container compose limits` et `make test-go` → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §41.2 (toutes les lignes du tableau), puis régénérer les captures du composeur.
- [ ] **Step 4 : e2e** (`compose.spec.ts`, `limits.spec.ts`) : ajout de 15 fichiers puis d'un 16ᵉ → message, liste de 15 ; jauge « 3 / 15 » et « 340 Mo / 2 Go » ; fichier creux de 2 Gio (`gen` à la volée) envoyé et reçu (SHA-256 identique) sur un vrai serveur (nuit seulement : `@slow`), enregistrement en flux par `showSaveFilePicker` simulé ; accueil : « 15 éléments · 2 Go · 24 h au plus · 5 essais, puis destruction » ; WebKit mobile : avertissement mémoire avant l'enregistrement d'un élément de plus de 200 Mo ; `axe` ; captures `compose-limits`, `home-proof`.
- [ ] **Step 5 : Lancer** `npm test && make test-go && make test-ui && npm run build:demo && node scripts/check-dist.mjs --demo && npx playwright test --project='demo-*'` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(limits): gratuit à 15 éléments et 2 Go (paliers, quotas, délais, textes, démo) » et push.

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

### Task R2 : page de contenu 2027 (galerie, visionneuse, tout télécharger, zip) (spec §41.6, §41.1 ; UI §9.8.x, §9.10.1)

Après la Task R (les droits décident des boutons). Décisions du propriétaire du 7 novembre (point 7 : page de contenu ; point 8 : illustration « détruit »). Revues : `svelte`, `accessibility-review`, `design-critique` (impeccable), `constant-time-analysis` non applicable ; `supply-chain-risk-auditor` : **aucune dépendance ajoutée** (écrivain ZIP maison, spec §41.6).

**Files:**
- Create: `web/src/zip/store-zip.ts`, `store-zip.test.ts` (écrivain ZIP « stocké », CRC-32, ZIP64), `web/src/zip/crc32.ts`, `web/src/viewers/gallery.ts`, `gallery.test.ts` (classement, quotas de chargement automatique), `web/src/viewers/bitmap.ts` (`createImageBitmap`, miniatures de 480 px), `web/src/viewers/peaks.ts`, `peaks.test.ts` (96 crêtes par tranches), `web/src/ui/Lightbox.svelte`, `WaveformPlayer.svelte`, `GalleryTile.svelte`, `DownloadBar.svelte`, `DestroyedArt.svelte`, `EmptyArt.svelte`, `web/src/flows/download-all.ts`, `download-all.test.ts`, `web/ui-e2e/gallery.spec.ts`, `web/ui-e2e/zip.spec.ts`, `web/ui-e2e/destroyed-art.spec.ts`
- Modify: `web/src/routes/Content.svelte` (galerie à la place de la liste, la liste devient le repli ≤ 320 px sans JavaScript d'aperçu), `web/src/viewers/ImageViewer.svelte`, `VideoViewer.svelte`, `AudioViewer.svelte`, `TextViewer.svelte`, `web/src/ui/SaveButton.svelte`, `web/src/routes/Ended.svelte`, `Manage.svelte` (écran « détruit » : `DestroyedArt`), `web/src/ui/DestroyReceipt.svelte`, `web/src/ui/decor.ts` (positions des points), `web/src/ui/logoMotion.ts` (appel unique de `erase()` à la fin de la dissolution), `web/src/i18n/fr.ts`, `en.ts` (UI §10.1), `web/src/source-rules.test.ts` (aucun `import(` dans `zip/` ni `viewers/` ; aucune URL blob d'image hors GIF/WebP animés), `THIRD_PARTY_LICENSES.md` (inchangé : aucune dépendance)

**Interfaces:**
```ts
// zip/store-zip.ts : écrivain en flux, mode « stocké », descripteurs de données, ZIP64 au-delà de 4 Gio − 1
createZip(sink: { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }): {
  add(name: string, size: number, source: AsyncIterable<Uint8Array>): Promise<void>;   // CRC-32 calculé au fil de l'eau
  finish(): Promise<void>;                                                              // répertoire central
};
zipName(raw: string, taken: Set<string>): string;     // safeName, sans séparateur ni "..", doublon → " (2)", noms réservés Windows suffixés
crc32(bytes: Uint8Array, seed?: number): number;      // 0xCBF43926 pour "123456789"
ZIP_BLOB_MAX = 512 * 1048576; ZIP_BLOB_MAX_SMALL = 200 * 1048576;   // iPhone/iPad ou deviceMemory < 4
downloadAll(opened, items, deps: { pickDirectory?; saveOne; now }): { run(): Promise<{ ok: string[]; failed: { name: string; error: string }[] }>; cancel() };
waveformPeaks(buffer: AudioBuffer, bars = 96): Promise<number[]>;     // par tranches de 5 M d'échantillons, cède la main entre deux
```
- [ ] **Step 1 : Tests qui échouent.**
  - `crc32("123456789")` === `0xCBF43926` ; `store-zip` : archive de 3 entrées relue par `python3 -I -m zipfile -t` et `unzip -t` (outils de test seulement, sauts documentés si absents) : contenu identique octet par octet ; noms UTF-8 avec accents et émoji ; entrée vide ; date de chaque entrée = 1980-01-01 00:00 ; aucun champ de métadonnées de l'auteur ; noms hostiles (`../../etc/passwd`, `C:\x`, `a/b`, `CON.txt`, `.`, nom vide, 300 caractères) → nom sûr sans séparateur ; deux « photo.jpg » → « photo.jpg » et « photo (2).jpg » ; entrée de 5 Gio simulée par source creuse → en-têtes ZIP64 corrects (relue par `python3 -m zipfile`), mémoire bornée (jamais plus de 8 Mio en attente) ; `abort()` appelé en cas d'erreur de source et rien « fermé » ; aucune lecture de plus de la source (compte des lectures).
  - `downloadAll` : avec `pickDirectory` → un seul sélecteur, N fichiers, aucun écrasement d'un nom existant (« (2) ») ; sans → N `saveOne` à la suite avec 1 s d'intervalle (horloge injectée) ; une erreur n'arrête pas les autres ; annulation → plus de nouvelle écriture, fichier courant `abort()` ; éléments déjà en mémoire réutilisés (aucune nouvelle lecture du serveur : espion sur `saveItem`).
  - `gallery.test.ts` : images ≤ 20 Mio chargées d'office jusqu'à 256 Mio cumulés, puis « Afficher » ; ordre et catégories identiques au manifeste ; `waveformPeaks` : 96 valeurs entre 0 et 1, sinus connu → crêtes attendues, aucune tranche de calcul de plus de 50 ms (horloge simulée).
  - Droits : `rights: "voir"` → le DOM de `Content` ne contient **aucun** élément `Télécharger`, `Tout télécharger`, `.zip`, `Copier` ni bouton de téléchargement de la visionneuse (`querySelector` sur toute la page, y compris `<dialog>`) ; `"enregistrer"` → tous présents.
  - `DestroyedArt` : positions des points déterministes (graine fixe) ; aucun `lock-open` dans le DOM de l'état détruit ; `logoMotion.erase` appelé une fois ; mouvement réduit → aucune animation.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** UI §9.8.x (disposition, images par `createImageBitmap`, visionneuse, lecteur vidéo, lecteur audio à forme d'onde, texte, barre d'actions), spec §41.6 (écrivain ZIP, **aucun `import()` dynamique**), UI §9.10.1 (illustration). Dans l'écrivain ZIP : CRC-32 d'intégrité seulement (pas de cryptographie), jamais de `eval`, écriture via un puits abstrait (`showSaveFilePicker`, ou `Blob` borné par `ZIP_BLOB_MAX`).
- [ ] **Step 4 : e2e** (`gallery.spec.ts`, `zip.spec.ts`, `destroyed-art.spec.ts`) : partage de 6 éléments (3 photos, MP3, MP4, note) → galerie, tuiles dans l'ordre ; lightbox : ouverture au clic, ← → Début Fin, `+ - 0`, Échap rend le focus à la tuile, balayage simulé (événements de pointeur de 80 px) change d'image, balayage vers le bas ferme, zoom molette et double-clic, compteur « 2 / 3 », Télécharger de la visionneuse livre le fichier d'origine (SHA-256) ; aucune URL blob d'image active après `load` ; lecteur vidéo lit ; lecteur audio : 96 barres, clic à 50 % place `currentTime` vers la moitié, flèches ± 5 s ; « Tout télécharger » avec `showDirectoryPicker` simulé : 6 fichiers dans le dossier, mêmes SHA-256 ; sans le sélecteur : 6 téléchargements à la suite ; archive .zip : reçue, ouverte par `python3 -m zipfile`, mêmes SHA-256 et mêmes noms (sans doublon) ; `.exe` dans le partage → `InlineConfirm` avant l'archive ; archive trop grosse pour un `Blob` (appareil simulé 200 Mio) → bouton remplacé, raison affichée ; « voir seulement » : aucun bouton de téléchargement (DOM entier), mention honnête présente ; expiration → boutons désactivés ; destruction côté destinataire → `DestroyedArt` (captures début, milieu, fin), logo effacé, aucune icône de cadenas ; `axe` sur la galerie, la visionneuse ouverte et l'écran détruit ; captures `gallery`, `lightbox`, `waveform`, `download-bar`, `destroyed-art` (téléphone et ordinateur) ; WebKit mobile : balayage tactile réel.
- [ ] **Step 5 : Lancer** `npm test && make test-ui` puis la commande démo → SUCCÈS ; budget de performance (UI §20.6) : aucune trame longue de plus de 50 ms à l'ouverture de la visionneuse ni pendant le calcul de la forme d'onde.
- [ ] **Step 6 : Commit** « feat(ui): page de contenu 2027 — galerie, visionneuse, lecteurs, tout télécharger, archive .zip, écran détruit » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md`)
- [ ] **Anti-motif « publicité chez le destinataire »** : la galerie ne montre que le partage et ses actions. *Contrôle* : toutes les requêtes ont l'origine de l'application ; aucun `<iframe>` hors cadre PDF.
- [ ] **Texte honnête** : « Voir seulement » ne promet jamais d'empêcher une capture ; aucune des formules interdites du scan des textes de confiance (Task 27).

---

### Task H : Historique local des envois, tableau de bord « Vos envois » (spec §33, §33.1 ; UI §9.6)

> **v2.9 (7 novembre)** : le secret de gestion reste **local et chiffré** ; au retour de l'expéditeur, l'accueil montre « **Vos partages actifs** » et `/envois` est le **tableau de bord** de cartes (UI §9.6) ; avec le compte facultatif (Tasks A1 à A3), la même liste se synchronise dans « Paramètres ». **Aucune empreinte d'appareil** (refusée, spec §33.1).

**Files:**
- Create: `web/src/history/store.ts`, `store.test.ts`, `web/src/history/poll.ts`, `poll.test.ts`, `web/src/routes/History.svelte` (`/envois` : tableau de bord), `web/src/ui/ActiveSharesStrip.svelte` (accueil), `web/ui-e2e/history.spec.ts`
- Modify: `web/src/routes/Ready.svelte` (bascule + enregistrement de `sizeBytes`, `itemsCount`, `createdAt`), `web/src/routes/Home.svelte` (bande « Vos partages actifs »), `web/src/app/router.svelte.ts` (`/envois`), `web/src/source-rules.test.ts` (IndexedDB permis dans `history/` et `vault/` seulement), `web/src/i18n/*`

**Interfaces:**
```ts
type HistoryEntry = { id: string; manage: string /* S_gestion, chiffré au repos */; label: string;
  createdAt: number /* heure locale exacte, jamais envoyée */; sizeBytes: number; itemsCount: number;
  expiresAt: number; maxOpens: number; opens: { count: number; between: [number, number] }[];
  state: "ready" | "draining" | "gone" | "expired"; lastSeenAt: number };
openHistory(deps?: { idb?: IDBFactory; now? }) → { list(); add(e); remove(id); clear(); update(id, patch) };
  // AES-256-GCM, clé non extractible (generateKey extractable: false) gardée dans IndexedDB ; nonce aléatoire par écriture
pollHistory(h, deps = { manageStatus, now, visible: () => boolean }) → { start(); stop(); refreshOne(id) };   // à la demande, ≤ 1 fois / 5 min / partage, gigue 0,5 à 4 s ; plus de boucle de 60 s à l'accueil
HISTORY_KEEP_GONE_MS = 7 * 86_400_000;
```
- [ ] **Step 1 : Tests qui échouent** (`fake-indexeddb` refusé : pas de dépendance ; IndexedDB simulé en mémoire dans le test) : `add` puis lecture brute de la base → aucun octet de `S_gestion`, du libellé, de la taille ni de la date en clair ; la clé enregistrée a `extractable === false` ; jamais de `K_lien`, de mot de passe ni de **nom d'élément** dans `HistoryEntry` (type et recherche de source) ; `pollHistory` : compteur 0 → 1 entre deux relectures à 21:00 et 21:01 → `between: [21:00, 21:01]` ; aucune relecture si `visible()` est faux ; **l'accueil ne lance aucune requête au chargement** (espion sur `manageStatus`) et `refreshOne` respecte les 5 min et la gigue ; `NotFoundError` → `gone` ; échéance passée → `expired` ; entrée `gone`/`expired` retirée après 7 jours ; `clear()` vide tout ; `ActiveSharesStrip` : rien de rendu si aucune entrée active.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §33 et §33.1 ; `ShareCard` (Task 19) en liste ; Détruire en un geste (`InlineConfirm`), `manageDestroy`, dissolution de la carte ; bande de l'accueil (trois cartes compactes + « Tout voir ») ; tri et filtres de UI §9.6.2 ; bouton « Effacer l'historique » ; avec un compte, ligne « Synchronisé avec votre compte » et branchement sur le coffre de compte (Task A2).
- [ ] **Step 4 : e2e** : envoi → entrée « 6 éléments · 142 Mo · il y a 1 min » dans `/envois` ; **retour sur l'accueil → bande « Vos partages actifs » avec la carte, sans requête au chargement** ; ouverture par un autre contexte puis « Actualiser » → « 1 / 1 », intervalle affiché ; Détruire → « Détruit », `fetchMeta` en Node → `NotFoundError` ; filtres Actifs / Terminés ; **état vide** (« Aucun envoi pour l'instant » + « Envoyer quelque chose ») ; carte **expirée** (`page.clock`) et **détruite** ; bascule désactivée sur « Lien prêt » → aucune entrée, bande absente ; hors ligne → « non mis à jour » ; « Effacer l'historique » → vide ; démo : historique en mémoire seulement (pas d'IndexedDB sur l'origine partagée) ; compte (faux serveur) : la liste apparaît dans « Paramètres » d'un second contexte ; `axe` ; captures `history`, `history-empty`, `history-destroy`, `home-active-shares` (390 et 1440 px).
- [ ] **Step 5 : Lancer** → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(history): historique local chiffré, tableau de bord Vos envois, partages actifs à l'accueil » et push.

**Apports de l'étude des concurrents** (benchmark `docs/superpowers/design/benchmark-2026-11.md` ; M = motif, S = idée signature, B = signalement ; correspondance complète en annexe de ce plan)
- [ ] **M11, cycle de vie lisible.** La liste réutilise `StateChip.svelte` (Task 19) : icône et mot par état (Actif, En cours d'effacement, Détruit, Expiré), couleur jamais seule, ouvertures en « 1 / 3 ». *Contrôle* : e2e : chaque état d'une entrée a un mot visible ; `axe` ; `forcedColors: "active"` laisse le mot lisible.
- [ ] **M12 et B5, état et arrêt visibles, heures honnêtes.** Chaque entrée active montre « Actif · s'efface vers 9 h 45 » (même fonction d'arrondi qu'en Task 18) et Détruire en un geste. *Contrôle* : unit : la fonction d'arrondi est partagée (un seul module) ; e2e : le texte « vers » apparaît pour l'échéance serveur ; l'heure de **création**, locale, peut être précise.
- [ ] **M5.** Les compteurs (« 1 / 3 ») viennent des valeurs réelles lues sur le serveur ; aucun chiffre inventé hors ligne. *Contrôle* : e2e : hors ligne, l'entrée affiche son dernier état connu avec la mention « non mis à jour » plutôt qu'un chiffre frais.

---

### Tasks A1 à A3 : compte facultatif (spec §37)

Après la Task H, qui fournit l'historique à synchroniser. Prérequis : réponses du propriétaire à Q-A1 à Q-A7 (défauts de spec §37.10 et §37.11.5 appliqués sinon) ; **routes, corps et réponses exacts : spec §37.11.1** (ils font foi sur les interfaces ci-dessous) ; avis du juriste (spec §37.9) avant d'activer `SHH_ACCOUNTS=1` en public, pas avant de coder. Compte désactivé dans la démo (test). Revues : `golang-backend`, `golang-testing`, `constant-time-analysis` (comparaisons de `V_s` et des jetons de session), `supply-chain-risk-auditor` (go-webauthn), `privacy-review`.

### Task A1 : Serveur — passkeys (go-webauthn), base `accounts.db`, sessions en mémoire (spec §37.1, §37.3 à §37.5, §37.8)

**Files:**
- Create: `server/internal/account/service.go`, `service_test.go`, `server/internal/account/store.go`, `store_test.go`, `server/internal/account/session.go`, `session_test.go`, `server/internal/account/testauthn_test.go` (authentificateur logiciel de test : attestation `none`, ES256, PRF absent côté serveur), `server/internal/api/handlers_account.go`, `handlers_account_test.go`, `server/internal/account/unlinkable_test.go`
- Modify: `server/go.mod`, `go.sum` (`github.com/go-webauthn/webauthn`, **version exacte**, dernière stable publiée depuis au moins 7 jours, spec §24), `THIRD_PARTY_LICENSES.md` (BSD-3-Clause, à vérifier dans le dépôt de la version choisie), `server/internal/config/config.go` (`SHH_ACCOUNTS`, `SHH_ACCOUNTS_MAX`, `SHH_ORIGIN` : origine exacte, obligatoire si `SHH_ACCOUNTS=1`, spec §37.11 A-G10), `server/internal/limits/*` (compteurs de spec §9.5), `server/internal/api/headers.go` (`Permissions-Policy` : `publickey-credentials-create=(self), publickey-credentials-get=(self)` ; `()` sur `/pdf-frame.html`), test de sources de spec §36 S2 (`X-Shh-Session` ajouté à la liste blanche), `server/cmd/shhdrop/*` (nettoyeur : comptes abandonnés)

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
func (s *Service) BeginAddCredential(session string) (options []byte, err error)          // excludeCredentials = passkeys du compte
func (s *Service) FinishAddCredential(session string, body []byte) error               // env facultative
func (s *Service) SetEnvelope(session string, credID []byte, env []byte) error         // PRF obtenue après le create
func (s *Service) RemoveCredential / RenewRecovery / Rekey / Logout / Delete             // session récente (< 5 min) exigée, sinon ErrRecent
func (s *Service) ListCredentials(session string) ([]CredInfo, bool /*secours*/, error)
// store : accounts(h, created_month, seen_month, blob, gen, v_s, env_s), credentials(cred_id, h, public_key, alg, env, added_month) ; WITHOUT ROWID
```
- [ ] **Step 1 : Tests qui échouent** : cérémonie complète avec l'authentificateur de test (création, connexion découvrable par `userHandle`) ; défi rejoué → refus ; défi de plus de 2 min → refus ; `userVerification` absente → refus ; origine ou `rp.id` différents → refus ; après création, `accounts.db` ne contient ni AAGUID, ni compteur de signatures, ni transports, ni attestation (lecture des colonnes et recherche d'octets repères dans le fichier et le WAL) ; `created_month` et `seen_month` sont des premiers du mois à 00:00 UTC ; `PutBlob` : `if_gen` périmé → `ErrConflict`, taille hors palier ou > 1 Mio → refus, 61ᵉ écriture de l'heure → `limit` ; `Recover` avec un `A_s` faux → réponse identique à « inconnu », 11ᵉ essai de l'heure → `limit` ; recherche de `V_s` par l'index unique sur SHA-256(`A_s`) (spec §37.11 A-G11), jamais par une valeur fournie telle quelle ; `env` absente à `inscription/fin` puis `appareils/enveloppe` → acceptée ; compte sans `env` ni `env_s` à la fin de sa première session → effacé ; `RemoveCredential`, `RenewRecovery`, `Rekey`, `Delete` avec une session de plus de 5 min → `ErrRecent` (403 `recent`), avec une session de 4 min 59 s → acceptés ; retrait de la dernière passkey sans clé de secours → `bad_request` ; `Rekey` remplace `blob` et toutes les `env` en une transaction (échec au milieu → rien de changé) ; `added_month` = premier du mois UTC ; `ListCredentials` ne rend ni clé publique ni enveloppe ; 11ᵉ passkey → `bad_request` ; 4ᵉ compte du jour par connexion → `limit` ; `SHH_ACCOUNTS_MAX` atteint → 503 ; sessions : absentes du disque, perdues au redémarrage, expirées à 15 min sans usage et à 2 h ; `Delete` → lignes supprimées, `wal_checkpoint(TRUNCATE)`, aucun octet repère de `B` dans le fichier après arrêt ; nettoyeur : `seen_month` de plus de 13 mois → compte effacé ; `SHH_ACCOUNTS=0` → toutes les routes `/api/compte/*` en 404.
- [ ] **Step 2 : `unlinkable_test.go` (« le serveur ne voit rien », étendu au compte)** : un partage créé et finalisé, un compte dont `B` est un tampon opaque ; IP, User-Agent, Referer repères (spec §36) → aucun repère sur disque, stdout, stderr ni dans les réponses ; aucune valeur commune entre `accounts.db` et `shares.db` (recherche de chaque `V_accès`, `V_gestion` et identifiant de partage dans les octets de `accounts.db`) ; aucune route de partage ne lit `X-Shh-Session` (test de sources) ; aucune requête SQL ne nomme les deux bases.
- [ ] **Step 3 : Lancer** `make test-go` → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §37.1, §37.3 à §37.5, §37.11 (routes de §37.11.1, création de §37.11.2, connexion de §37.11.3) ; compteur de signatures ni lu ni stocké (avertissement de clonage de go-webauthn ignoré) ; JSON strict de spec §8 ; erreurs uniformes ; aucun journal qui contienne `H`, un identifiant de passkey ou un jeton.
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
recoveryFromKey(rk) → { kekS, aS };  formatRecovery(rk): string;  parseRecovery(s): Uint8Array | "controle" | "longueur"
  // base32 Crockford, 52 caractères + 1 caractère de contrôle (valeur des 32 octets, gros-boutiste, mod 37 ; symboles 32–36 = * ~ $ = U),
  // affichée en 13 groupes de 4 puis le contrôle ; normalisation (majuscules, espaces et tirets retirés, I/L → 1, O → 0)
sealBlob(kBlob, h, gen, json) / openBlob(kBlob, h, b, minGen)   // "SHH-ACCT1", paliers 4 Ki…1 Mi ; minGen : refus d'un retour en arrière
mergeBlobs(a, b): BlobJson;                                     // union par id, tombstones 7 j, gone l'emporte
openAccount(deps?: { webauthn?, fetch?, idb?, now?, random? }) → { create(opts); login(); recover(code); logout(); remove(destroyShares: boolean); addDevice(); renewRecovery(); status() };
scheduleSync(delayMs = randomBetween(120_000, 720_000));        // 2 à 12 min (spec §37.11 A-G2), jamais immédiat après un envoi ; session expirée → en attente de connexion
```
- [ ] **Step 1 : Tests qui échouent** (WebAuthn simulé, avec et sans PRF ; IndexedDB en mémoire ; `fetch` intercepté) : vecteurs fixes HKDF et AES-GCM (enveloppe, coffre) recalculés par un script Node indépendant ; toutes les clés `extractable === false` ; corps de toutes les requêtes interceptées : aucun repère de libellé, de `S_gestion` ni de réglage, aucun `P_i`, `RK`, `K_compte` (recherche d'octets) ; `B` toujours à la taille exacte d'un palier ; `openBlob` avec `gen` < `minGen` → refus ; données authentifiées modifiées (`H`, `gen`) → refus ; `parseRecovery` accepte espaces, tirets, minuscules, `I`/`L`/`O`, refuse une longueur fausse (`longueur`) et un caractère de contrôle faux (`controle`) **sans aucun appel réseau** ; `formatRecovery(32 × 0x00)` === « 0000-0000-…-0000 » suivi du contrôle « 0 », `formatRecovery(32 × 0xff)` se termine par le contrôle calculé par `BigInt` dans le test ; sans PRF, création sans clé de secours → refus (Q-A1) ; PRF absente au `create` → `get` enchaîné ; 409 → relecture, fusion, réécriture `gen + 1` ; fusion : une entrée `gone` sur un appareil l'emporte, une tombstone de plus de 7 jours disparaît ; `scheduleSync` : aucune écriture dans les 2 min qui suivent un `add` d'historique, une écriture avant 12 min (horloge simulée) ; session expirée à l'échéance → aucune requête, état `en_attente`, écriture faite au `login()` suivant ; jeton de session jamais envoyé vers `/api/shares/*` ni `/api/manage/*` ; `logout()` oublie clés et clair, retire de l'historique local les seules entrées `origine: "compte"` reçues d'autres appareils et garde celles créées ici (spec §37.11 A-G8) ; `remove(true)` appelle `manageDestroy` pour chaque `S_gestion` avant `supprimer`.
- [ ] **Step 2 : Lancer** `npm test` → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §37.2, §37.4, §37.6 ; WebCrypto seulement (aucune dépendance nouvelle).
- [ ] **Step 4 : Lancer** `npm test` (avec `tsc`) → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(account): clés par PRF ou clé de secours, coffre de compte chiffré, synchronisation différée » et push.

### Task A3 : Écrans du compte et « le serveur ne voit rien » de bout en bout (spec §37.7)

**Files:**
- Create: `web/src/routes/Account.svelte` (`/compte`), `web/src/routes/RecoveryKey.svelte`, `web/ui-e2e/account.spec.ts`, `web/ui-e2e/account-sees-nothing.spec.ts`
- Modify: `web/src/ui/AppShell.svelte` (lien « Compte (facultatif) » du menu), `web/src/routes/History.svelte` (« Créer un compte (facultatif) », état de synchronisation), `web/src/routes/Ready.svelte` (lien texte sous la bascule), `web/src/routes/PageSecurite.svelte` (paragraphe « Le compte facultatif », limites de spec §18.18), `web/src/i18n/*` (« Aucun compte nécessaire, ni pour envoyer, ni pour recevoir. » remplace la formule de la Task V2), `web/src/app/router.svelte.ts`

- [ ] **Step 1 : Tests qui échouent** (e2e, authentificateur virtuel de Chromium par CDP `WebAuthn.addVirtualAuthenticator`, une fois avec `hasPrf: true`, une fois sans) : hors session, trois entrées visibles dans cet ordre : « Créer avec une passkey », « Se connecter », « J'ai ma clé de secours » (spec §37.11.4) ; connexion avec la passkey virtuelle → écran du compte ; clé de secours mal recopiée d'un caractère → « Clé mal recopiée : vérifiez chaque groupe » sans requête ; création : saisie des 4 derniers caractères exigée avant de continuer ; « Supprimer le compte » plus de 5 min après la connexion → la passkey est redemandée ; messages d'erreur exacts de spec §37.11.4 ; texte exact « Facultatif. Sans e-mail. Votre historique est chiffré : nous ne pouvons pas le lire. » suivi du lien « Ce que le compte ne protège pas » ; annulation de la passkey → retour sans erreur, aucun compte ; création avec PRF → clé de secours refusable ; sans PRF → clé de secours exigée et message de spec §37.7 ; deux contextes (deux « appareils ») avec la même passkey virtuelle : un envoi sur le premier apparaît dans `/envois` du second après la synchronisation (horloge avancée) ; récupération par la clé de secours dans un troisième contexte sans passkey ; Se déconnecter → `/envois` ne montre plus les entrées synchronisées ; Supprimer le compte (case décochée) → le partage vit encore, `GET blob` → 404 ; case cochée → partages détruits ; pages d'ouverture et de contenu : aucune mention du compte (balayage du texte) ; aucune entrée de compte sur le chemin de l'envoi hors du lien texte de « Lien prêt » ; démo → aucune entrée de compte ; `axe` ; captures `account-intro`, `account-recovery`, `account-status`.
- [ ] **Step 2 : `account-sees-nothing.spec.ts`** (SUCCÈS exigé, bloquant comme le test du Plan 1) : parcours complet (création, envoi, synchronisation, second appareil, suppression) ; repères dans les libellés, réglages et `S_gestion` ; exige : aucun repère dans le corps d'une requête ni dans `accounts.db` / WAL après arrêt ; aucune requête de partage avec `X-Shh-Session` ; aucune requête de compte avec un identifiant ou un secret de partage ; écriture de `B` jamais dans les 2 min d'un `finalize`.
- [ ] **Step 3 : Lancer** → ÉCHEC, **implémenter** spec §37.7 et les textes ci-dessus, **relancer** `make test-ui`, la démo (`npm run build:demo && node scripts/check-dist.mjs --demo && npx playwright test --project='demo-*'`) → SUCCÈS.
- [ ] **Step 4 : Liste manuelle** (fichier de décisions) : iPhone (Safari 18+, trousseau iCloud), Android (Chrome, gestionnaire Google), ordinateur avec clé de sécurité sans PRF : créer, second appareil, récupération, suppression.
- [ ] **Step 5 : Commit** « feat(account): écrans du compte facultatif, le serveur ne voit rien étendu au compte » et push.

---

### Tasks C-1 à C-6 : salon de discussion éphémère (spec §39)

Après les Tasks 20 à 24 (ouverture, visionneuses, enregistrement, fin de vie : le salon réutilise leurs composants) et les Tasks A1 à A3 (compte). Prérequis : réponses du propriétaire à Q-SAL1 à Q-SAL8 (défauts de spec §39.12 appliqués sinon) ; avis du juriste (spec §39.7) **avant** `SHH_SALONS=1` en public, pas avant de coder. Salon **désactivé par défaut** côté serveur (`SHH_SALONS=0` → toutes les routes `/api/salons/*` en 404, bloc de l'accueil masqué) ; dans la démo, faux serveur en mémoire, trois « participants » simulés dans la même page. **Nom des tâches** : `C-1` à `C-6` (avec un tiret), à ne pas confondre avec les Tasks `C1` à `C4` (code vérifiable) ; renommage en `S1`–`S6` possible si le propriétaire le préfère.

Revues par tâche : `constant-time-analysis` et `sharp-edges` (C-1, C-2), `golang-backend` + `golang-testing` (C-2), `svelte` (C-3 à C-6), `privacy-review` (C-2, C-6), `accessibility-review` (C-4, C-6). Relecture cryptographique extérieure de spec §39.2 avant l'ouverture au public (signalement de §39.2).

**Amendements v2.9 (7 novembre) aux Tasks C-1 à C-6** — décisions D41-1 à D41-3 (spec §39.2.4, §39.3.1, §39.13, §41.3) ; en cas de contradiction avec le texte des tâches ci-dessous, **cet encadré l'emporte** :
- **Transport (C-2, C-3)** : un seul **WebSocket** (`GET /api/salons/ws`, spec §39.3.1), toujours par notre serveur, **jamais de pair à pair** ni de WebRTC dans le salon. Les « flux », « `POST /api/salons/trame` » et « `quitter` » des tâches ci-dessous se lisent comme les messages et enregistrements du WebSocket. Serveur : `github.com/coder/websocket` (ISC, v1.8.x, version exacte épinglée à C-2, dernière stable depuis ≥ 7 jours, revue `supply-chain-risk-auditor`), contrôle d'`Origin`, message d'accueil (jeton ‖ `depuis`) dans les 5 s, lecture limitée à 4 200 octets, pas de compression, ping WebSocket toutes les 20 s et fermeture à 45 s de silence, file d'envoi de 256 enregistrements et fermeture du client lent (raison 6), `0x0B` à la place du 429. Client : ping applicatif toutes les 15 s, reconnexion avec attente 0,5 à 8 s et gigue, `bufferedAmount` < 64 Kio, 20 trames non accusées au plus. CSP : `connect-src 'self' wss://{hôte}` testé sur WebKit. **Objectifs de latence** (banc `bench/salon-latency`) : livraison de bout en bout p95 < 300 ms sur un même continent, p95 côté serveur < 20 ms, ouverture p95 < 1 s, reconnexion p95 < 3 s.
- **C-1** : trame de contrôle `rotation` (« SHCR1 », `crypto_box_seal` de `K_maître_s'` à chaque `RK` restante, signée par le créateur), dérivations de la nouvelle invitation (spec §39.13.2) et leurs vecteurs ; rotation en attente jetée si le serveur ne confirme pas.
- **C-2** : route `POST /api/salons/exclure`, enregistrements `0x09` et `0x0A`, liste des jetons révoqués, **plancher de pièces** (spec §39.13.1b), reprise du siège par jeton, remplacement atomique de `access_v`, `proof_v`, `salt`, `kdf_*` ; plus de route `flux`, `trame`, `retirer` ni `quitter`.
- **C-3** : la page d'explication ajoute deux phrases (changement de clés, exclusion, spec §39.4 point 3 : sept phrases au lieu de cinq) ; `chat/net.ts` est le seul module à appeler `fetch` **et** `WebSocket` ; ~~module `chat/session.ts` : `sessionStorage` du salon (jeton, siège, clé courante, pseudonyme), mêmes règles d'effacement que l'octroi d'ouverture (spec §39.13.3, §41.4) ; `pagehide` n'envoie plus `quitter` (le siège reste 10 min).~~ **D41-24** : module `chat/session.ts` **en mémoire seulement** (jeton, siège, clé courante, pseudonyme, couleur ; aucun stockage) pour la reconnexion réseau automatique onglet ouvert ; rechargement → mot de passe redemandé ; place, pseudonyme et couleur réservés pendant la vie du salon, « hors ligne » chez les autres ; `pagehide` n'envoie pas `quitter`. Retour sur la même place après rechargement : à trancher (code de retour proposé, spec §39.13.3).
- **C-4** : boutons « Exclure » (créateur seulement), « Nouveau lien d'invitation », feuille « Nouvelle invitation », lignes « a été exclu du salon » et « est de retour ».
- **C-5** : les pièces sont **toujours** stockées chez nous ; aucun envoi direct, aucune branche `direct: true`.
- **C-6** : étape « Exclusion d'un participant » (ci-dessous).

**Contraintes propres au salon** (en plus des Global Constraints, qui s'appliquent toutes) :
- Rien du salon dans le stockage du navigateur (ni IndexedDB, ni `localStorage`, ni OPFS) : clés, pseudonymes, messages, « récents » des émojis vivent en mémoire de la page ; **exception** : l'entrée `S_gestion` du créateur dans `web/src/history/` (Task H), si la bascule est activée ; ~~et, depuis la v2.9, `chat/session.ts` (`sessionStorage` d'onglet…)~~ supprimé par D41-24 : test « aucun `sessionStorage` dans `web/src/chat/` » (`source-rules.test.ts`).
- Primitives : `crypto/room/*.ts` est le seul endroit qui appelle `sodium.*` hors d'Argon2id (`kdf.ts`) ; contrôlé par `source-rules.test.ts`. Les écrans n'importent que `web/src/index.ts` (`createRoom`, `joinRoom`, `RoomLink`).
- Réseau du salon : seul `web/src/chat/net.ts` appelle `fetch` **et `WebSocket`** (exception ajoutée à `source-rules.test.ts`, comme `account/session.ts`) ; jamais de jeton de membre, de `K_accès_s` ou de `S_gestion` dans une URL ; aucun `EventSource`, aucun `RTCPeerConnection` (pas de pair à pair, spec §41.3).
- Toute trame montante fait exactement 4 140 octets (test de sources : une seule fonction `sealFrame` construit les corps des messages `0x01` du WebSocket).
- Aucun contenu reçu (texte, pseudonyme, nom de fichier) n'est rendu autrement qu'en nœud texte.

### Task C-1 : Chiffrement et protocole du salon, vecteurs de test (spec §39.2, §39.4 points 4 et 5)

**Files:**
- Create: `web/src/crypto/room/keys.ts`, `keys.test.ts` (dérivations de §39.2.1), `web/src/crypto/room/chain.ts`, `chain.test.ts` (cliquet HMAC, clés sautées), `web/src/crypto/room/frame.ts`, `frame.test.ts` (trame de 4 140 octets, enveloppe extérieure, message signé), `web/src/crypto/room/epoch.ts`, `epoch.test.ts` (identité, clé de réception, distribution scellée, annonces), `web/src/crypto/room/vectors.json`, `web/scripts/room-vectors.mjs` (recalcul indépendant par `node:crypto`), `web/src/chat/payload.ts`, `payload.test.ts` (schéma strict de `M`), `web/src/chat/pseudo.ts`, `pseudo.test.ts`, `web/src/chat/palette.ts`, `palette.test.ts`, `web/src/chat/protocol.ts`, `protocol.test.ts` (machine d'un participant : époques, rotation, rattrapage), `web/src/chat/fuzz.test.ts`
- Modify: `web/src/transfer/link.ts`, `link.test.ts` (`ROOM_FRAGMENT`, `roomLink`, `parseLink` → `kind: "c"`), `web/src/app/link.ts` (`readLink(href, "c")`), `web/src/crypto/types.ts` (types marqués `KLienSalon`, `KAccesSalon`, `KPreuveSalon`), `web/src/index.ts` (exporte `roomLink` et les types seulement à ce stade), `web/src/source-rules.test.ts` (`sodium.` permis dans `crypto/kdf.ts` et `crypto/room/` seulement)

**Interfaces:**
```ts
// keys.ts (HKDF WebCrypto, sel vide, comme kdf.ts)
deriveRoomAccess(kLien): Promise<{ kAcces: KAccesSalon; vAcces: Uint8Array }>;          // "shhdrop/v2/salon/acces"
deriveRoomKeys(kLien, kMdp): Promise<{ kPreuve: KPreuveSalon; vPreuve; kTrame: Uint8Array /*32*/; tag: Uint8Array /*16*/ }>;
  // maitre = HKDF(kLien ‖ kMdp, ".../maitre") ; preuve = HKDF(maitre, ".../preuve") ; cle = HKDF(maitre, ".../cle")
  // trame = HKDF(cle, ".../trame") ; tag = HKDF(cle, ".../id", 16) ; maitre et cle mis à zéro
// chain.ts (libsodium crypto_auth_hmacsha256)
class SendChain { constructor(ck0: Uint8Array, epoch: number); next(): { i: number; mk: Uint8Array } }   // efface CK_i
class RecvChain { constructor(ck: Uint8Array, epoch: number, i0: number); keyFor(i: number, now: number): Uint8Array | null }
SKIP_MAX = 2000; SKIP_TTL_MS = 900_000;
// frame.ts
FRAME_LEN = 4140; OUTER_PLAIN = 4096; MSG_MAX = 3949;
sealFrame(kTrame, tag, outer: { type: 1 | 2; ik: Uint8Array; epoch: number; i: number; body: Uint8Array }): Uint8Array;  // "SHC1" ‖ nonce24 ‖ XChaCha20-Poly1305
openFrame(kTrame, tag, frame: Uint8Array): Outer;                        // FrameError("taille" | "magie" | "chiffre" | "longueur")
sealMessage(mk, ikSecret, tag, ikPub, epoch, i, m: Uint8Array): Uint8Array;  // nonce24 ‖ ct ‖ sig64
openMessage(mk, ikPub, tag, epoch, i, body): Uint8Array;                 // signature vérifiée AVANT le déchiffrement
// epoch.ts
newIdentity(): { pk: Uint8Array; sk: Uint8Array };                     // crypto_sign_keypair
newReceiveKey(): { pk; sk };                                           // crypto_box_keypair
sealSenderKey(ck0, epoch, tag, ikExp, ikDest, rkDest): Uint8Array;     // crypto_box_seal("SHCK1" ‖ tag ‖ ikExp ‖ ikDest ‖ epoch ‖ ck0)
openSenderKey(sealed, tag, ikExp, ikMe, rk: { pk; sk }): { ck0; epoch };
signControl(ikSk, json: Uint8Array): Uint8Array; verifyControl(ikPk, body): Uint8Array;   // JSON ‖ sig64
// protocol.ts
type RoomEvent = { k: "message"; from: Member; m: Payload; seq: number } | { k: "arrivee" | "depart"; member: Member }
  | { k: "trou" } | { k: "fin"; reason: "expire" | "detruit" } | { k: "pseudo_pris" };
createParticipant(deps: { kTrame; tag; now; random? }) → { onRecord(rec): RoomEvent[]; send(m: Payload): Uint8Array /*trame*/;
  announce(pseudo, color): Uint8Array; members(): Member[]; rotate(reason): Uint8Array[]; wipe(): void };
ROTATE_MSGS = 100; ROTATE_MS = 3_600_000; OLD_RK_KEEP_MS = 600_000; SEAT_IDLE_MS = 600_000;
// pseudo.ts, palette.ts
cleanPseudo(s): { ok: true; value: string; key: string } | { ok: false; why: "longueur" | "caracteres" | "ecritures" };
ROOM_COLORS = ["#5FE3B5","#7CC4FF","#B79CFF","#FF8FC7","#FF9A7A","#F2C46D","#D8E86A","#4FD8E0","#E0A8F0","#D9C3A0"];
nextColor(taken: number[]): number;                                    // plus petit indice libre
```

- [ ] **Step 1 : Vecteurs** : `web/scripts/room-vectors.mjs` (sans dépendance, `node:crypto` seulement) écrit `vectors.json` ; avec `K_lien` = 32 × `0x11` et, à la place de la sortie d'Argon2id, `K_mdp` = 32 × `0x22` :
  - `K_accès_s` = `43689b66439f29004d7c2d201f4f140512b5c7aaf62ee850787888202608d1d2` ;
  - `K_maître_s` = `65ada1cd561dc5bdb40046e9d6c6be22f4f2acc3249f7fa53c5b4705969b86d1` ;
  - `K_preuve_s` = `ed40b4c2fed848c29e776e8ffeb131ffa11a13fcd88d55d3c5bd189974d62239` ;
  - `K_salon` = `352239bbd3f6aa311009e41418db5f79aa6f28178a6a029c054c683598d528ac` ;
  - `K_trame` = `ff6707e94d7382dcfc87207443049ac0e7eea5bf030cd0407e80e4a398e1eb73` ;
  - `tag_salon` = `5b70bbeb8a16484773f2610b1de4cac3` ;
  - chaîne avec `CK_0` = octets `00 01 … 1f` : `MK_0` = `9b4c8120a4823a95f47cde17a244f4507244ee6e3957d1fab9fa29b44d3829b7`, `CK_1` = `4304c22c84a53755ab08ead8d97a8d429be5efa480682d7ad1da27f73e1fbe1d`, `MK_1` = `f7703c39dea9feb30cb6369304ad7b847b9aca58c1152af317aa78a91beddda1`, `CK_2` = `26fc86b9b1303ea2e66f53ed0f1de753407e5428caf5e440e6b51c48d4bd4949`, `MK_2` = `5d2042bf4c603cf3aa7194739ed08bc1c698a7ec7fb8e77d3ea2588c6fe78ce1` ;
  - XChaCha20-Poly1305 : vecteur A.3.1 de draft-irtf-cfrg-xchacha-03 (clé `80…9f`, nonce `404142…57`, texte « Ladies and Gentlemen of the class of '99… », données authentifiées `50515253c0c1c2c3c4c5c6c7`) ; Ed25519 : RFC 8032 §7.1, test 1 (message vide).
  Le script est relancé en CI et comparé au fichier commité (`node scripts/room-vectors.mjs --check`).
- [ ] **Step 2 : Tests qui échouent** :
  - `keys.test.ts` : les sept valeurs ci-dessus exactement ; `K_maître_s` et `K_salon` mis à zéro après usage (espion sur le tampon) ; étiquettes toutes préfixées `shhdrop/v2/salon/` et distinctes de celles des partages, du coffre et du compte (liste lue dans `kdf.ts`).
  - `chain.test.ts` : `MK_0`, `MK_1`, `MK_2` de Step 1 ; `CK_i` mis à zéro après `next()` ; `RecvChain.keyFor(5)` puis `keyFor(3)` rendent les bonnes clés (clés sautées) ; `keyFor(3)` une seconde fois → `null` (usage unique) ; saut de 2 001 → `null` et la chaîne reste utilisable ; clé sautée de plus de 15 min (horloge injectée) → `null`.
  - `frame.test.ts` : `sealFrame(...)`.length === 4 140 pour un corps de 0 et de 4 053 octets ; corps de 4 054 → `RangeError` ; `openFrame` d'une trame de 4 139 ou 4 141 octets → `FrameError("taille")` ; un bit inversé n'importe où → `FrameError("chiffre")` ; `tag` d'un autre salon → `chiffre` ; `long` > 4 053 dans un clair valide → `longueur` ; `sealMessage` avec `M` de 3 949 octets accepté, 3 950 → `RangeError` ; signature d'un autre `IK` → refus **sans** appel au déchiffrement (espion sur `crypto_aead_xchacha20poly1305_ietf_decrypt`) ; `epoch` ou `i` modifiés dans l'en-tête → refus ; vecteur XChaCha de Step 1.
  - `epoch.test.ts` : `openSenderKey` refuse un scellé destiné à un autre `IK_dest` (contrôle du clair « SHCK1 » ‖ … ), à un autre `tag`, ou ouvert avec une ancienne `RK` effacée ; Ed25519 RFC 8032 test 1.
  - `protocol.test.ts` (trois participants A, B, C simulés, horloge injectée, flux d'enregistrements fabriqué) : A envoie, B et C lisent ; C part (enregistrement 0x03) → A et B changent d'époque **avant** leur message suivant, et C, qui garde ses anciennes clés, ne déchiffre pas ce message (`openMessage` → `null`) ; C envoie une trame de contrôle « départ » signée avant de partir → A et B produisent `{ k: "depart", member }` avec le pseudonyme de l'annonce ; enregistrement 0x07 → état en ligne du siège mis à jour ; D arrive → D ne déchiffre aucun message d'avant (`k: "message"` absent pour les `seq` antérieurs) ; 100ᵉ message de A → nouvelle époque ; distribution à 9 destinataires → 1 trame de contrôle, à 19 (salon Pro, spec §38.8) → 2 trames (12 + 7) ; 60 min sans rotation → nouvelle époque au message suivant ; ancienne `RK` effacée 10 min après (tampon à zéro) ; annonce de B rejouée depuis le siège de C (`nonce_arrivée` différent) → ignorée ; deux annonces du même pseudonyme (clé NFKC égale) → la seconde dans l'ordre `seq` reçoit `pseudo_pris` ; enregistrement 0x04 → `trou` ; 0x05 → `fin` ; distribution manquée → trame « demande de clé » émise, puis rattrapage.
  - `pseudo.test.ts` : « Alice » ok ; « A » → `longueur` ; 25 graphèmes → `longueur` ; « Zoé-Lou » ok ; « Аlice » (А cyrillique U+0410 + latin) → `ecritures` ; « Борис » ok ; « Al‮ice » → nettoyé en « Alice » ; « Al​ice » → « Alice » ; « 🐱 » → `caracteres` ; `key("Alice")` === `key(" alice ")` === `key("ALICE")` ; `key("Ａｌｉｃｅ")` (pleine chasse) === `key("Alice")`.
  - `palette.test.ts` : 10 couleurs distinctes ; contraste ≥ 6,7:1 sur `#202533`, ≥ 4,5:1 sur `#0B0D12`, `#12151C`, `#191D27`, `#202533` (fonction `contrast` de `ui/contrast.ts`) ; `nextColor([0, 1, 3])` === 2 ; `nextColor([])` === 0.
  - `payload.test.ts` : schéma exact de `M` : `texte { k, id, t, ephemere? }`, `piece { k, id, piece, r, bucket, name, mime, size, vocal_ms?, ephemere? }`, `reaction { k, id, cible, emoji, on }`, `reponse { k, id, cible, extrait, t }`, `retrait { k, id, cible, seq }`, `ecrit { k, id }`, `lu { k, id, jusqu_a }`, `effacer_lu { k, id, cible }` ; clé inconnue, en double ou de casse différente → refus ; `t` de 2 001 graphèmes ou 3 501 octets → refus ; `emoji` hors de la liste → refus ; `extrait` > 140 graphèmes → refus ; bidi retirés de `t`.
  - `fuzz.test.ts` : graine fixe `0x5A11`, 10 000 trames mutées (bits, troncature, `long`, JSON) passées à `openFrame`, `onRecord` et `parsePayload` : seules des erreurs typées, aucun `RoomEvent` « message » hors d'une trame valide.
  - `link.test.ts` : `roomLink(origin, k)` === `${origin}/#c` + 43 caractères ; `parseLink` reconnaît `#c…` (44 caractères après `#`) → `kind: "c"` ; `#c` + 42 → incomplet ; un lien `#m…` n'est jamais pris pour `#c`.
- [ ] **Step 3 : Lancer** `npm test -- room chat link` → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §39.2 et §39.4 (points 4 et 5) ; aucune dépendance nouvelle ; tampons secrets mis à zéro (`sodium.memzero`) dès qu'ils ne servent plus.
- [ ] **Step 5 : Lancer** `npm test` (avec `tsc`) et `node scripts/room-vectors.mjs --check` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(salon): clés, cliquet par expéditeur, trames de taille unique, vecteurs de test » et push.

### Task C-2 : Serveur — relais en mémoire, sièges, pièces jointes, limites (spec §39.1, §39.3)

**Files:**
- Create: `server/internal/room/service.go`, `service_test.go` (création, entrée, sièges, fin de vie), `server/internal/room/relay.go`, `relay_test.go` (file bornée, flux, rattrapage), `server/internal/room/pieces.go`, `pieces_test.go`, `server/internal/room/store.go`, `store_test.go` (tables `salons`, `salon_pieces`), `server/internal/room/fuzz_test.go` (`FuzzTrame`, `FuzzFlux`), `server/internal/api/handlers_room.go`, `handlers_room_test.go`, `server/internal/room/seesnothing_test.go`
- Modify: `server/internal/config/config.go`, `config_test.go` (`SHH_SALONS` 0/1, `SHH_SALONS_MAX` = 200), `server/internal/api/api.go` (routes de spec §39.3.9), `server/internal/limits/*` (compteurs de spec §39.3.6), `server/internal/janitor/*` (salons expirés : fichiers des pièces puis lignes), `server/cmd/shhdrop/main.go` (`admin destroy -` reconnaît `#c`), test de sources de spec §36 S2 (`X-Shh-Membre`, `X-Shh-Piece`, `X-Shh-Access-New` en liste blanche), `server/internal/api/stats_test.go` (tables et `map` autorisées), `deploy/Caddyfile` (note pour le Plan 3 : mise à niveau WebSocket sur `/api/salons/ws`, en-têtes `Upgrade`, `Connection`, `Sec-WebSocket-*` en liste blanche), `server/go.mod` (`github.com/coder/websocket`)

**Interfaces:**
```go
const FrameLen = 4140; const Budget = 1 << 30; const QueueFrames = 200; const QueueTTL = 15 * time.Minute
const SeatIdle = 10 * time.Minute; const WSPing = 20 * time.Second; const WSDead = 45 * time.Second; const SendQueue = 256; const HelloWait = 5 * time.Second
const MaxWrongPasswords = 10; const MaxPieceBucket = 8000
type Service struct{ /* store, rooms map[id]*Room (mémoire), limits, blob, now */ }
func (s *Service) Create(conn limits.Key, access, manage [32]byte, p CreateParams) (expiresIn int64, err error)
func (s *Service) Meta(access [32]byte) (Meta, error)
func (s *Service) Join(conn limits.Key, access [32]byte, proof [32]byte) (Join, error)   // ErrBadPassword{Left}, ErrFull, ErrNotFound
func (s *Service) Post(token [32]byte, frame []byte) (seq uint64, err error)            // ErrBudget, ErrLimit
func (s *Service) Serve(ctx context.Context, conn *websocket.Conn) error   // accueil, messages 0x01 à 0x04, enregistrements, ping/pong, contre-pression (spec §39.3.1)
func (s *Service) Exclude(manage [32]byte, seat int, nonce [16]byte, r uint32, rot Rotation) error   // spec §39.13
func (s *Service) Retract(token [32]byte, seq uint64) error
func (s *Service) Leave(token [32]byte) error
func (s *Service) Destroy(byManage *[32]byte, byMember *[32]byte, report bool) error
func (s *Service) NewPiece(token [32]byte, bucket int) (pieceID [16]byte, uploadToken string, err error)
// enregistrements (spec §39.3.1) : 0x01 seq‖siège‖trame, 0x02 arrivée, 0x03 départ, 0x04 trou, 0x05 fin (raisons 1 à 6), 0x07 présence, 0x08 pong, 0x09 exclusion/rotation, 0x0A reprise, 0x0B limite, 0x0C budget
```
- [ ] **Step 1 : Tests qui échouent** (horloge injectée, `-race`) :
  - création : `ttl_hours` 3 → 400 ; `max_members` 1 ou 11 → 400 ; `expires_at` en base = ceil15(maintenant + ttl) ; aucune colonne de durée (lecture de `PRAGMA table_info(salons)` : exactement `id, access_v, manage_v, proof_v, salt, kdf_ops, kdf_mem, expires_at, max_members, members_can_destroy, failed_attempts, pieces_bytes`) ; 6ᵉ salon du jour par connexion → `limit` ; 201ᵉ salon vivant → 503 `busy` ; `SHH_SALONS=0` → 404 sur toutes les routes.
  - entrée : bonne preuve → siège 0, puis 1 ; `max_members` = 2 → troisième → 409 `full` ; 20 entrées concurrentes sur un salon à 10 places → exactement 10 sièges (`-race`) ; preuve fausse → `tries_left` 9, …, 10ᵉ → salon détruit (ligne et pièces absentes) ; `11 × max_members`ᵉ arrivée → `full` ; siège sans flux depuis 10 min → libéré, enregistrement 0x03 diffusé.
  - trames : message `0x01` de 4 139 ou 4 141 octets → fermeture sans rien relayer ; 4 140 → `seq` croissant, relayé à tous les flux du salon (y compris l'expéditeur) ; 61ᵉ trame de la minute du siège → enregistrement `0x0B` ; budget : après `floor(2^30 / 4140)` = 259 357 trames → la suivante `budget` ; 201ᵉ trame → la plus ancienne quitte la file ; `depuis` du message d'accueil plus ancien que la file → 0x04 puis la file ; trame de plus de 15 min oubliée.
  - WebSocket : accueil absent après 5 s → fermeture ; jeton faux → `4001` ; `Origin` étranger → 403 ; ouverture et fermeture d'un siège → 0x07 (état 1 puis 0) chez les autres ; ping du serveur toutes les 20 s, silence de 45 s → fermeture ; ping applicatif → `0x08` avec les mêmes 8 octets ; nouvelle connexion du même siège → l'ancienne reçoit 0x05 raison 4 ; **client qui ne lit plus → file de 256 pleine pendant 5 s → fermé avec 0x05 raison 6, sans ralentir les autres ni dépasser la mémoire bornée** ; 5ᵉ WebSocket de la connexion → 429 ; la trame est renvoyée à son expéditeur (accusé) ; **banc `bench/salon-latency` : p95 de bout en bout < 300 ms, p95 serveur < 20 ms** (10 clients, 1 message par seconde et par client, RTT simulé).
  - retrait : `retirer` d'une trame d'un autre siège → `{}` et la trame reste ; de la sienne → absente du rattrapage suivant.
  - fin : expiration → 0x05 raison 1 sur tous les flux, file vidée (mémoire relâchée : `rooms` sans l'entrée), fichiers des pièces effacés puis lignes ; `detruire` par `X-Shh-Manage` juste → 0x05 raison 2 ; par un membre avec `members_can_destroy` faux → 403 ; vrai → détruit ; `reason: "report"` → compteur horaire des signalements +1 ; `admin destroy -` avec un lien `#c` sur l'entrée standard → salon détruit, rien d'écrit.
  - pièces : palier 16 385 → 400 (`MaxPieceBucket`) ; palier 8 000 deux fois → la seconde réservée (1 048 832 096 octets), puis une troisième de palier 1 (65 600 octets) → acceptée seulement si `pieces_bytes + trames × 4 140 + 65 600 ≤ 2^30` ; segment hors palier ou de mauvaise taille refusé (mêmes tests que les partages) ; `GET` sans `X-Shh-Membre` valide → 404 ; budget de lecture 2 × fichier par membre et par pièce → 429 `budget` ; `pieces/retirer` par un autre siège → 404 ; octets utiles débités des quotas journaliers de spec §4.
  - redémarrage : sièges, files et jetons perdus ; salons et pièces `ready` gardés ; pièces `uploading` effacées.
  - `FuzzTrame` (corps arbitraires) et `FuzzFlux` (lecture d'enregistrements par le client de test) : aucune panique, aucune trame relayée hors de 4 140 octets.
- [ ] **Step 2 : `seesnothing_test.go`** (bloquant) : un salon, trois membres de test, trames opaques contenant des repères **en clair** volontairement (pour prouver que le serveur ne les écrit nulle part) ; IP, User-Agent, Referer repères ; exige : aucun repère dans `shares.db`, son WAL, `blobs/`, stdout, stderr ; aucune trame sur disque (recherche des 4 140 octets d'une trame dans tous les fichiers du dossier de données) ; après destruction et arrêt, aucun octet d'une pièce ; `sqlite_master` = `shares`, `salons`, `salon_pieces` et leurs index ; aucun journal ne contient de jeton, d'`id` ni de `seq`.
- [ ] **Step 3 : Lancer** `make test-go` → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §39.1, §39.3 ; `net/http` et `github.com/coder/websocket` (version exacte, ISC, §24) ; JSON strict (§8) ; erreurs uniformes ; réutiliser `blob/` et le code des segments des partages, sans copier.
- [ ] **Step 5 : Lancer** `make test-go` (avec `-race`, `GOARCH=386 go build ./...`), `govulncheck ./...`, `go test -fuzz=FuzzTrame -fuzztime=60s ./internal/room/` → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(salon): relais en mémoire, sièges plafonnés, pièces jointes, fin de vie » et push.

### Task C-3 : Création et entrée — accueil, création, salon prêt, mot de passe, explication et pseudonyme (spec §39.4, §39.6)

**Files:**
- Create: `web/src/chat/net.ts`, `net.test.ts` (seuls `fetch` et `WebSocket` du salon : routes de §39.3.9, WebSocket de §39.3.1), `web/src/chat/room.svelte.ts`, `room.test.ts` (`createRoom`, `joinRoom` : machine d'état), `web/src/routes/RoomNew.svelte` (`/salon/nouveau`), `web/src/routes/RoomJoin.svelte` (mot de passe, explication, pseudonyme), `web/src/ui/HomeRoomCard.svelte`, `web/ui-e2e/room-join.spec.ts`
- Modify: `web/src/index.ts` (exporte `createRoom`, `joinRoom`), `web/src/routes/Home.svelte` (bloc à part), `web/src/routes/Compose.svelte` et `web/src/flows/features.ts` (retrait de « Conversation (bientôt) » et de `CHAT_READY`), `web/src/routes/Ready.svelte` (variante salon), `web/src/app/router.svelte.ts` (`/salon/nouveau`, `/salon`, fragment `#c`), `web/src/history/store.ts` (`kind: "salon"`), `web/src/ui/Icon.ts` (`messages-square`), `web/src/demo/fake-server.ts` (routes du salon en mémoire), `web/src/source-rules.test.ts` (`fetch` permis dans `chat/net.ts`), `fr.ts`, `en.ts`

**Interfaces:**
```ts
createRoom(origin, opts: { ttlHours: 1 | 6 | 12 | 24; maxMembers: number | "ouvert"; membersCanDestroy: boolean; password: string; captcha }, net?)
  → Promise<{ link: string; manage: SGestion; password: string; expiresInS: number }>;   // "ouvert" → max_members 10
joinRoom(link, expectedOrigin, net?) → { state: "meta" | "inapp" | "locked" | "entering" | "pseudo" | "in" | "full" | "invalid"
  | "destroyed_by_password" | "error"; expiresInS; triesLeft?; taken: string[] /* clés des pseudonymes présents */;
  unlock(password): Promise<void>; choosePseudo(p): Promise<"ok" | "pris" | "invalide">; leave(): void };
```
- [ ] **Step 1 : Tests qui échouent** (`room.test.ts`, réseau simulé) : `createRoom` envoie `X-Shh-Access` et `X-Shh-Manage` en en-têtes, jamais `K_lien` ni le mot de passe (recherche d'octets dans tous les corps et en-têtes) ; corps exact `{ ttl_hours, max_members, members_can_destroy, salt, kdf_ops, kdf_mem, proof_v, captcha… }` ; « ouvert » → `max_members: 10` ; `joinRoom` : `meta` puis `unlock` ; 403 → `triesLeft` ; 409 → `full` ; `choosePseudo("alice")` quand « Alice » est présent → `pris` sans trame ; jeton de membre jamais dans une URL (espion sur `fetch`) ; `leave()` (message `0x03`) appelé par le bouton « Quitter » seulement ; `pagehide` ferme sans libérer le siège (reconnexion par jeton pendant 10 min, spec §39.13.3).
- [ ] **Step 2 : e2e qui échouent** (`room-join.spec.ts`, vrai serveur, deux contextes) : accueil → bouton « Créer un salon de discussion » visible sans défilement à 1280 × 800 et à 390 × 844, dans un bloc distinct du réceptacle (aucun ancêtre commun plus proche que `main`) ; création 24 h, ouvert, mot de passe généré de 10 caractères → « Salon prêt » : lien de 65 caractères commençant par `${origin}/#c`, mot de passe, rappel « autre moyen », « Entrer dans le salon » ; second contexte : lien → `location.hash === ""` après lecture → texte « On vous invite dans un salon de discussion chiffré » → mot de passe faux → « 9 essais restants » → bon → page « Un salon qui s'efface » avec les phrases de spec §39.4 (point 3, **dont celle du changement de clés** : « Votre salon change de clés de chiffrement toutes les 100 messages, toutes les heures et à chaque arrivée ou départ. C'est automatique et invisible : cela ne limite ni le nombre de messages, ni la durée de la conversation. », et celle de l'exclusion) mot pour mot → pseudonyme « A » → message de longueur ; « Alice » pris par le créateur → « Déjà pris dans ce salon » ; « Bob » → salon ; plafond 2 et troisième contexte → « Ce salon est complet » ; « Conversation (bientôt) » absent du composeur ; démo : parcours complet avec le faux serveur ; `axe` ; captures `room-home`, `room-new`, `room-ready`, `room-password`, `room-pseudo` (ordinateur et téléphone).
- [ ] **Step 3 : Lancer** `npm test -- chat && npx playwright test room-join` → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §39.4 et §39.6 (accueil, création, salon prêt) ; réutiliser `PasswordField`, `CopyField`, `QrCode`, `Countdown`, l'écran d'ouverture (Task 20) et son avertissement du navigateur intégré.
- [ ] **Step 5 : Lancer** `npm test && make test-ui` puis la commande démo → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(salon): création, lien prêt, mot de passe, explication et pseudonyme » et push.

### Task C-4 : Écran du salon — messages, couleurs, « écrit… », arrivées et départs, en-tête, émojis, réponses, réactions (spec §39.3.7, §39.5, §39.6)

**Files:**
- Create: `web/src/routes/Room.svelte` (`/salon`), `web/src/ui/chat/MessageList.svelte`, `Bubble.svelte`, `Composer.svelte`, `EmojiPicker.svelte`, `Participants.svelte`, `TypingLine.svelte`, `RoomHeader.svelte`, `web/src/chat/emoji-data.ts` (généré), `web/scripts/gen-emoji.mjs`, `web/scripts/unicode/emoji-test-15.0.txt` (source commitée, empreinte SHA-256 vérifiée par le script), `web/src/chat/view.svelte.ts`, `view.test.ts` (liste, regroupement des annonces, extraits, retraits), `web/src/chat/linkify.ts`, `linkify.test.ts`, `web/src/chat/typing.ts`, `typing.test.ts`, `web/ui-e2e/room-chat.spec.ts`
- Modify: `web/src/chat/room.svelte.ts` (envoi, réception, réglage « Accusés de lecture » ; « écrit » toujours actif, sans réglage), `THIRD_PARTY_LICENSES.md` (données Unicode, licence Unicode v3), `fr.ts`, `en.ts`

**Interfaces:**
```ts
linkify(text): ({ t: "text"; v: string } | { t: "link"; href: string; v: string })[];   // https?:// seulement, adresse affichée entière
TYPING_TICK_MS = 2_500;
typingSender(deps: { now /* monotone */; joinedAt; send }) → { keystroke(): void; stop(): void };
  // trame `ecrit` seulement aux tops joinedAt + k × 2 500 ms qui suivent au moins une frappe ; jamais d'arrêt ; aucun réglage pour le couper
presenceLine(ev: { k: "arrivee" | "depart"; pseudo: string }): string;   // « Léa a rejoint le salon » / « Léa a quitté le salon »
headerText(online: number, seats: number, max: number): string;           // « 3 en ligne · 2 places libres »
TYPING_SHOW_MS = 6_000; TEXT_MAX_GRAPHEMES = 2000; TEXT_MAX_BYTES = 3500; EXCERPT_MAX = 140;
EMOJI: { group: string; list: { e: string; tone: boolean }[] }[];   // 9 groupes, émoji 15.0 pleinement qualifiés, sans variantes de ton
announcer(deps: { now; live }) → { push(from, text) };          // > 3 en 2 s → « N nouveaux messages »
```
- [ ] **Step 1 : Tests qui échouent** : `linkify("voir https://exemple.fr/a?b et javascript:alert(1)")` → un seul lien, `href` = `https://exemple.fr/a?b` ; `ftp://`, `data:`, `javascript:` jamais liens ; `typingSender` (horloge injectée, `joinedAt` = 0) : frappes à 0,1 s, 1 s, 2 s, 7 s, 7,4 s → trames exactement à 2,5 s et 7,5 s (aucune à 5 s : pas de frappe entre 2,5 s et 5 s), et jamais deux trames dans le même intervalle ; aucune option ne le désactive (recherche de source : aucun réglage `typing` dans `room.svelte.ts`) ; `presenceLine` FR et EN ; `headerText(3, 3, 5)` === « 3 en ligne · 2 places libres », `headerText(2, 3, 10)` === « 2 en ligne · 7 places libres », `headerText(1, 1, 2)` === « 1 en ligne · 1 place libre » ; le pseudonyme d'une ligne système vient de l'annonce chiffrée (un enregistrement 0x03 seul, sans annonce connue, donne « Un participant a quitté le salon ») ; `view` : un `retrait` vide le message et tous les extraits qui le citent ; une réaction hors liste ignorée ; `announcer` : 5 messages en 1 s → une seule annonce « 5 nouveaux messages » ; `gen-emoji.mjs --check` : empreinte du fichier source et sortie identiques au commit ; texte de 2 001 graphèmes → proposition « Texte long : envoyer comme fichier ? ».
- [ ] **Step 2 : e2e qui échouent** (`room-chat.spec.ts`, trois contextes) : Alice, Bob, Chloé ; messages reçus dans le même ordre chez les trois ; couleurs : Alice `#5FE3B5`, Bob `#7CC4FF`, Chloé `#B79CFF` (ordre d'arrivée), pseudonyme écrit à côté de chaque bulle ; « Bob écrit… » visible chez Alice et Chloé moins de 3 s après la première frappe de Bob, sans aucun réglage, éteint 6 s après la dernière trame ; intervalles entre trames `ecrit` de Bob multiples de 2 500 ms (± 50 ms, horodatage des requêtes interceptées) ; arrivée de Chloé → ligne « Chloé a rejoint le salon » chez Alice et Bob, et aucune requête ni réponse en clair ne contient « Chloé » (interception) ; Chloé ferme sa page → « Chloé a quitté le salon » ; en-tête chez Alice avec plafond 5 : « 3 en ligne · 2 places libres » puis « 2 en ligne · 3 places libres » après le départ, et le compte à rebours diminue d'une seconde sous 5 min (horloge du navigateur avancée) ; corps de chaque `POST /api/salons/trame` = 4 140 octets (interception) ; émoji choisi dans le sélecteur → affiché tel quel, aucune requête d'image (interception : aucune requête hors de l'origine, aucune hors de `/api/`) ; réaction 👍 sur un message → compteur 1 chez les trois ; réponse → extrait affiché ; « Retirer » par Alice → « Message retiré » chez tous ; « Retirer » absent sur un message d'un autre ; texte `<img src=x onerror=alert(1)>` affiché littéralement, aucune boîte de dialogue ; lien `https://exemple.invalid` cliquable avec `rel="noopener noreferrer"`, aucune requête vers lui sans clic ; clavier seul : Tab vers la saisie, Entrée envoie (ordinateur), Maj+Entrée va à la ligne, `Échap` ferme le sélecteur et rend le focus ; `role="log"` présent ; `reducedMotion: "reduce"` → aucune animation d'entrée (`animationName === "none"`) ; `forcedColors: "active"` → pseudonymes lisibles ; 200 % → aucun débordement horizontal ; titre de l'onglet en arrière-plan « (2) Shhdrop » sans texte de message ; `axe` ; captures `room-desktop`, `room-mobile`, `room-emoji`, `room-typing`, `room-presence`.
- [ ] **Step 3 : Lancer** → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §39.3.7 (grille de 2,5 s), §39.5 (texte, émojis, réponses, réactions, retrait, lignes d'arrivée et de départ, en-tête « en ligne · places libres » et compte à rebours) et §39.6 (écran du salon, accessibilité) ; page d'explication : phrase « Les autres voient quand vous écrivez… » (spec §39.4).
- [ ] **Step 5 : Lancer** `npm test && make test-ui` puis la commande démo → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(salon): écran du salon, couleurs, émojis, réponses, réactions, retrait » et push.

### Task C-5 : Pièces jointes et messages vocaux (spec §39.2.5, §39.3.4, §39.5)

**Files:**
- Create: `web/src/chat/pieces.ts`, `pieces.test.ts` (scellement SHH2 d'un élément, envoi par segments, téléchargement, vérification du manifeste), `web/src/ui/chat/PieceBubble.svelte`, `VoiceBubble.svelte`, `BudgetGauge.svelte`, `web/ui-e2e/room-files.spec.ts`
- Modify: `web/src/chat/net.ts` (routes des pièces), `web/src/ui/chat/Composer.svelte` (joindre, glisser-déposer, coller, vocal), `web/src/media/recorder.ts` (option `maxMs` = 600 000 pour le salon), `fr.ts`, `en.ts`

**Interfaces:**
```ts
ROOM_BUDGET = 1_073_741_824; ROOM_PIECE_MAX_BUCKET = 8000; ROOM_PIECE_MAX_DATA = 524_222_464; AUTO_SHOW_MAX = 16 * 1048576;
fileCost(bucket: number): number;                      // 48 + bucket × 65 552
sendPiece(room, file: File | Blob, meta: { name; mime; vocalMs?; ephemere? }, onBytes, signal): Promise<"sent" | "budget" | "cancelled" | "failed">;
openPiece(room, msg: PiecePayload, onBytes, signal): Promise<Opened>;   // même Opened que les partages (safeName, previewKind, isRiskyFile)
```
- [ ] **Step 1 : Tests qui échouent** : `fileCost(1)` === 65 600, `fileCost(8000)` === 524 416 048, `fileCost(16385)` === 1 074 069 568 > `ROOM_BUDGET` → `budget` sans requête ; fichier de 524 222 465 octets → refusé (« 500 Mo au plus par fichier ») ; budget restant 100 000 octets et fichier de palier 16 (1 048 880 octets de chiffré) → `budget` avant tout envoi ; le message `piece` porte `r` (32 octets), `piece`, `bucket`, `name`, `mime`, `size` ; `R` n'apparaît dans aucune requête (recherche d'octets) ; nom ou taille du message différents du manifeste du paquet → `Error("corrompu")`, rien d'affiché ; `C_engagement` faux (pièce échangée par le serveur) → `corrompu` ; image de 10 Mio → affichée d'office, de 20 Mio → au clic ; nettoyage (Tasks 9a–9c) appelé avant le scellement ; `echec` → choix « Envoyer tel quel » / « Retirer » comme le composeur ; vocal arrêté à 10 min.
- [ ] **Step 2 : e2e qui échouent** (`room-files.spec.ts`, trois contextes) : Alice envoie un PDF de 5 Mio, une photo JPEG avec position GPS repère, une archive `.zip`, un `.exe` ; Bob : photo affichée sans position (`exiftool` absent : contrôle par l'analyseur de la Task 9a sur les octets reçus), PDF dans la visionneuse isolée (Task 22), `.zip` en téléchargement seul, `.exe` avec l'avertissement de `isRiskyFile` ; jauge « 6 Mo sur 1 Go » chez tous ; vocal de 3 s (faux micro) lu par `<audio>` chez Chloé ; « Retirer » d'une pièce → `GET` de ses segments → 404 ; glisser-déposer de 12 fichiers → 12 messages (aucune limite de nombre) ; budget simulé presque plein (serveur de test, `SHH_TEST_ROOM_BUDGET` = 10 Mio, lu seulement par le binaire de test) → « Le salon est plein : 1 Go atteint » ; `axe` ; captures `room-files`, `room-voice`.
- [ ] **Step 3 : Lancer** → ÉCHEC.
- [ ] **Step 4 : Implémenter** spec §39.2.5, §39.3.4, §39.5 (pièces, vocal, aperçu d'office, budget) en réutilisant `container.ts`, `transfer/upload.ts`, `viewers/*` et `media/recorder.ts`.
- [ ] **Step 5 : Lancer** `npm test && make test-ui` puis la commande démo → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(salon): pièces jointes de tout type, vocaux, budget de 1 Go » et push.

### Task C-6 : Fin de vie, lecture unique, signalement, coupures, exclusion d'un participant, finitions (spec §39.1, §39.5, §39.7, §39.8, §39.13)

**Files:**
- Create: `web/src/chat/endoflife.ts`, `endoflife.test.ts`, `web/src/ui/chat/EphemeralBubble.svelte`, `RoomEnd.svelte`, `RoomReport.svelte`, `web/ui-e2e/room-end.spec.ts`, `web/ui-e2e/room-sees-nothing.spec.ts`
- Modify: `web/src/routes/Room.svelte` (menu : Détruire, Signaler, Quitter ; notice de trou), `web/src/routes/History.svelte` (entrée « Salon » : Détruire par `S_gestion`), `web/src/routes/PageSecurite.svelte` (« Le salon de discussion » : §39.2.4 « ce que ce choix ne donne pas », §18.20 à §18.22), `web/src/routes/PageConfidentialite.svelte` (sièges en mémoire, pièces jointes, durées), pages CGU (usage illicite interdit), `fr.ts`, `en.ts`

**Interfaces:**
```ts
EPHEMERAL_SHOW_MS = 30_000;
destroyRoom(room, report: boolean): Promise<"destroyed" | "gone" | "forbidden" | "network">;
wipeRoom(room): void;   // clés à zéro (sodium.memzero), URL blob révoquées, liste vidée, flux coupé
```
- [ ] **Step 1 : Tests qui échouent** : message à lecture unique : affiché au clic, retiré après 30 s (horloge injectée) de la liste **et** de la mémoire de la vue, URL blob révoquée ; chez l'expéditeur, contenu remplacé dès l'envoi ; 0x05 raison 1 → `wipeRoom` puis écran « Le salon a expiré. Tout a été effacé du serveur. » ; raison 2 → « Le salon a été détruit. » ; `destroyRoom` par un membre sans droit → `forbidden`, bouton absent de l'écran ; `pagehide` → `wipeRoom` de la mémoire seulement (le `sessionStorage` du salon reste, le siège aussi pendant 10 min) ; 0x04 → notice « Des messages ont pu vous échapper pendant la coupure. » ; redémarrage du serveur simulé (jeton refusé) → nouvelle entrée automatique avec `K_preuve_s` gardée, nouvelle époque, sans redemander le mot de passe.
- [ ] **Step 2 : `room-sees-nothing.spec.ts`** (bloquant, comme le test du Plan 1) : parcours complet à trois contextes avec les repères de spec §39.8 (pseudonyme, texte, nom et contenu de fichier, vocal, émoji de réaction, mot de passe, `K_lien`) ; exige : aucun repère dans un corps ou un en-tête de requête (interception de toutes les requêtes des trois contextes), dans `shares.db`, son WAL, `blobs/`, stdout ni stderr du serveur ; chaque trame montante de 4 140 octets ; après destruction et arrêt, aucune ligne `salons` ni `salon_pieces`, dossier des pièces vide.
- [ ] **Step 3 : e2e qui échouent** (`room-end.spec.ts`, trois contextes) : créateur → « Détruire le salon » → confirmation sur place → les trois voient l'écran de fin avec la dissolution (Task 24), `fetch` du flux fermé ; « Signaler » : feuille avec les deux chemins de spec §39.5 et la phrase sur le mot de passe ; « Quitter et signaler » → `/healthz` local → `reports_alert` passe à vrai après le seuil ; coupure réseau de 30 s chez Bob (`context.setOffline`) pendant 5 messages → rattrapés sans notice ; coupure pendant 250 messages → notice de trou ; destruction depuis `/envois` du créateur → les membres voient la fin ; `axe` ; captures `room-end`, `room-report`, `room-ephemeral`.
- [ ] **Step 3b : Exclusion d'un participant et perte d'accès (spec §39.13, §41.1 D41-1)** — tests qui échouent d'abord, puis implémentation.
  - **Serveur (Go)** : `exclure` sans `S_gestion` ou avec un jeton de membre → 403 ; `nonce_arrivee` périmé → 409 `stale` ; l'exclu : WebSocket fermé `4002` avec `0x05` raison 5, siège libre, jeton en liste de révocation ; **toute requête de l'exclu est refusée** : `GET /api/salons/pieces/segments/{n}` avec l'ancien jeton et une pièce qu'il connaissait → 403 `excluded`, `POST /api/salons/pieces`, WebSocket et reconnexion → refusés ; **ancien `K_accès_s` → `not_found`** identique à un salon inconnu ; ancien mot de passe avec le nouveau lien → preuve fausse (compte dans les 10 essais) ; `access_v`, `proof_v`, `salt` remplacés en une transaction (panne simulée : tout ou rien) ; `0x09` émis une fois ; **plancher de pièces** : un jeton émis après l'exclusion qui demande une pièce antérieure → 404 uniforme, une pièce postérieure → servie ; un jeton plus ancien (membre resté) → servie ; `FuzzExclure`.
  - **Téléchargement en cours au moment de l'exclusion (v2.10, spec §39.13.6, §41.8 cas 3)** : serveur — un flux de pièce en cours (200 Mio, débit limité) est **coupé net** à l'exclusion (octets reçus < taille, connexion fermée), aucune grâce, les flux des autres membres intacts, `Streams` vide ensuite ; le client de l'exclu supprime le fichier partiel (`abort()` appelé, jamais `close()`) et exécute `wipeRoom` une fois. **Exclu de ce salon seulement** : le même contexte (même adresse, même navigateur) rejoint **un autre salon** avec sa nouvelle invitation sans refus, aucun compteur ni liste ne le distingue ; les compteurs « entrées de l'heure » et « salons du jour » ne bougent pas à cause de l'exclusion ; avec la nouvelle invitation du **même** salon il entre sous un autre pseudonyme (limite documentée, §39.13.4).
  - **Cryptographie (TS)** : après `0x09`, aucun expéditeur restant ne scelle de `CK_0` à la `RK` de l'exclu ; l'exclu avec toutes ses anciennes clés ne déchiffre aucune trame de rang > R ; la trame `rotation` n'est pas ouvrable par lui ; rotation en attente jetée si `exclure` échoue ; messages en vol renvoyés après rotation.
  - **Client de la personne exclue (unit + e2e)** : à `0x05` raison 5, à la fermeture `4002` ou à une réponse `excluded` : `wipeRoom` appelé une fois, **clés mises à zéro** (espion `sodium.memzero`), **URL blob révoquées** (toute URL blob créée pendant la session est invalide : `fetch(blobUrl)` échoue), lecteurs audio et vidéo arrêtés, liste de messages et brouillon vidés ; l'écran dit « Vous avez été exclu de ce salon. » ; **`sessionStorage` ne contient plus aucune clé ni aucun jeton** (`Object.keys(sessionStorage)` sans entrée du salon, valeur de `shh.room` absente) ; `document.body.innerText` ne contient ni message, ni pseudonyme, ni nom de fichier du salon ; bouton « Précédent » puis « Suivant » → rechargement, aucun contenu ; la reconnexion avec le jeton révoqué affiche le même écran et efface de nouveau.
  - **Les autres membres** : le créateur exclut Bob ; **Alice et le créateur continuent de discuter** (messages, « écrit… », une pièce jointe de 1 Mio) sans resaisie ; ~~Alice recharge → elle rentre par son jeton de membre, sans lien ni mot de passe, sans relire le passé~~ (D41-24) Alice perd le réseau puis le retrouve → reconnexion automatique sans mot de passe, « hors ligne » puis « de retour » chez les autres ; Alice recharge → le mot de passe est redemandé ; la ligne « Bob a été exclu du salon » est chez tous ; `axe`.
  - **Revenir avec l'ancienne invitation** : Bob avec l'ancien lien et l'ancien mot de passe → « Ce lien n'existe pas ou n'est plus disponible » (refusé) ; **une nouvelle invitation envoyée à Carole → elle entre** ; « Nouveau lien d'invitation » sans exclusion : l'ancien lien refusé, personne n'est sorti ; limite documentée (non « corrigée ») : Bob avec la **nouvelle** invitation entre sous un autre pseudonyme, sans pouvoir ouvrir les pièces antérieures.
  - **Honnêteté** : le texte de confirmation et celui de l'écran de l'exclu contiennent « garde ce qu'elle a déjà vu » ; aucun texte ne promet d'effacer des copies (scan des textes de confiance, Task 27).
  - **« Le serveur ne voit rien »** étendu : ni pseudonyme, ni `K_lien'`, ni `P'`, ni `K_maître_s'` dans une requête ou sur disque.
- [ ] **Step 4 : Implémenter** spec §39.1 (fin de vie), §39.13 (exclusion, rotation de l'invitation, perte d'accès), §39.5 (lecture unique, signalement), textes des pages Sécurité, Confidentialité et CGU ; ajouter les lignes du salon à la liste manuelle : iPhone et Android (vocal, photo de l'appareil, mise en veille puis retour, clavier qui ne masque pas la saisie), VoiceOver et TalkBack (annonces des nouveaux messages).
- [ ] **Step 5 : Lancer** `npm test && make test-go && make test-ui` puis la commande démo → SUCCÈS.
- [ ] **Step 6 : Commit** « feat(salon): fin de vie, lecture unique, signalement, rattrapage, le serveur ne voit rien étendu au salon » et push.

---

### Tasks D-1 et D-2 : envoi direct, pair à pair (spec §40) — **après la V1, optionnelles**

> **v2.9 (décision du propriétaire, 7 novembre) : aucun pair à pair par défaut, nulle part ; le salon passe toujours par notre serveur ; §40 est « plus tard, optionnel ».** Ces tâches sont déplacées **après la V1**, ne sont **pas** dans l'ordre d'exécution du Plan 2 et ne démarrent que sur décision écrite du propriétaire. Elles s'appuient sur le salon livré (C-1 à C-6) seulement si l'on rouvre §40.6, annulé pour l'instant.

Après la V1 et les Tasks C-1 à C-6. Prérequis : Q-D1 à Q-D3 (défauts de spec §40.9 sinon) ; `SHH_DIRECT=0` par défaut ; désactivé dans la démo (aucun serveur TURN). Revues : `golang-backend`, `golang-testing`, `supply-chain-risk-auditor` (pion/turn et ses dépendances `pion/stun`, `pion/transport`, `pion/dtls` éventuelle), `privacy-review` (adresses IP), `sharp-edges` (politique ICE). Global Constraints applicables, plus : aucun serveur ICE autre que les nôtres dans le code (test de sources sur `iceServers`) ; `iceTransportPolicy` vaut `"relay"` sauf accord explicite des deux côtés.

### Task D-1 : Serveur — partage direct, signalisation en mémoire, relais TURN (spec §40.3, §40.4, §40.5)

**Files:**
- Create: `server/internal/direct/signal.go`, `signal_test.go` (boîtes aux lettres, présence de l'expéditeur), `server/internal/direct/turncred.go`, `turncred_test.go`, `server/cmd/shhdrop-turn/main.go`, `turn_test.go`, `server/internal/api/handlers_direct.go`, `handlers_direct_test.go`, `server/internal/direct/fuzz_test.go` (`FuzzSignal`)
- Modify: `server/go.mod`, `go.sum` (`github.com/pion/turn/v4`, version exacte, MIT, dernière stable publiée depuis au moins 7 jours), `THIRD_PARTY_LICENSES.md`, `server/internal/share/*` (colonne `mode` : `stored` | `direct`, aucune réservation en direct, `unlock` → `sender_offline` sans rien consommer), `server/internal/store/*` (migration `mode`), `server/internal/config/config.go` (`SHH_DIRECT`, `SHH_TURN_SECRET` 32 octets en base64url, `SHH_TURN_URLS`), `server/internal/limits/*` (identifiants de l'heure, octets relayés du jour), test de sources de spec §36 S2

**Interfaces:**
```go
const SignalLen = 12 + 8192 + 16; // 8 220 octets : nonce ‖ 8 Kio chiffrés ‖ étiquette const MailboxMax = 32; const MailboxTTL = 10 * time.Minute
const TurnCredTTL = 600 * time.Second; const MaxServedOpens = 3
func IssueTurnCred(secret [32]byte, now time.Time, rnd io.Reader) (username, credential string) // username = échéance Unix ":" 22 car. ; credential = base64url(HMAC-SHA-256(secret, username))
func CheckTurnCred(secret [32]byte, now time.Time, username, credential string) bool             // hmac.Equal ; échéance dépassée → false
// shhdrop-turn : turn.NewServer avec AuthHandler (CheckTurnCred), RelayAddressGenerator qui refuse les pairs privés,
// LoggerFactory vers io.Discard, écoute UDP 3478 et TLS 5349
```
- [ ] **Step 1 : Tests qui échouent** : `mode: "direct"` → aucune réservation (`SHH_STORAGE_MAX` inchangé), aucun fichier dans `blobs/` après `finalize` ; `unlock` juste sans flux de l'expéditeur → `sender_offline`, `opens_left` et `failed_attempts` inchangés ; avec le flux → jeton de téléchargement ; signal de 8 219 ou 8 221 octets → 400 ; 33ᵉ message d'une ouverture → 429 ; boîte oubliée après 10 min et à la fin de l'ouverture (`done`) ; aucun signal sur disque (recherche des octets d'un signal repère dans tout le dossier de données) ; `IssueTurnCred` puis `CheckTurnCred` à t + 599 s → vrai, à t + 601 s → faux, `credential` modifié d'un caractère → faux ; 31ᵉ identifiant de l'heure → 429 ; `turn_test.go` : client `pion/turn` de test autorisé → allocation ; allocation puis permission vers `10.1.2.3`, `127.0.0.1`, `169.254.1.1`, `[fc00::1]`, `[::1]` → refusée ; relais entre deux clients de test : 10 Mio transmis à l'identique ; aucune écriture sur stdout ni stderr ; 5 Go relayés du jour atteints par connexion → nouvelle allocation refusée.
- [ ] **Step 2 : Lancer** `make test-go` → ÉCHEC.
- [ ] **Step 3 : Implémenter** spec §40.4 ; aucun journal ; erreurs uniformes ; `go test -fuzz=FuzzSignal -fuzztime=60s`.
- [ ] **Step 4 : Lancer** `make test-go` (avec `-race`, `GOARCH=386 go build ./...`), `govulncheck ./...` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(direct): partage direct, signalisation en mémoire, relais TURN (pion) » et push.

### Task D-2 : Client — WebRTC, option « Envoi direct », pièces directes du salon (spec §40.1 à §40.3, §40.6, §40.8)

**Files:**
- Create: `web/src/direct/peer.ts`, `peer.test.ts` (connexion, politique ICE, canal de segments, contre-pression), `web/src/direct/signal.ts`, `signal.test.ts` (chiffrement des SDP), `web/src/direct/serve.svelte.ts`, `serve.test.ts` (expéditeur qui sert jusqu'à 3 ouvertures), `web/ui-e2e/direct.spec.ts`, `web/ui-e2e/direct-sees-nothing.spec.ts`, `web/ui-e2e/turn-server.ts` (lance `shhdrop-turn` dans le banc)
- Modify: `web/src/crypto/kdf.ts` (« shhdrop/v2/direct/signal »), `web/src/index.ts` (`createShare(..., { mode: "direct" })`, `openShare` accepte une source de segments directe), `web/src/routes/Compose.svelte` et options (« Envoi direct », « Connexion directe (plus rapide) »), `web/src/routes/Ready.svelte` (« Gardez cette page ouverte jusqu'à la fin », état des ouvertures servies), `web/src/routes/Open.svelte` (« L'expéditeur n'est pas connecté », accord pour la connexion directe), `web/src/chat/pieces.ts` (pièce directe si ≤ 4 destinataires en ligne, bascule stockée après 30 s), `web/src/source-rules.test.ts` (`RTCPeerConnection` permis dans `direct/` seulement ; `iceServers` construits seulement depuis la réponse de `/api/direct/turn`), `fr.ts`, `en.ts`

**Interfaces:**
```ts
SIGNAL_PAD = 8192; DIRECT_ROOM_MAX_PEERS = 4; DIRECT_ROOM_FALLBACK_MS = 30_000;
iceConfig(turn: TurnCred, directAgreed: { sender: boolean; receiver: boolean }): RTCConfiguration;
  // iceTransportPolicy "all" seulement si les deux sont vrais ; sinon "relay" ; iceServers = turn.urls seulement
sealSignal(kSig, id, openNo, dir: "s2r" | "r2s", msg: object): Promise<Uint8Array>;   // AES-256-GCM, 8 192 + 12 + 16 octets ; refuse un SDP > 8 192 − 4
openSignal(kSig, id, openNo, dir, bytes): Promise<object>;
segmentChannel(pc, opts: { bufferedLow: 1 << 20 }) → { send(n, bytes): Promise<void>; onSegment(cb) };
```
- [ ] **Step 1 : Tests qui échouent** : `iceConfig(c, { sender: true, receiver: false }).iceTransportPolicy` === `"relay"`, `{ true, true }` → `"all"`, `{ false, true }` → `"relay"` ; `iceServers` ne contient que les URL reçues (aucune `stun:stun.l.google.com`) ; `sealSignal` rend toujours 8 220 octets ; `openSignal` avec un autre `openNo` ou un autre sens → refus ; SDP de l'expéditeur avec l'empreinte DTLS modifiée en route → refus (authentification) ; l'expéditeur envoie aussi les segments de bourrage (nombre de segments envoyés = `segmentCount(bucket)`) ; contre-pression : jamais plus de 16 Mio en attente dans `bufferedAmount` ; fermeture du canal en cours → `writable.abort()` chez le destinataire, jamais « Enregistré » ; `navigator.wakeLock.request("screen")` demandé pendant le service, relâché à la fin.
- [ ] **Step 2 : e2e qui échouent** (`direct.spec.ts`, Chromium, deux contextes, `shhdrop-turn` de test) : envoi direct d'un fichier de 50 Mio → ouverture dans l'autre contexte → SHA-256 identique ; `getStats` : paire de candidats `relay` des deux côtés ; `blobs/` vide pendant et après ; expéditeur fermé avant l'ouverture → « L'expéditeur n'est pas connecté pour l'instant », ouvertures inchangées (`manage/status`) ; « Connexion directe » acceptée des deux côtés → paire `host` ou `srflx` permise ; acceptée d'un seul côté → `relay` ; salon : 3 membres en ligne, pièce de 20 Mio → reçue en direct (aucun `POST /api/salons/pieces`), 6 membres → pièce stockée ; un membre hors ligne 30 s → bascule stockée pour lui seul ; `axe` ; captures `direct-ready`, `direct-open`, `direct-consent`. WebKit : à la liste manuelle si TURN indisponible dans le banc.
- [ ] **Step 3 : `direct-sees-nothing.spec.ts`** (bloquant) : repères de contenu, de nom, de mot de passe, `K_lien` et une empreinte DTLS repère ; exige : aucun repère dans un corps reçu par le serveur ou par `shhdrop-turn` en clair (le relais ne voit que du DTLS : recherche dans les octets relayés), ni sur disque, stdout, stderr ; aucun SDP en clair dans une requête.
- [ ] **Step 4 : Implémenter** spec §40.1 à §40.3 et §40.6 ; textes honnêtes de §40.1 (en ligne, adresses, arrière-plan du téléphone).
- [ ] **Step 5 : Lancer** `npm test && make test-go && make test-ui` → SUCCÈS (démo : option masquée, test).
- [ ] **Step 6 : Commit** « feat(direct): envoi direct par WebRTC, relais par défaut, pièces directes du salon » et push.

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
- [ ] **M5.** Les chiffres de la page (24 h au plus, 15 au plus, 5 essais, 2 Go) viennent des constantes, pas du texte. *Contrôle* : changer une constante change la page (test unitaire).
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
- [ ] **M3, M9, M6, signatures S1 à S5 dans le parcours.** Le parcours complet vérifie : coches dans l'ordre (M3, avec envoi anticipé) ; phrase d'avertissement avant ouverture, compteur inchangé au rechargement avant déverrouillage **et après** (octroi d'ouverture, M9, v2.9) ; `data-state` de la capsule : `sealing` → `sealed` → `locked` → `open` → `destroyed` (M6) ; fiche du serveur sans nom, sans texte, sans clé (S1) ; deux cartes séparées et mode dictée (S2, S5) ; contour de temps mis à jour à la minute (S3) ; reçu de destruction après la réponse (S4). *Contrôle* : les assertions sont dans `full.spec.ts` ; chaque motif a au moins une assertion nommée par son numéro dans le titre du test.
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
- [ ] **Annexe du plan.** *Contrôle* : `grep -c "Apports de l'étude des concurrents\*\*" docs/superpowers/plans/2026-11-04-shhdrop-ecrans.md` renvoie 32 (une par tâche listée, Task R2 comprise) et l'annexe contient 18 lignes de motifs et 5 lignes de signatures.

---

### Tasks P1 à P3 : offre payante facultative (spec §38) — **après la mise en ligne de la V1**

> **v2.8** : deux formules, Plus et Pro (spec §38.8 : limites, prix proposés, modèle de coûts) ; deux clés d'émission de jetons, une par formule ; les limites Plus et Pro des salons (spec §39.11) s'ajoutent à la Task P2 ; **v2.9** : Plus 10 Go / 50 éléments / 7 jours, Pro 50 Go / 200 éléments / 30 jours, prix Plus 7 € et 70 €, Pro 20 € et 220 € (spec §38.8, Q-P8) ; plus de relais d'envoi direct. Prix : Q-P8. **v2.10 (7 novembre)** : durée maximale du Pro **7 jours** (comme Plus) et **éléments illimités** (50 Gio au total, manifeste découpé, Task P5) ; compte à rebours à la première ouverture (Task P4) ; onze fonctions payantes (Tasks F0 à F11, spec §38.9) ; le pass de 30 jours, lui, reste de 30 jours.

**Bloquées** tant que le propriétaire n'a pas tranché Q-P1 (moyen de paiement), Q-P2 (exception crypto pour Privacy Pass), Q-P5 (statut juridique), et que le juriste et le comptable n'ont pas validé spec §38.5. La fonction « Demander des fichiers » (Q-P6) est spécifiée en spec §38.9.3 (v2.10) : Task F1. Ces tâches ne font pas partie du Plan 2 livrable ; elles sont écrites ici pour que le reste du code ne les rende pas impossibles (aucune dépendance de V1 sur elles). Revues : `golang-backend`, `constant-time-analysis`, `supply-chain-risk-auditor` (circl, blindrsa-ts), `privacy-review`, `sharp-edges`.

### Task P0 : Étude de prix et de marché avant l'ouverture des ventes (spec §38.8, D41-32)

**Bloque P1 à P3.** Ajoutée le 9 novembre (retours UI6, décision du propriétaire). Rien n'est codé.

- [ ] **Step 1 : Concurrents** : relever, sur leurs pages publiques et à date, les prix mensuels et annuels, la taille par partage, la durée, le nombre d'ouvertures et les façons de payer (unique ou abonnement, résiliation) des services de partage chiffré comparables ; sources et dates notées.
- [ ] **Step 2 : Coûts réels** : refaire le modèle de spec §38.8.3 avec l'hébergeur et le vendeur officiel choisis (sortie par To, stockage, frais par paiement, TVA), y compris le renouvellement automatique (frais récurrents, échecs de paiement).
- [ ] **Step 3 : Décision** : présenter au propriétaire les prix proposés (dont le Pro annuel à 200 €, marge 57,7 %, sous la cible de 60 %), les marges et les risques ; il tranche Q-P8 ; spec §38.8.2 et `web/src/limits.ts` (`PAID`) mis à jour en conséquence, tests compris.
- [ ] **Step 4 : Commit** « docs(offre): étude de prix et de marché » et push.

### Task P1 : Droit d'usage — pass, webhook du vendeur, jetons Privacy Pass (spec §38.4)

**Files:**
- Create: `server/internal/pass/store.go` (`passes.db` : `passes(q, valid_until_day, tokens_left)`, `spent(token_hash)`), `store_test.go`, `server/internal/pass/issuer.go`, `issuer_test.go` (RFC 9474 et 9578 par `github.com/cloudflare/circl/blindsign/blindrsa`), `server/internal/pass/webhook.go`, `webhook_test.go` (signature du vendeur choisi, rejouage refusé), `web/src/premium/pass.ts`, `pass.test.ts`, `web/src/premium/tokens.ts`, `tokens.test.ts` (`@cloudflare/blindrsa-ts`, ou la variante minimale si Q-P2 est refusée)
- Modify: `go.mod`, `package.json` (versions exactes, ≥ 7 jours, spec §24), `THIRD_PARTY_LICENSES.md`, `CLAUDE.md` **seulement si le propriétaire valide l'exception Q-P2** (commit séparé, de sa main ou sur son accord écrit), `web/src/source-rules.test.ts` (`premium/` seul à manipuler `P` et les jetons)

- [ ] **Step 1 : Tests qui échouent** : vecteurs de test officiels des RFC 9474 (annexe) et 9578 passent côté Go et côté navigateur ; un jeton émis puis présenté → accepté une fois, refusé la seconde (`spent`) ; jeton d'une clé d'époque expirée → refus ; deux jetons d'un même pass présentés : le serveur ne peut pas les relier (aucune donnée de pass dans `spent` ni dans `shares.db`, recherche d'octets) ; webhook non signé, rejoué ou de montant inconnu → refus ; remboursement → ligne supprimée ; `tokens_left` épuisé → refus d'émission ; aucune référence de commande, aucun e-mail, aucune adresse dans `passes.db` ; la clé publique d'émission apparaît dans le manifeste de version signé (Task C1) ; « le serveur ne voit rien » : `P` jamais dans une requête de partage, `Q` jamais dans `shares.db` ni `accounts.db`.
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter** spec §38.4. **Step 4 : Lancer** `make test-go`, `npm test`, `govulncheck`, `npm audit` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(premium): pass prépayé et jetons aveugles Privacy Pass » et push.

### Task P2 : Limites Plus côté serveur (spec §38.2, §38.6)

**Files:**
- Modify: `server/internal/share/*` (paliers 5, 10, 20 et 50 Gio, + morceau du manifeste ; éléments : **limites du composeur seulement** (le serveur ne les voit pas, spec §38.9.2), 50 (Plus) et illimité jusqu'à 50 000 (Pro, Task P5) ; durées 2, 3, 7 j (**Plus et Pro**, v2.10 : le Pro n'a plus 30 j ni 14 j) ; ouvertures jusqu'à 50 sous 100 Go (Plus) et 100 sous 250 Go (Pro) ; liens par pass 30 et 100 ; jetons d'envoi de 24 h ; échéance personnalisée arrondie au quart d'heure), `server/internal/limits/*` (octets Plus du jour, spec §9.5), `server/internal/config/config.go` (`SHH_STORAGE_PLUS_MAX`), `web/src/crypto/container.ts` (paliers Plus, palier canonique toujours vérifié), tests associés

- [ ] **Step 1 : Tests qui échouent** : sans jeton, toute valeur hors limites gratuites → 400 identique à aujourd'hui ; avec jeton valide : Plus : 10 Gio et 7 j acceptés, 10 Gio et 14 j refusés, 10 Gio et 11 ouvertures refusés (sous 100 Go) ; Pro : 50 Gio et 7 j acceptés, 50 Gio et 14 j refusés, 20 Gio et 30 j refusés (**durée maximale 7 j pour Plus et Pro**) ; limites d'éléments testées **côté composeur** (51ᵉ élément refusé pour Plus, 50 000 pour le Pro, Task P5) et **aucun test serveur d'éléments** ; réserve Plus pleine → 503 « busy » sans toucher à la réserve gratuite ; quota Plus par connexion et par /48 ; budget de lecture de spec §24 inchangé (2 × le palier) ; palier canonique côté client pour 5, 10, 20 et 50 Gio ; aucune colonne nouvelle dans `shares` qui porte le jeton ou le pass ; « le serveur ne voit rien » vert avec un partage Plus.
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter.** **Step 4 : Lancer** → SUCCÈS. **Step 5 : Commit** « feat(premium): limites Plus, réserve de stockage séparée » et push.

### Task P3 : Écrans — page `/offre`, achat, pass, limites atteintes (spec §38.1, §38.2)

**Files:**
- Create: `web/src/routes/Offer.svelte` (`/offre`), `web/src/routes/PassKey.svelte` (affichage unique de `P`, Copier, Télécharger, Ranger dans mon compte), `web/src/routes/PageCGV.svelte`, `web/ui-e2e/offer.spec.ts`
- Modify: `web/src/routes/Compose.svelte` et `Options.svelte` (choix Plus visibles seulement avec un pass ; ligne neutre « Au-delà de 2 Go : offre Plus, facultative » à la limite), `web/src/ui/AppShell.svelte` (lien de pied de page « Offre Plus »), `web/src/routes/PageConfidentialite.svelte` (vendeur officiel, ce qu'il voit), `web/src/i18n/*`

- [ ] **Step 1 : Tests qui échouent** (e2e, faux vendeur en mémoire) : tableau gratuit / Plus de spec §38.2 affiché tel quel, prix TTC, durée et « rien n'est prélevé à la fin » ; case de renoncement à la rétractation **non cochée** par défaut et obligatoire pour l'usage immédiat ; aucun compte à rebours, prix barré, case précochée ni mot de rareté (balayage de motifs interdits) ; pages d'ouverture, de contenu et du coffre : aucune mention de l'offre (balayage du texte) ; la Task 28 (« aucune offre ») reste vraie partout sauf `/offre`, le lien de pied de page et la ligne de limite, exceptions listées dans le fichier de décisions ; aucune ressource du vendeur chargée sur une page qui détient des clés : le paiement se fait par redirection vers le site du vendeur, depuis `/offre` seulement (aucune clé en mémoire sur cette page, test) ; `axe` ; captures `offer`, `pass-key`.
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter**, textes relus par le juriste (CGV, rétractation, médiateur). **Step 4 : Lancer** `make test-ui` et la démo (offre absente de la démo) → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(premium): page Offre Plus, pass, CGV » et push.

### Task P4 : Départ du compte à rebours à la première ouverture, plafond de 7 jours (spec §38.9.1, §41.9 ; UI §9.3.1, §9.7.2) — **après la V1, Plus et Pro**

**Files:**
- Create: `server/internal/share/firstopen.go`, `firstopen_test.go`, `web/src/premium/startmode.ts`, `startmode.test.ts`, `web/ui-e2e/first-open.spec.ts`
- Modify: `server/internal/store/store.go` (colonnes `starts_on_first_open`, `hard_expires_at`, `tier`), `server/internal/share/service.go` (`finalize`, `unlock`, nettoyeur), `server/internal/api/handlers_share.go` (`meta` : `starts_on_open`, `duration_s`, `seconds_left` ; `manage/status` : `started`), `web/src/routes/Options.svelte` (`Segmented` « Le compte à rebours démarre… »), `web/src/routes/Open.svelte` (état « pas encore démarré »), `web/src/i18n/*`, faux serveur de la démo

- [ ] **Step 1 : Tests qui échouent (Go, horloge injectée).**
  - Sans jeton Plus ou Pro valide, `starts_on_first_open` → 400 `bad_request` identique à une valeur invalide.
  - `finalize` d'un partage Plus en mode « première ouverture » : `hard_expires_at` = création + 7 j **arrondi au quart d'heure inférieur** (jamais au-delà de 7 j, test aux bornes : création à 10:07:59 → plafond 10:00 sept jours plus tard), `expires_at` = `hard_expires_at`, `ttl_hours` non nul.
  - Premier `unlock` réussi à J+1 avec `ttl` 24 h → `expires_at` = ceil15(J+1 + 24 h) et `ttl_hours = NULL` ; à J+6,5 avec 3 j → `expires_at` = `hard_expires_at` ; **invariant** `expires_at ≤ hard_expires_at` vérifié après chaque opération d'un test de propriétés.
  - Mot de passe faux, `meta`, pré-lecture, page de gestion : **aucun départ**. `unlock` avec octroi (§41.4) : aucun changement d'`expires_at`.
  - Deux `unlock` simultanés (`-race`, 50 goroutines) : une seule mise à jour, `expires_at` identique pour tous, `opens_issued` correct.
  - Jamais ouvert : à `hard_expires_at` le nettoyeur efface le partage (fichier compris) ; avant : intact.
  - `meta` : `starts_on_open`, `duration_s`, `seconds_left` jusqu'au plafond ; après le départ, `duration_s` absent.
  - Partage Plus **sans** le mode : `ttl_hours` à `NULL` après `finalize` (S11), `hard_expires_at` présent ; partage gratuit : `NULL`.
  - « Le serveur ne voit rien » étendu : base d'un partage « première ouverture » ouvert : aucune heure de première ouverture n'est récupérable (aucune colonne ne la porte) ; dates de la base multiples de 900 s.
- [ ] **Step 2 : Tests client et e2e qui échouent** : `Segmented` visible seulement avec un pass, absent sans ; la phrase de plafond affiche la date exacte (horloge injectée) ; durée > plafond restante → corrigée avec une phrase ; destinataire : « Ce lien disparaît 24 h après sa première ouverture, et au plus tard dans 6 j 3 h » puis compte à rebours normal après déverrouillage ; e2e : envoi en mode « première ouverture », avance du temps de 5 jours sans ouverture → toujours disponible, 7 jours → « Lien invalide » ; aucune mention de l'offre côté destinataire (balayage) ; `axe`.
- [ ] **Step 3 : Lancer** → ÉCHEC. **Step 4 : Implémenter** spec §38.9.1 (migration de la base : trois colonnes, `secure_delete`). **Step 5 : Lancer** `make test && make test-ui` → SUCCÈS.
- [ ] **Step 6 : Mettre à jour** spec §36 S48, S49 (état « Fait ») avec le commit. **Step 7 : Commit** « feat(premium): compte à rebours à la première ouverture, plafond de 7 jours » et push.

### Task P5 : Pro illimité — manifeste découpé, index et segments de manifeste (spec §38.9.2, §41.10 ; UI §9.14.1) — **ABANDONNÉE (7 novembre, spec D41-17)**

> **Abandonnée** : le propriétaire a décidé que le nombre d'éléments n'est plus un critère de formule (une archive .zip contourne toute limite de nombre). Toutes les formules ont la même borne technique de 200 éléments (`MAX_ITEMS`, un manifeste d'un morceau) ; le manifeste découpé, la version 3 de l'en-tête et la liste virtualisée ne sont pas construits. Le texte ci-dessous est gardé pour mémoire.

**Files:**
- Create: `web/src/crypto/manifest-v3.ts`, `manifest-v3.test.ts`, `manifest-v3.vectors.json`, `web/src/ui/VirtualList.svelte`, `web/ui-e2e/many-items.spec.ts`
- Modify: `web/src/crypto/container.ts` (version 3, palier canonique v3), `web/src/transfer/readorder.ts` (ordre : fin, pages restantes croissantes, données), `web/src/transfer/prefetch.ts`, `web/src/flows/compose.ts` (limites par niveau, `ITEMS_PRO_TECH_MAX` = 50 000), `web/src/ui/Gallery.svelte`, `web/src/i18n/*` (« illimité (50 Go au total) »)

- [ ] **Step 1 : Tests qui échouent (aucune cryptographie nouvelle).**
  - Manifeste de 1 élément, 200, 201, 1 000, 50 000 : au-delà de `MANIFEST_MAX`, **version 3** ; en dessous, version 2 **octet pour octet identique** à la sortie actuelle (vecteurs existants rejoués).
  - Aller-retour : `chiffrer → déchiffrer` rend les mêmes éléments, ordre compris ; pages de 64 Kio exactes ; **règle de découpage déterministe** (même entrée → mêmes pages, vecteurs figés) ; palier canonique v3 = plus petit palier de capacité ≥ données + (k + 1) morceaux, vérifié à l'ouverture (palier trop grand ou trop petit → paquet corrompu).
  - Attaques : page retirée, dupliquée, échangée avec une autre, déplacée, tronquée ; index modifié (`k`, total, plages) ; plages non contiguës ou en désordre ; page avec un nombre d'éléments différent de l'index ; version 3 changée en 2 et inverse ; nonces : aucun numéro de morceau chiffré deux fois (espion `crypto.subtle.encrypt`) ; **chaque cas échoue de façon fermée** (`CorruptError`), jamais d'élément partiel affiché.
  - Lecture : `planReads` rend `fin, pages…, données` avec **un seul retour en arrière**, identique quelle que soit la sélection de l'utilisateur (test S9 amendé) ; budget de lecture de §24 respecté (2 × le paquet) ; pré-lecture au même calendrier.
  - Limites : composeur Pro accepte 50 000 éléments, refuse le 50 001ᵉ avec « Au-delà de 50 000 éléments, créez une archive. » ; Plus refuse le 51ᵉ ; gratuit le 16ᵉ ; **aucun test serveur d'éléments** (il ne les voit pas).
  - Mémoire et vitesse : 50 000 éléments chiffrés puis ouverts en moins de 5 s sur la machine de référence, mémoire du manifeste ≤ 30 Mo (mesure jointe).
- [ ] **Step 2 : e2e qui échoue** (`many-items.spec.ts`) : 1 200 petits fichiers de 1 octet (pass Pro simulé) → envoi, ouverture, **liste virtualisée** (moins de 100 nœuds dans le DOM, `aria-rowcount` = 1 200), recherche par nom, ouverture d'un élément au milieu, « Tout télécharger » (archive .zip stockée, 1 200 entrées, `unzip -t` passe) ; le serveur ne voit rien (nombre d'éléments absent ; seule la version 3 de l'en-tête est visible, S50) ; `axe`.
- [ ] **Step 3 : Lancer** → ÉCHEC. **Step 4 : Implémenter** spec §38.9.2. **Step 5 : Lancer** `npm test && make test-ui` → SUCCÈS. **Step 6 : Commit** « feat(premium): manifeste découpé, éléments illimités pour le Pro » et push.

### Tasks F0 à F11 : fonctions payantes (spec §38.9) — **après la V1**

Mêmes blocages que P1 à P3 (Q-P1, Q-P2, Q-P5, avis de spec §38.5) ; F6 attend aussi Q-F3. Revues : `golang-backend`, `sharp-edges`, `privacy-review`, `constant-time-analysis` (F1, F3, F5), `supply-chain-risk-auditor` (F6, F8). **Règles pour toutes** : aucune sécurité de plus, aucune statistique sur les destinataires (spec §38.9.0) ; chaque tâche rejoue « le serveur ne voit rien » avec la fonction activée et ajoute son repère ; tests d'abord ; démo sans ces fonctions.

### Task F0 : Socle — niveau du partage, parité de sécurité, aucune statistique de destinataire (spec §38.9.0)

**Files:**
- Create: `server/internal/tier/tier.go`, `tier_test.go`, `server/internal/api/parity_test.go`, `server/internal/api/fields_test.go`
- Modify: `server/internal/share/service.go` (`tier` posé à la création par le jeton, jamais modifiable), `server/internal/store/store.go`

- [ ] **Step 1 : Tests qui échouent.** **Parité** : les constantes de sécurité (paramètres Argon2id minimaux côté client, 5 essais, longueur minimale du mot de passe, durée des jetons selon la taille, CSP, en-têtes) sont lues d'un seul endroit **sans paramètre de niveau** ; un balayage des sources échoue si une branche `tier` apparaît dans `unlock`, la vérification de preuve, la génération de jeton ou l'écriture des fichiers ; test de comportement : mêmes réponses pour un partage gratuit, Plus et Pro à `unlock` faux (5 essais puis destruction). **Aucune statistique** : les champs de `meta`, `unlock`, `manage/status` et de chaque route des tâches F1 à F11 sont comparés à une **liste blanche** (`fields_test.go`) ; un champ nouveau fait échouer avec « ajouter une ligne justifiée à spec §38.9.0 » ; aucun champ ne porte d'adresse, d'agent, de pays, d'heure précise ni de durée. Niveau : une fonction demandée à un niveau insuffisant → 400 identique à une valeur invalide ; le niveau n'est pas modifiable (aucune route, aucune requête SQL d'écriture hors création).
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter.** **Step 4 : Lancer** `make test-go` → SUCCÈS. **Step 5 : Commit** « feat(premium): niveau du partage, tests de parité de sécurité et de champs » et push.

### Task F1 : Demander des fichiers (spec §38.9.3 ; UI §9.14.2)

**Files:**
- Create: `server/internal/request/store.go`, `handlers.go`, `request_test.go`, `web/src/request/crypto.ts`, `crypto.test.ts`, `web/src/routes/RequestNew.svelte`, `RequestInbox.svelte`, `Deposit.svelte`, `web/ui-e2e/request.spec.ts`
- Modify: `server/internal/api/api.go` (`/api/requests/*`, en-tête `X-Shh-Request` sur `POST /api/shares`), `server/internal/limits/*`, `web/src/history/*` (lien de gestion de la demande), `web/src/i18n/*`

- [ ] **Step 1 : Tests qui échouent.** Serveur : demande créée avec `pk`, limites du niveau ; dépôt sans `X-Shh-Request` valide → refus ; au-delà de `deposits_left` → 429 ; demande close ou expirée → 404 uniforme ; limites du niveau de la demande appliquées au partage déposé (taille, durée ≤ fin de la demande) **et** quotas par connexion inchangés ; note scellée de 512 octets exactement (autre taille → 400) ; `GET /notes` sans `S_demande` → 404 ; **aucune colonne ne relie** un partage à une demande (schéma + recherche d'octets). Client : `crypto_box_seal` aller-retour avec libsodium ; la note ne contient que « SHDP1 », `K_lien`, mot de passe, `S_gestion`, libellé ; mot de passe généré jamais affiché au déposant ; libellé rendu en texte (`<script>` inerte) ; lien de gestion absent de toute requête. e2e (3 contextes) : demandeur crée → déposant dépose deux fichiers → le demandeur voit « Dépôts reçus (1) », ouvre sans saisir de mot de passe, le contenu est identique ; détruire un dépôt ; fermer la demande → dépôt suivant refusé ; le bandeau « Cette personne vous demande des fichiers… » est présent ; « le serveur ne voit rien » : ni libellé, ni `sk`, ni `K_lien` du dépôt sur disque ni dans une requête ; `axe`.
- [ ] **Step 2 : Lancer** → ÉCHEC. **Step 3 : Implémenter.** **Step 4 : Lancer** → SUCCÈS. **Step 5 : Commit** « feat(premium): demander des fichiers, dépôts chiffrés de bout en bout » et push.

### Task F2 : Prolonger un partage (spec §38.9.4 ; UI §9.14.4)

**Files:**
- Create: `server/internal/share/extend.go`, `extend_test.go`, `web/src/premium/extend.ts`, `extend.test.ts`, `web/src/ui/ExtendSheet.svelte`
- Modify: `server/internal/api/handlers_manage.go` (`POST /api/manage/extend`), `web/src/routes/History.svelte` (carte)

- [ ] **Step 1 : Tests qui échouent.** `add_hours` ∈ liste fermée, autre valeur → 400 ; nouvelle échéance = `MIN(ceil15(expires_at + add), hard_expires_at)` (cas aux bornes : à 5 min du plafond → plafond exact) ; jamais > création + 7 j (test de propriétés) ; partage gratuit, expiré, détruit, `draining`, non démarré → refus uniformes ; 6ᵉ prolongation → 429 ; ouvertures et `failed_attempts` inchangés ; jeton de téléchargement en cours renouvelé par `regrant` au nouveau plafond ; sans `S_gestion` → 404 ; l'UI grise les durées au-delà du plafond et affiche « Au plus tard le {date} » ; « le serveur ne voit rien » : aucune trace de prolongation au repos hors `expires_at` et le compteur ; e2e : prolonger de 24 h, le destinataire voit le nouveau compte à rebours après rechargement ; `axe`.
- [ ] **Step 2 à 5** : Lancer (ÉCHEC) → Implémenter → Lancer (SUCCÈS) → Commit « feat(premium): prolonger un partage jusqu'au plafond de 7 jours » et push.

### Task F3 : Ajouter des fichiers à un partage existant — parties (spec §38.9.5 ; UI §9.14.4)

**Files:**
- Create: `server/internal/share/parts.go`, `parts_test.go`, `web/src/crypto/part.ts`, `part.test.ts`, `web/src/premium/addfiles.ts`, `web/src/routes/AddFiles.svelte`, `web/ui-e2e/add-files.spec.ts`
- Modify: `server/internal/store/store.go` (table `parts`), `server/internal/api/*` (`POST /api/manage/envelope`, `POST /api/manage/parts`, segments des parties), `web/src/index.ts` (`openShare` lit toutes les parties)

- [ ] **Step 1 : Tests qui échouent.** Crypto : `K_contenu_n` et `C_engagement_n` dérivés de `R` avec étiquette et `n` distincts, vecteurs figés ; aucune réutilisation de nonce entre parties (même clé jamais utilisée deux fois : espion) ; partie échangée, rejouée ou retirée → échec fermé. Serveur : `POST /api/manage/envelope` exige `S_gestion` **et** `K_preuve` ; **mauvais `K_preuve` compte dans le même compteur de 5 essais que `unlock`** (6ᵉ essai impossible, destruction au 5ᵉ) ; au plus 3 (Plus) ou 7 (Pro) ajouts, le suivant → 429 ; taille totale ≤ niveau ; partage gratuit → 400 ; échéance commune ; budget de lecture par partie ; quotas débités à `finalize` de la partie. Client : l'écran demande le lien et le mot de passe, jamais gardés ; palier canonique par partie. e2e : envoi, ajout de deux fichiers, le destinataire qui rouvre voit les anciens et les nouveaux ; un destinataire déjà dans la page voit « Des éléments ont été ajoutés » après `regrant` ; les ouvertures restantes sont inchangées ; ni nom, ni clé dans une requête ; `axe`.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): ajouter des fichiers par parties authentifiées » et push.

### Task F4 : Ouverture programmée (spec §38.9.6 ; UI §9.3.1, §9.7.2)

**Files:**
- Create: `server/internal/share/opensat_test.go`, `web/src/ui/DateTimeField.svelte`, `web/ui-e2e/scheduled.spec.ts`
- Modify: `server/internal/share/service.go` (`opens_at`, 403 `not_yet`), `server/internal/api/handlers_share.go` (`meta` : `opens_at_s`), `web/src/routes/Options.svelte`, `Open.svelte`

- [ ] **Step 1 : Tests qui échouent.** `opens_at` arrondi au quart d'heure supérieur ; `opens_at` + 1 h > plafond → 400 ; avant l'heure : `unlock` → 403 `not_yet` sans consommer d'essai ni d'ouverture ; pré-lecture permise ; après : normal ; avec le mode « première ouverture » : aucun départ du compte à rebours avant `opens_at` ; niveau gratuit → 400 ; UI : `DateTimeField` hors plage refusé, fenêtre utilisable affichée ; destinataire : écran « s'ouvrira le … », le champ de mot de passe apparaît à zéro sans rechargement ; texte « C'est le serveur qui l'applique » ; e2e avec horloge avancée ; `axe`.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): ouverture programmée » et push.

### Task F5 : Plusieurs destinataires, liens révocables un par un (spec §38.9.7 ; UI §9.3.1, §9.14.3)

**Files:**
- Create: `server/internal/share/links.go`, `links_test.go`, `web/src/premium/links.ts`, `links.test.ts`, `web/src/ui/LinkList.svelte`, `web/ui-e2e/links.spec.ts`
- Modify: `server/internal/store/store.go` (table `links`), `server/internal/api/*` (`POST /api/manage/revoke`, `unlock`/`meta` par `access_v` du lien), `web/src/history/*` (noms des liens, locaux)

- [ ] **Step 1 : Tests qui échouent.** Chaque lien : `K_lien_i`, `sel_i`, `E_i` distincts qui enveloppent **le même `R`** (déchiffrement par chacun donne le même contenu, octet pour octet) ; au plus 5 (Plus) / 25 (Pro) liens, le suivant → 429 ; somme des ouvertures ≤ plafond « taille × ouvertures » ; compteurs d'essais et d'ouvertures **par lien** ; 5 faux mots de passe sur le lien A détruisent… **uniquement le lien A** (les autres liens restent), le partage n'est détruit que si tous les liens le sont — Q-F7, spec §38.9.14 ; **révocation** : lien révoqué → même réponse qu'un lien inexistant (comparaison octet par octet), jetons et octrois du lien invalides, **flux de segments coupés tout de suite** (registre `Streams`, spec §41.8), autres liens intacts ; destruction du partage → tous les liens meurent ; ajout d'un lien plus tard : exige `K_preuve` (compteur partagé) ; les noms n'apparaissent dans aucune requête ni sur disque ; `manage/status` : seulement compteurs d'ouvertures et état par lien (liste blanche F0). e2e (3 contextes) : deux liens vers le même contenu, Alice ouvre, le créateur révoque Bob pendant son téléchargement → coupé net ; Alice finit ; `axe`.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): un lien par destinataire, révocation un par un » et push.

### Task F6 : Notification d'ouverture (spec §38.9.8 ; UI §9.14.6) — **conditionnelle : Q-F3 pour le push**

**Files:**
- Create: `server/internal/notify/notify.go`, `notify_test.go`, `web/src/premium/notify.ts`, `notify.test.ts`, `web/ui-e2e/notify.spec.ts` ; **seulement si Q-F3 est acceptée** : `server/internal/notify/webpush.go`, `web/src/sw/push.ts`
- Modify: `server/internal/stats_test.go` (liste blanche des appels sortants), `web/src/history/*`, coffre de compte (abonnements dans `B`)

- [ ] **Step 1 : Tests qui échouent.** Abonnements **en mémoire seulement** (aucun octet d'adresse d'abonnement dans la base, le WAL ni les fichiers après arrêt) ; redémarrage → oubliés ; hôtes de la liste fermée seulement (adresse `http://`, IP, `localhost`, hôte hors liste → refusée) ; au plus 5 abonnements par partage, 1 notification par partage et par minute ; charge chiffrée RFC 8291 (vecteurs officiels) d'un octet de type : **aucune charge ne contient** nom, lien, heure ou lieu ; événement d'ouverture : une notification par `unlock` réussi (pas par octroi) ; compte facultatif : les abonnements des appareils viennent de `B`, le serveur ne relie pas le compte au partage (`accounts.db` sans id de partage) ; sans push (Q-F3 refusée) : l'option se replie sur « Je verrai l'état sur mon tableau de bord ». Si le push est accepté : service worker minimal sans cache ni interception de `fetch` (test), clé VAPID dans le manifeste de version signé.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): notification d'ouverture » et push.

### Task F7 : Page de réception personnalisée (Pro) (spec §38.9.9 ; UI §9.7.2, §9.14.7)

**Files:**
- Create: `web/src/premium/brand.ts`, `brand.test.ts`, `web/src/routes/BrandProfile.svelte`, `web/ui-e2e/brand.spec.ts`
- Modify: `server/internal/store/store.go` (colonne `brand`, taille fixe), `server/internal/api/handlers_share.go` (`meta` rend `brand`), `web/src/routes/Open.svelte`

- [ ] **Step 1 : Tests qui échouent.** Logo SVG refusé ; PNG, WebP, JPEG ré-encodés par canvas (aucune métadonnée, 128 × 128 au plus, 24 Kio au plus) ; `brand` chiffré par `K_marque` = HKDF(`K_lien`), taille **fixe** quelle que soit l'image ; contraste < 4,5:1 → accent par défaut ; échec de déchiffrement ou de décodage → page standard sans erreur ; le bandeau « Page Shhdrop. Le logo est choisi par l'expéditeur… » est **toujours** dans le DOM (`role="note"`), non masquable (aucun sélecteur de la marque ne l'atteint : test sur les variables CSS autorisées) ; la marque ne change aucun texte ni champ (instantané du DOM hors logo et accent identique) ; niveau Plus ou gratuit → 400 ; le serveur ne voit rien (aucun pixel du logo, aucune couleur en clair) ; `axe` ; capture `brand-open`.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): page de réception personnalisée avec garde-fous » et push.

### Task F8 : CLI et API (Pro) (spec §38.9.10)

**Files:**
- Create: `cli/package.json`, `cli/src/main.ts`, `send.ts`, `open.ts`, `manage.ts`, `pass.ts`, `cli/test/*.test.ts`, `cli/test/interop.spec.ts`, `docs/api.md`, `scripts/build-cli.mjs` (binaire reproductible)
- Modify: `web/src/index.ts` (exports Node sans DOM), `web/scripts/check-dist.mjs` (le CLI n'embarque rien de tiers non listé), manifeste de version (§28)

- [ ] **Step 1 : Tests qui échouent.** **Interopérabilité dans les deux sens** : le CLI envoie, le navigateur (Playwright) ouvre et lit les mêmes octets ; le navigateur envoie, le CLI ouvre ; mêmes vecteurs de test que le web (aucune seconde implémentation de la cryptographie) ; **le mot de passe n'apparaît jamais dans `argv`** (le CLI refuse `--password VALEUR`, test de la liste des processus) ; mot de passe par entrée standard, `--password-file` ou saisie sans écho ; mot de passe généré affiché une fois sur la sortie d'erreur, jamais journalisé ; lien sur la sortie standard seulement ; fichier de configuration `0600` sans `K_lien` ni mot de passe ; pass `P` jamais envoyé, jetons dépensés un par partage ; nettoyage des métadonnées appliqué (JPEG avec position GPS repère) ; avec jeton Pro : preuve de travail à difficulté fixe minimale, aucun repli reCAPTCHA, quotas et limites de niveau **inchangés** ; sans jeton valide → comme un navigateur gratuit ; aucune télémétrie (balayage de `no-analytics`) ; `docs/api.md` générée à partir des routes de spec §8 et §29.8 (test : chaque route documentée existe, et inversement) ; binaire reconstruit deux fois à l'identique.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(cli): envoi, ouverture et gestion en ligne de commande, API documentée » et push.

### Task F9 : Limite de téléchargement par fichier (spec §38.9.11 ; UI §9.3.1, §9.7.2)

**Files:**
- Create: `server/internal/share/partreads.go`, `partreads_test.go`, `web/src/premium/filelimit.ts`, `filelimit.test.ts`, `web/ui-e2e/file-limit.spec.ts`
- Modify: `server/internal/store/store.go` (compteur de lectures par partie et par lien), `web/src/flows/compose.ts` (un fichier limité = sa partie), `web/src/routes/Content.svelte`

- [ ] **Step 1 : Tests qui échouent.** Un fichier à limite est placé dans sa **propre partie** (Task F3) ; le serveur compte des **lectures complètes** de la partie par lien : n lectures acceptées, la (n + 1)ᵉ → 403 `limit_reached` ; budget de lecture = n × palier + 2 segments 0 ; aperçu **puis** enregistrement dans la même ouverture = **une** lecture (le contenu déjà chargé est réutilisé, aucune seconde requête de segment, espion réseau) ; rechargement hors octroi = une lecture de plus ; une lecture interrompue au milieu ne compte qu'une fois qu'elle a dépassé le dernier segment (décision : lecture comptée à la **demande du dernier segment**) ; les autres fichiers du partage restent accessibles ; niveau gratuit → 400 ; texte « Ce fichier peut être téléchargé n fois de plus » ; l'UI dit que c'est une dissuasion ; le serveur apprend la taille de la partie (S51, dit). e2e ; `axe`.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): limite de téléchargement par fichier » et push.

### Task F10 : Filigrane « confidentiel » en lecture seule (spec §38.9.12 ; UI §9.14.5)

**Files:**
- Create: `web/src/viewers/watermark.ts`, `watermark.test.ts`, `web/ui-e2e/watermark.spec.ts`
- Modify: `web/src/viewers/*` (images, PDF isolé, vidéo, texte), `web/src/flows/compose.ts` (texte du filigrane dans la page 1 du manifeste)

- [ ] **Step 1 : Tests qui échouent.** Droit `"voir"` seulement (en « enregistrer » : aucun filigrane, aucune option) ; texte dans le manifeste chiffré (le serveur ne le voit pas) ; image : motif dessiné **dans le canvas** (une capture d'écran de la page le contient) ; PDF : superposition dans le cadre isolé ; vidéo et texte : superposition `pointer-events: none` ; nom du lien seulement si choisi par l'expéditeur, jamais une donnée du destinataire ; texte d'honnêteté (`watermark.honest`) présent à l'écran de l'expéditeur **et** du destinataire ; aucune formule « protégé » (scan de mots interdits, Task 27) ; `forced-colors` : `CanvasText` ; contraste lisible sur fond clair et sombre (images de test) ; e2e ; `axe`.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): filigrane de dissuasion en lecture seule » et push.

### Task F11 : Débit prioritaire (Pro) (spec §38.9.13)

**Files:**
- Create: `server/internal/limits/priority_test.go`
- Modify: `server/internal/limits/slots.go` (192 places communes + 64 réservées), `server/internal/api/handlers_segment.go` (niveau lu du jeton)

- [ ] **Step 1 : Tests qui échouent (`-race`).** Places communes pleines avec des partages gratuits et Plus : un segment Pro est servi (réserve) ; un segment gratuit ou Plus → 503 `busy` avec `Retry-After` ; la réserve ne sert **jamais** un segment gratuit ; réserve pleine : un segment Pro retombe sur les communes si libres ; limites **par connexion et par /48 inchangées** (17ᵉ téléchargement simultané d'une même connexion refusé même en Pro) ; niveau lu de la ligne du partage en base, jamais d'un en-tête du client ; fuite de place nulle après erreur ou annulation (`goleak`) ; texte : jamais « débit garanti » (scan) ; « le serveur ne voit rien » inchangé.
- [ ] **Step 2 à 5** : ÉCHEC → Implémenter → SUCCÈS → Commit « feat(premium): places de transfert réservées au Pro » et push.

---

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
