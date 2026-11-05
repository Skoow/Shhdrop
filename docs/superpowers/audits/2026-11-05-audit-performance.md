# Audit performance, SEO et accessibilité — 2026-11-05

Audit en lecture seule de l'accueil de Shhdrop (build de production de `web/`, servi par le binaire Go `shhdrop serve`). Aucun fichier du dépôt n'a été modifié : le build a été produit hors dépôt (`vite build --outDir` dans le dossier de travail de l'audit), les outils (Lighthouse 12, playwright-core, axe) sont installés dans ce dossier seulement.

Conditions : Chromium 1243 (`/opt/pw-browsers`), `--headless --no-sandbox`, serveur Go avec les en-têtes réels (`Cache-Control: no-store`, CSP…). Mesures sur machine locale (RTT ≈ 0) : les chiffres Lighthouse « mobile » viennent de sa simulation 4G lente (1,6 Mbit/s, RTT 150 ms, CPU ×4).

## 1. Synthèse

| | Mobile | Bureau |
|---|---|---|
| Performance | **91** | **99** |
| Accessibilité | **100** | **100** |
| Bonnes pratiques | **96** | **96** |
| SEO | **91** | **91** |

| Métrique (Lighthouse) | Mobile | Bureau |
|---|---|---|
| FCP | 2,0 s | 0,7 s |
| LCP | 3,0 s | 0,8 s |
| TBT | 140 ms | 60 ms |
| CLS | 0 | 0 |
| Speed Index | 2,0 s | 0,8 s |

Le site est déjà rapide : petit bundle, CLS nul, aucune tâche longue gênante, 60 images/s tenues sous CPU ×4. Les points perdus viennent de quatre causes, toutes corrigeables :

1. **Aucune compression** côté Go (119 Kio de JS + 56 Kio de CSS envoyés bruts) : −5 à −6 points mobile à elle seule.
2. **LCP retardé de ~0,9 s par l'animation d'entrée** de l'accueil (`.reveal .lede` : `rise-in` 600 ms + délai 200 ms, départ à opacité 0).
3. **CSS bloquant le rendu** (56 Kio, dont 21 Kio inutilisés sur l'accueil) et page entièrement rendue côté client (rien de visible avant l'exécution du JS).
4. **SEO** : pas de `<meta name="description">`, pas de canonical, pas d'Open Graph, pas de sitemap, pas de favicon (404 dans la console), pages inconnues servies en 200.

Estimation après les correctifs P1 à P3 ci-dessous : mobile ≈ 98 à 100, bureau 100, SEO 100, bonnes pratiques 100.

### Avertissement important : le bundle va grossir

Le bundle actuel ne contient **ni libsodium ni la liste de mots EFF** (les écrans d'envoi, d'ouverture et de gestion sont encore des gabarits). Poids à venir, mesurés dans `node_modules` et `src/crypto` :

- `libsodium-sumo.mjs` : 413 Kio bruts (wasm embarqué en base64), ~172 Kio en gzip ;
- `wordlist-eff.ts` : 78 Kio bruts, ~26 Kio en gzip.

Si ces modules entrent dans le bundle principal, le JS passe de ~119 Kio à plus de 600 Kio bruts et le TBT/LCP mobile se dégradent nettement. **Ils doivent être chargés par `import()` dynamique, uniquement au moment d'un envoi ou d'une ouverture** (voir P2). C'est la règle à tenir pour garder le score.

## 2. Mesures détaillées

### 2.1 Poids des ressources (accueil, `GET /`, sans cache)

| Ressource | Brut | gzip -9 | brotli -11 | Remarque |
|---|---|---|---|---|
| `index.html` | 726 o | 386 o | 273 o | bloquant par nature |
| `assets/index-B9NevFpn.js` | 119 407 o | 42 122 o | 37 236 o | `type=module`, non bloquant |
| `assets/index-BShPShmv.css` | 56 071 o | 11 526 o | 10 182 o | **bloquant le rendu** |
| `fonts/mona-sans-latin-standard-normal.woff2` | 98 124 o | — | — | déjà compressé, préchargé |
| `fonts/jetbrains-mono-latin-wght-normal.woff2` | 40 404 o | — | — | découverte tardive (via CSS) |
| `assets/grain.png` | 21 124 o | — | — | |
| `assets/aurora-{ink,tide,mint}.png` | 10 144 o (3 fichiers) | — | — | `mint` utilisée deux fois, une seule requête |
| **Total transféré (serveur actuel)** | **≈ 345 Kio** | | | Lighthouse : 345 KiB |

Avec compression brotli : JS 37,2 Kio + CSS 10,2 Kio ; total ≈ 220 Kio. JS+CSS+polices+images : 9 requêtes (+ `favicon.ico` en 404).

Le serveur Go n'envoie **aucun** `Content-Encoding` (vérifié par `curl -H 'Accept-Encoding: br,gzip'`). La spec (§ déploiement) place Caddy devant Go et dit que « la compression ne change pas les octets décompressés » : si Caddy est configuré avec `encode`, le problème disparaît en production ; mais le dossier `deploy/` n'existe pas encore dans le dépôt, donc ce n'est pas vérifiable. Mesure de contrôle avec un serveur de test qui compresse (mêmes en-têtes `no-store`) : **mobile 91 → 96/97** (3 passes).

### 2.2 Core Web Vitals (Playwright, PerformanceObserver)

| Profil | CPU | FCP | LCP | CLS | TBT | Tâches longues |
|---|---|---|---|---|---|---|
| Bureau 1350×940 | ×1 | 180 ms | 180 ms (`h1`) | 0 | 0 ms | 1 (69 ms @42 ms) |
| Bureau | ×4 | 476 ms | 476 ms (`h1`) | 0 | 0 ms | 1 (287 ms @88 ms) |
| Mobile 412×823 @2,6 | ×1 | 196 ms | 216 ms (`img.aur.ink`) | 0 | 0 ms | 1 (77 ms @58 ms) |
| Mobile | ×4 | 464 ms | 464 ms (`img.aur.ink`) | 0 | 0 ms | 1 (296 ms @79 ms) |

- Une seule tâche longue, au démarrage (montage Svelte + premier rendu), ~70 ms à ×1 et ~290 ms à ×4. TBT Lighthouse mobile 140 ms (score 0,95) : c'est la tâche de montage. Pas d'INP mesurable sans interaction ; aucune tâche longue ensuite (0 en 4 s au repos, 0 pendant un défilement).
- Navigation : DCL 111 ms, load 141 ms (bureau, ×1) ; TTFB ≈ 2 ms.
- L'élément LCP mobile (Lighthouse) est `img.aur.ink`, une image décorative (`alt=""`) créée par le JS : découverte tardive (pas dans le HTML initial), répartition simulée : TTFB 15 %, délai de chargement 57 %, rendu 27 %.
- Contre-test : si `.aur` est masquée (opacité 0), le candidat LCP devient `p.lede`, et le LCP simulé reste à 2,3 s alors que le FCP est à 1,4 s. L'écart de ~0,9 s correspond à l'animation `rise-in` (200 ms de délai + 600 ms, départ à opacité 0) de `Home.svelte`. C'est elle qui borne le LCP.

### 2.3 Fluidité sous CPU ×4 (rAF, 4 s au repos puis 4 s de défilement sur la page entière)

| Profil | Phase | Images | Moyenne | p95 | Max | > 25 ms | > 50 ms |
|---|---|---|---|---|---|---|---|
| Bureau ×4 | repos | 240 | 16,7 ms | 16,8 | 33,3 | 1 | 0 |
| Bureau ×4 | défilement (4 670 px) | 222 | 18,1 ms | 33,3 | 50 | 19 | 0 |
| Mobile ×4 | repos | 242 | 16,6 ms | 16,8 | 16,8 | 0 | 0 |
| Mobile ×4 | défilement (6 264 px) | 241 | 16,6 ms | 16,7 | 16,8 | 0 | 0 |

- Les animations d'ambiance (48 animations CSS actives) tiennent 60 i/s ; le CPU de la page au repos est négligeable (tâches : 0,9 s de CPU « ralenti » sur 4 s, zéro `layout`, 1 recalcul de style par image — attendu pour des animations `transform`).
- Seule réserve : en défilement bureau ×4, 19 images sur 222 dépassent 25 ms (p95 33 ms, jamais > 50 ms). Cause probable : la page fait 4 670 px avec grain + aurore `position: fixed` + `view-transition-name: aurora` repeints à chaque défilement. Acceptable ; à surveiller quand les écrans d'envoi arriveront.
- `prefers-reduced-motion: reduce` : il reste 2 animations en cours (contre 48), c'est cohérent avec les requêtes média trouvées (`base.css:39,167`, `AppShell`, `IconButton`).
- Lighthouse relève 28 ms de reflow forcé dans le JS (lecture de géométrie après écriture au montage) : gain marginal.

### 2.4 Cascade de requêtes (bureau ×1, ms depuis le début de la navigation)

| Ressource | Début | Fin | Initiateur | Blocage rendu |
|---|---|---|---|---|
| `mona-sans…woff2` (preload) | 18 | 29 | link | non |
| `index-*.css` | 19 | 30 | link | **oui** |
| `index-*.js` | 19 | 31 | script module | non |
| `grain.png` | 87 | 89 | css | non |
| `jetbrains-mono…woff2` | 92 | 116 | css | non |
| `aurora-{ink,tide,mint}.png` | 111 | 115 | img (créées par JS) | non |
| `favicon.ico` | 166 | 169 | navigateur | — (404) |

Chaîne critique Lighthouse : HTML → CSS → `jetbrains-mono.woff2` (177 ms). La seule ressource bloquant le rendu est la feuille de style unique (Lighthouse : −600 ms estimés en mobile, −80 ms en bureau). `modulePreload` est configuré sans polyfill, bien.

### 2.5 Polices

- `font-display: swap` sur les deux, sous-ensemble latin (`unicode-range`), formats woff2 variables, hébergées localement : conforme à la règle « aucune ressource tierce ». États : « loaded » au chargement, pas de CLS (0) malgré le `swap`.
- Seule Mona Sans est préchargée (`<link rel=preload … crossorigin>` correct). JetBrains Mono n'est découverte qu'après lecture du CSS (+~100 ms). Elle sert aux champs de lien/mot de passe ; non critique pour le LCP.
- Mona Sans pèse 98 Kio : c'est la variante « standard » à trois axes (graisse 200–900, chasse/largeur 75–125 %, etc.). Le site n'utilise vraisemblablement qu'une plage de graisses et pas l'axe de largeur : un sous-ensemble sur mesure (fonttools `pyftsubset` + `fonttools varLib.instancer` pour figer ou limiter les axes) peut descendre à ~35–50 Kio. À vérifier avec les graisses réellement utilisées (`grep font-weight` et `font-stretch`).

### 2.6 Images

- Aucune image de contenu : 4 balises `<img>` décoratives (`alt=""`, `aria-hidden`, dimensions déclarées 128×128 → pas de CLS) et le grain PNG 128×128. Lighthouse : « formats modernes » −11 Kio, « livraison d'images » −18 Kio.
- Essai de conversion en WebP sans perte : grain 21 124 → 16 450 o, aurores 3 504/3 390/3 250 → 2 016/2 024/1 848 o. Gain total ≈ 8,9 Kio. WebP est compatible avec tous les navigateurs gérés par `isSupported`.
- Test de `<link rel=preload as=image fetchpriority=high>` sur `aurora-ink.png` : aucun gain mesuré (97 → 95/97/98, bruit). Inutile.

### 2.7 Cache

Tout est servi en `Cache-Control: no-store` (y compris `/assets/*` et `/fonts/*`) : aucun cache HTTP, donc chaque visite retélécharge ~345 Kio. Lighthouse signale aussi `bf-cache` en échec (« Not actionable ») pour deux raisons : page principale en `no-store` (voulu par la spec §21 pour que « Retour » ne réaffiche pas de contenu déchiffré) et ressource JS reçue en `no-store`. Le score « Performance » n'est pas pénalisé, mais ce n'est pas un défaut : c'est le choix de sécurité.

## 3. SEO

Constats relevés dans le HTML servi, le DOM rendu et les en-têtes :

| Élément | État | Gravité |
|---|---|---|
| `<title>` | « Shhdrop » identique sur **toutes** les routes (accueil, `/securite`, `/confidentialite`, `/s/…`, `/m/…`, 404) ; aucun `document.title` dans le code | Moyenne |
| `<meta name="description">` | **Absente** (seule cause de la perte de 9 points SEO Lighthouse) | Élevée |
| `<link rel="canonical">` | Absent | Moyenne |
| `lang` | Présent (`fr` statique, ajusté par le JS selon `navigator.languages`) ; une seule URL pour deux langues, pas de `hreflang` : un robot sans JS voit « fr », un robot Google (en-US) voit probablement « en » | Basse à moyenne |
| Open Graph / Twitter Card | **Absents** (aucun `og:title`, `og:description`, `og:type`, `og:url`, `og:image`) | Moyenne |
| Image de partage | Aucune. Si on en ajoute une, elle doit être **locale** (même origine, règle « aucune ressource tierce ») : `og:image` 1200×630 en PNG/WebP, `/og.png`. Les robots d'aperçu (hors navigateur) ne sont pas arrêtés par `Cross-Origin-Resource-Policy: same-origin` | Info |
| `robots.txt` | Présent : `User-agent: *`, `Disallow: /s/`, `Disallow: /m/`. Pas de ligne `Sitemap:` | Basse |
| `sitemap.xml` | **404** | Moyenne |
| Données structurées (JSON-LD) | Aucune. Un bloc `<script type="application/ld+json">` est **interdit par la CSP** (`script-src 'self'`, sans hash) ; il faudrait un fichier externe (non reconnu par Google) ou un hash CSP. À ne faire que si le gain SEO le justifie (voir P4) | Info |
| `noindex` sur `/s/` et `/m/` | Présent côté serveur : `X-Robots-Tag: noindex` (vérifié sur `/s/abc` et `/m/abc`) | OK |
| Pages inconnues | `/nope`, `/securite` (route encore vide), `/s/abc.def` renvoient **HTTP 200** `index.html` : soft 404 que Google traite mal ; l'application affiche « Cette page n'existe pas » mais le statut reste 200 | Moyenne |
| Favicon | `/favicon.ico` en **404** : erreur console (seule cause des 96 « bonnes pratiques »). `logo.svg` existe mais n'est référencé par aucun `<link rel="icon">` | Moyenne |
| `theme-color`, `manifest`, `apple-touch-icon` | Absents (le `color-scheme` est déclaré, bien) | Basse |
| Contenu sans JS | `<div id="app"></div>` vide : tout le texte (titres, FAQ) est invisible aux robots qui n'exécutent pas le JS et aux aperçus de lien | Moyenne |
| Cohérence `robots.txt` / `noindex` | `Disallow` empêche un robot de lire l'en-tête `X-Robots-Tag` ; une URL `/s/…` partagée publiquement pourrait être indexée « sans contenu » sur la seule foi du lien. Pour de vrais liens secrets le `Disallow` reste prudent ; garder les deux, et ne pas s'étonner d'un résultat sans description. Signalé, pas à corriger | Info |

Aperçus de lien (messageries) : sans OG, le titre et la description sont ceux par défaut ; la route `/s/…` ne doit de toute façon **rien** révéler (OG neutre ou absent sur ces routes : le HTML de `/s/` est celui de l'accueil, donc il porterait les OG de l'accueil ; c'est acceptable et même souhaitable).

## 4. Accessibilité

Axe 4.14 (WCAG 2.0/2.1/2.2 A et AA + bonnes pratiques) sur `/`, `/securite`, `/confidentialite`, `/s/abc`, `/m/abc`, `/nope`, en français 1280 px et en anglais 320 px. Lighthouse accessibilité 100/100 aux deux formats.

**Violations : 0** sur les 12 combinaisons. Constats annexes :

- **Contraste** : 32 nœuds « à vérifier » (texte sur fond d'aurore translucide). Contre-test avec l'aurore et le grain masqués : 0 violation. Le plafond de luminance K5 (0,050 derrière le texte) est testé par `ui-e2e/aurora.spec.ts` ; ce résultat le confirme.
- **Reflow 320 px** : aucun défilement horizontal sur aucune route (WCAG 1.4.10).
- **Clavier** : lien d'évitement « Skip to content » en premier ; ordre de tabulation logique (logo, langue, boutons de dépôt, « Comment ça marche », liens, FAQ, « Get started », pied de page) ; focus visible partout (`outline: solid 2px`) ; pas de piège clavier sur 25 tabulations.
- **Repères** : `header`, `main`, `nav`, `footer` présents ; un seul `h1` par vue.
- **Mouvement** : `prefers-reduced-motion` respecté (48 → 2 animations).
- **Cibles tactiles** : tous les contrôles ≥ 44 px sauf le lien « Voir le code sur GitHub » (178×22 px). WCAG 2.2 critère 2.5.8 (24 px minimum) : 22 px est en dessous, sauf exception d'espacement ou de lien en ligne ; axe `target-size` n'a rien relevé. Recommandation : `min-block-size: 44px` + `padding`.

Défauts à corriger (axe ne les voit pas) :

1. **Titre de page identique sur toutes les routes** (WCAG 2.4.2, niveau A). Pour une application monopage, un changement de route doit changer `document.title` (« Accueil — Shhdrop », « Sécurité — Shhdrop », « Page introuvable — Shhdrop ») et annoncer la vue. Gravité moyenne.
2. **Routes `/securite` et `/confidentialite`** : simple `<h1 tabindex="-1">Shhdrop</h1>` pour l'instant (gabarit des tâches suivantes) : à ne pas lier depuis le pied de page en production tant qu'elles sont vides (lien « Sécurité » mène à une page vide, qui plus est en 200).
3. **`lang` dynamique** : correct (`document.documentElement.lang` mis à jour), mais `<html translate="no">` + `<meta name="google" content="notranslate">` empêchent la traduction automatique : un visiteur qui ne lit ni le français ni l'anglais ne peut pas traduire (WCAG 3.1.1 n'est pas en cause, mais c'est un choix à justifier : probablement voulu pour que le navigateur ne modifie pas le DOM de la page de déchiffrement). Signalé, à confirmer par le propriétaire.
4. Les 3 « incomplete » restants relèvent de l'inspection manuelle (focus sur les `summary` de la FAQ : pas de `box-shadow`, contour seulement, contraste du contour à vérifier à l'œil, ≥ 3:1 attendu sur fond sombre).

## 5. Correctifs priorisés

Chaque ligne donne : gravité, endroit, problème, correction, gain attendu. Les gains sont des estimations appuyées sur les mesures ci-dessus ; la ligne « mesuré » signale ce qui l'a été.

### P1 — À faire en premier (gain direct sur le score, risque nul)

1. **Compression brotli/gzip.** Gravité haute. `server/cmd/shhdrop/static.go`, `web/vite.config.ts`. Aucun `Content-Encoding` n'est envoyé. Correction : (a) au build, pré-compresser `dist/**/*.{js,css,html,svg,txt}` en `.br` et `.gz` (Vite : plugin maison de 20 lignes avec `node:zlib`, sans dépendance, brotli qualité 11) ; (b) dans `staticHandler`, si `Accept-Encoding` contient `br` (sinon `gzip`) et que `name.br` existe, servir ce fichier avec `Content-Encoding`, `Vary: Accept-Encoding` et le `Content-Type` du fichier d'origine (`ServeContent` doit recevoir le nom d'origine) ; (c) `verify-site.mjs` compare les octets décompressés, rien à changer pour la signature. Si Caddy fait déjà `encode gzip zstd`, ne pas compresser deux fois (Caddy laisse passer les réponses déjà encodées). Gain : **mobile +5 à +6 points (mesuré 91 → 96/97)**, −82 Kio sur le premier chargement (−68 % de JS+CSS transférés), brotli −5,5 Kio de plus que gzip. Attention : tester que `/s/x` (repli SPA) et HEAD restent corrects.
2. **Animation d'entrée et LCP : ne plus partir de l'opacité 0 sur le texte au-dessus de la ligne de flottaison.** Gravité moyenne. `web/src/routes/Home.svelte:739-760` (`.reveal .w`, `.lede`, `.cert`, `.compose`). Le LCP attend la fin de `rise-in` (≈ 800 ms après le FCP). Correction : animer `transform` seulement (les mots restent visibles dès le premier rendu) ou ramener la durée à ≤ 250 ms sans retard ; garder l'effet sur les éléments hors LCP. Gain : **LCP mobile 2,3 s → ~1,5 s** (≈ +10 à +15 points sur la métrique LCP, +2 à +3 de score global), sans changer le design de façon visible.
3. **Favicon.** Gravité moyenne. Ajouter `<link rel="icon" href="/logo.svg" type="image/svg+xml">` (et un `favicon.ico` 32 px dans `public/` pour les robots et anciens clients). Supprime l'erreur console : **bonnes pratiques 96 → 100**.
4. **Description + métadonnées de base.** Gravité haute (SEO). `web/index.html` : `<meta name="description">` (≈ 150 caractères, en français ; l'anglais n'est possible que par un second point d'entrée, voir P3.2), `<link rel="canonical" href="https://shhdrop.app/">`, `<meta name="theme-color">`, `og:type/title/description/url/site_name/locale` et `twitter:card=summary`. Gain : **SEO 91 → 100** ; aperçus de lien propres. Le canonical et `og:url` doivent être **absolus** : à confirmer avec le propriétaire que `shhdrop.app` est bien l'adresse finale.
5. **Statut 404 réel.** Gravité moyenne. `static.go` : un chemin inconnu (hors `/s/` et `/m/`, hors `/`, `/securite`, `/confidentialite`) doit servir `index.html` **avec le statut 404** (le corps reste l'application, qui affiche la page « introuvable »). Gain : pas de soft 404 ; critère indexation ; pas d'impact sur le score Lighthouse. Modifier le test `main_test.go` qui exige aujourd'hui 200 (à vérifier) et la section « repli monopage » de `verify-site.mjs` (`/x` doit alors rendre 404 avec les mêmes octets).

### P2 — Avant l'arrivée des écrans d'envoi et d'ouverture

1. **Découpage par route et import dynamique des modules lourds.** Gravité haute (préventive). `import()` pour `libsodium-wrappers-sumo` (413 Kio, ~172 Kio gzip) dans `crypto/kdf.ts`, pour `wordlist-eff.ts` (78 Kio, ~26 Kio gzip), et pour les routes `open`/`manage`/`securite`/`confidentialite` (`App.svelte`). Précharger (`<link rel=modulepreload>` inséré par le JS, ou `import()` déclenché au survol/focus du bouton « Envoyer ») pendant que l'utilisateur choisit ses fichiers. Gain : le chargement de l'accueil reste à **≈ 40 Kio gzip de JS** et le score mobile 96–100 ; sans cela, le JS initial passerait à ~240 Kio gzip et le TBT mobile dépasserait 300 ms (score < 85). Garder `wasm-unsafe-eval` : déjà dans la CSP.
2. **Séparer le CSS des sections lourdes.** Gravité basse. Lighthouse : 21 Kio de CSS inutilisés (37 %), 600 ms de blocage estimés en mobile. Avec `cssCodeSplit` (par défaut) et les routes en `import()`, le CSS des écrans non affichés quitte la feuille bloquante. Gain : −5 à −10 Kio bruts (−1,5 à −3 Kio brotli) et −100 à −250 ms de FCP mobile simulé. Le CSS inline est exclu par la CSP (`style-src 'self'` : il faudrait un hash par build) ; garder des fichiers.
3. **Sous-ensembles de police.** Gravité basse. `Mona Sans` 98 Kio → 35–50 Kio en limitant les axes (graisse utile 400–700, pas d'axe de largeur) ; vérifier d'abord les valeurs réellement utilisées. Gain : −50 Kio sur le premier chargement (surtout utile hors cache), pas de changement de score en bureau, ≈ −300 ms de chargement de police en 4G lente. Précharger aussi `JetBrains Mono` seulement si elle s'affiche au-dessus de la ligne de flottaison (sinon non : une requête de plus en haute priorité nuit au LCP).
4. **Images en WebP sans perte.** Gravité basse. `public/assets/*.png` → `.webp` (références dans `Aurora.svelte` et le CSS du grain). Gain : −8,9 Kio (−3 %), Lighthouse « formats modernes » passe au vert (≈ +0 à +1 point). Optionnel, mais simple.

### P3 — Cache et SEO structurel

1. **Cache `immutable` pour les fichiers au nom haché (changement sûr de la politique « no-store partout »).** Gravité moyenne. Spec §10 / `server/internal/api/headers.go`. Les fichiers `/assets/index-<hash>.js|css` changent de nom à chaque version : les servir avec `Cache-Control: public, max-age=31536000, immutable` est sûr. Ils ne contiennent aucun secret ni donnée utilisateur, et ne sont pas des réponses `/api/`. Conditions à respecter pour que la garantie de la spec tienne :
   - **Limiter strictement** la règle à `^/assets/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2|webp)$` ; `index.html`, `/api/*`, `robots.txt`, `logo.svg`, `/s/*` et `/m/*` restent en `no-store` (le bfcache et l'effacement des pages déchiffrées dépendent du HTML, pas des assets).
   - Les ressources non hachées de `public/` (`aurora-*.png`, `grain.png`, polices) doivent être **importées depuis `src/`** pour que Vite leur donne un nom haché ; sinon elles restent en `no-cache` (ETag à ajouter) ou sont exclues.
   - Un `no-store` sur la page principale empêche déjà le bfcache : mettre en cache les scripts ne change pas ce comportement. Test à ajouter : « /s/x et /m/x gardent `no-store` ; seul `/assets/<hash>` est immutable ».
   - Risque résiduel : un serveur compromis ne peut pas pousser une version piégée à un navigateur qui a déjà l'ancienne en cache, et inversement un fichier piégé déjà mis en cache restera servi un an. Ce risque est identique à celui d'une version déjà installée par un service worker ; il est contenu par l'intégrité de chaque version (nom haché) et par le plan d'incident (§15.5, `Clear-Site-Data: "cache"`). À faire valider par le propriétaire, car cela contredit la phrase actuelle de la spec (« no-store partout »).
   Gain : visites suivantes **≈ −320 Kio** (≈ 95 % du poids) et FCP répété bureau/mobile proche de 0,3 s ; pas de gain sur le premier chargement (Lighthouse mesure à froid). Le « uses-long-cache-ttl » de Lighthouse passerait au vert.
2. **Rendu initial dans le HTML (prérendu de l'accueil).** Gravité moyenne, coût moyen. Aujourd'hui, `#app` est vide jusqu'à l'exécution du JS (FCP mobile 2,0 s, dominé par HTML → JS → rendu). Correctif minimal : au build, générer l'accueil (fr) statique dans `index.html` avec `svelte/server`, puis `hydrate()` côté client. Gain attendu : FCP/LCP mobile ≈ 1,0–1,3 s, contenu visible aux robots sans JS, aperçus de lien, **score mobile ≈ 99–100**. Risques : la langue est choisie côté client (désaccord d'hydratation si `navigator.languages` ≠ fr : à gérer en ré-affichant) ; les aurores animées ne doivent pas être prérendues. À ne faire que si P1 + P2 ne suffisent pas (cf. règle « Simplicité » : ne rien coder qui ne serve pas).
3. **Sitemap et `robots.txt`.** Gravité basse. Ajouter `public/sitemap.xml` (accueil, `/securite`, `/confidentialite` seulement quand ces pages existent) et `Sitemap: https://shhdrop.app/sitemap.xml` dans `robots.txt` ; garder les `Disallow` sur `/s/` et `/m/`. Le fichier est statique, donc couvert par `verify-site.mjs`.
4. **Titres par route.** Gravité moyenne (accessibilité 2.4.2 et SEO). Dans `App.svelte`, un `$effect` sur `router.current.name` qui met à jour `document.title` à partir des dictionnaires i18n (fr/en) ; utiliser un titre neutre « Shhdrop » sur `/s/…` et `/m/…` (ne rien divulguer dans l'historique ou l'onglet). Gain : accessibilité conforme à 2.4.2, meilleurs signets.
5. **Cible tactile du lien GitHub** (22 px de haut). `padding-block` pour atteindre 44 px. Gain : WCAG 2.5.8 sûr, confort tactile.

### P4 — Optionnel, à discuter

1. **Chargement des dictionnaires par langue.** Gravité basse. `fr.ts` (13,7 Kio) et `en.ts` (12 Kio) sont tous deux dans le bundle (~8 Kio gzip pour les deux). Un import dynamique de la seule langue active économiserait ~4 Kio gzip mais ajoute un aller-retour réseau avant le premier rendu (le texte dépend de la langue) : **perte nette en LCP mobile**. Non recommandé tant que les dictionnaires restent sous ~30 Kio brut chacun.
2. **Données structurées (`WebApplication`/`Organization`).** Gravité info. Bloquées par la CSP (`script-src 'self'`) sauf hash ; gain SEO négligeable pour un service dont les liens ne sont pas destinés à l'indexation. Non recommandé.
3. **Image Open Graph.** Un PNG/WebP 1200×630 local (`/og.png`, ≈ 30 Kio) pour les aperçus de lien : même origine, aucune ressource tierce. Peu utile pour un service de partage privé ; à décider avec le propriétaire.
4. **Zstd.** Go ne sait pas servir `zstd` sans bibliothèque ; inutile si brotli est servi.

## 6. Ordre recommandé et gain cumulé

| Étape | Correctifs | Perf mobile | SEO | Bonnes pratiques |
|---|---|---|---|---|
| Aujourd'hui | — | 91 | 91 | 96 |
| 1 | P1.1 compression | 96–97 (mesuré) | 91 | 96 |
| 2 | P1.2 animation LCP, P1.3 favicon, P1.4 métadonnées | ≈ 98 | 100 | 100 |
| 3 | P2.2 CSS, P3.2 prérendu (si nécessaire) | ≈ 99–100 | 100 | 100 |

Tests à ajouter avec chaque correctif (règle du projet) : `Content-Encoding` et `Vary` selon `Accept-Encoding` (Go) ; `Cache-Control` par chemin ; statut 404 des chemins inconnus ; présence de `description`, `canonical`, `og:*` dans `dist/index.html` (`scripts/check-dist.mjs`) ; `document.title` par route ; budget de poids du bundle d'accueil (ex. JS ≤ 60 Kio gzip) dans `check-dist.mjs` pour détecter un import statique accidentel de libsodium.

## 7. Limites de l'audit

- Mesures sur une machine locale sans réseau réel : seul Lighthouse simule la 4G. Les gains en secondes sont des estimations ; les écarts de ±2 points entre passes sont normaux.
- Le build mesuré est celui du code présent le 2026-11-05 ; d'autres agents modifient le dépôt. Les écrans d'envoi, d'ouverture, de gestion, `/securite` et `/confidentialite` n'existent pas encore : leur poids et leur accessibilité ne sont pas couverts (voir l'avertissement du § 1).
- Pas de test sur appareil réel ni avec lecteur d'écran ; l'examen manuel d'accessibilité s'appuie sur axe, la navigation au clavier et l'inspection du DOM.
- La configuration Caddy (compression, en-têtes) n'est pas dans le dépôt : le comportement en production reste à vérifier avec `curl -H 'Accept-Encoding: br' -I https://shhdrop.app/assets/…` après déploiement.
