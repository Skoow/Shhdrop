# Shhdrop — spécification de l'interface (Plan 2)

Date : 4 novembre 2026 · Statut : à valider par le propriétaire
Spécification de référence : `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (notée « spec » ci-dessous, avec ses numéros de section). En cas de conflit, la spec l'emporte, sauf décision contraire du propriétaire notée ici.
Plan d'exécution : `docs/superpowers/plans/2026-11-04-shhdrop-ecrans.md`.

Brief du propriétaire (impératif) : « interface pro d'expert, jolie, avec animations, très belle, 2027 ». Monde visuel choisi : **« Nuit chiffrée »**. Français et anglais. PWA pensée d'abord pour le téléphone, très bonne aussi sur ordinateur.

Modes de surface : **Operate** (tâche) pour composer, envoyer, gérer, ouvrir et lire ; **Persuade** pour un en-tête d'accueil court, au-dessus du formulaire de composition, sur la même page.

---

## 0. Ce qui lie l'interface

### 0.1 API cliente (branche `plan-1c-durcissement`, à considérer comme contractuelle)

L'interface n'importe que `web/src/index.ts`. Elle n'importe jamais `transfer/api.ts` (audit M1).

| Fonction | Usage dans l'interface |
|---|---|
| `createShare(origin, items, opts)` | Envoi. `items` : `Uint8Array \| Blob` (un `File` est un `Blob`). `opts` : `ttlHours`, `maxOpens`, `password`, `solveCaptcha(challenge)`, `onProgress(done, total)` |
| `fetchMeta(link, expectedOrigin)` | Écran d'ouverture : secondes restantes, sans consommer d'ouverture |
| `openShare(link, password, expectedOrigin)` → `Opened` | Déverrouillage (consomme une ouverture) |
| `Opened.manifest` | Liste des éléments (textes inclus) |
| `Opened.item(i)` | Non utilisé par les écrans : toute lecture passe par `saveItem`, qui donne la progression (§9.8) |
| `Opened.saveItem(i, sink)` | Aperçu et enregistrement, en flux |
| `Opened.done()` | Fin de lecture (« Terminer et effacer », `pagehide`) |
| `Opened.wipe()` | Mise à zéro au mieux (`pagehide`, fin, destruction) |
| `Opened.safeName(i)` | **Seul** nom affiché ou proposé à l'enregistrement |
| `Opened.previewKind(i)` | `"image" \| "audio" \| "video" \| "text" \| "pdf" \| "none"` : **seule** source du choix de visionneuse |
| `Opened.isRiskyFile(i)` | Avertissement avant enregistrement |
| `destroyShare(link, {password}, expectedOrigin)` | Destruction par le destinataire (voir signalement S1) |
| `shareStatus(manage, expectedOrigin)` | Page de gestion |
| `parseLink(url)` | `{kind:"s", origin, id, kLien}` ou `{kind:"m", origin, id, sGestion}` |
| `generatePassphrase(n ≥ 4)`, `checkPassword(pw)` | Écran d'options |
| `collectToBlob(open, i)` | Repli d'enregistrement (Blob `application/octet-stream`) |
| Erreurs | `BadPasswordError{attemptsLeft}`, `NotFoundError`, `LimitError{retryAfterS}`, `Error("reseau")`, `Error("lien_invalide")` ; côté envoi, codes du serveur `Error("full")`, `Error("frozen")`, `Error("bad_request")`, `Error("internal")`, et les erreurs locales du paquet (`vide`, `trop_d_elements`, `trop_gros`, `texte_trop_long`, `mot_de_passe_trop_court`, `mot_de_passe_trop_courant`) |

`expectedOrigin` vaut toujours `location.origin`. L'interface ne fabrique jamais d'URL d'API.

### 0.2 Reports du Plan 1 traités ici

| Report (`2026-11-04-shhdrop-coeur-decisions.md`) | Traitement |
|---|---|
| Nouveau défi anti-robot à chaque création | `createShare` le fait ; l'interface ne garde aucun défi et rappelle `createShare` en entier pour un nouvel essai (§9.4) |
| Widget ALTCHA hébergé, compatible `altcha-lib-go` v1 | `altcha@2.3.0`, build `dist_external` (§15, signalement S3) |
| Garder `K_preuve` pour détruire pendant `draining` | Exige `Opened.destroy()` (signalement S1) ; repli décrit en §9.10 |
| Un mauvais mot de passe à la destruction coûte un essai | L'interface ne redemande jamais le mot de passe pour détruire : elle réutilise celui qui vient de déverrouiller. L'avertissement n'a donc pas d'objet ; il sera ajouté si une saisie est un jour demandée (§9.10) |
| Abandonner le fichier partiel si `saveItem` échoue | `writable.abort()` et message explicite (§9.9) |
| Appel de `done()` ; « en cas d'échec, l'ouverture est perdue » | Bouton « Terminer et effacer », `pagehide`, et avertissement avant déverrouillage (§9.7) |
| `finalize` non réessayé | Message « Le transfert a été interrompu, réessayez » (§9.4) |
| Serveur statique : repli SPA, pas de liste de dossiers ni de fichiers cachés | §14.2 et tâche correspondante du plan |
| Noms et types MIME du manifeste non fiables | `safeName`, `previewKind`, Blob `application/octet-stream` (§12) |
| Mise à jour vite/vitest avant tout `vite dev` | Déjà fait sur `main` (vite 8.3.5, vitest 5.1.0) |

---

## 1. Signalements (vigilance permanente)

| # | Gravité | Endroit | Problème | Correction proposée |
|---|---|---|---|---|
| S1 | **Important** | `destroyShare` (client.ts) ; spec §5.2, §7.5 | `destroyShare` relit `meta` pour retrouver le sel. Après le dernier déverrouillage, le partage passe en `draining` et `meta` répond « introuvable » : avec `maxOpens = 1` (le cas le plus courant), le destinataire **ne peut pas détruire** ni signaler ce qu'il lit. Le report « garder K_preuve » n'est pas couvert par l'API contractuelle | Ajouter à `Opened` : `destroy(reason?: "illegal" \| "malware" \| "other"): Promise<void>`, qui garde `K_accès` et `K_preuve` en mémoire depuis le déverrouillage (mis à zéro par `wipe()`). En attendant, repli §9.10 |
| S2 | **Important** | `destroyShare`, spec §7.6 | « Signaler » = destruction **avec un motif** ; l'API ne prend pas de motif, et le compteur de signalements n'existe pas encore (audit : absent, reporté au Plan 3) | Paramètre `reason` dans `Opened.destroy` (S1) et dans la route `destroy` ; tant qu'il manque, « Signaler » détruit sans motif et l'écran ne promet rien de plus |
| S3 | **Important** | ALTCHA, spec §24 « dernière version stable » | `altcha@3.5.0` (dernière) ne lit plus le format de défi v1 (`maxNumber`, sel + nombre en SHA-256) que produit `altcha-lib-go` v1.0.0 : vérifié dans `dist/external/altcha.js` (aucune lecture de `maxNumber`). `altcha@2.3.0` (18/12/2025, dernière v2) le lit (`r.maxNumber \|\| r.maxnumber`) et propose un build sans styles ni workers intégrés (`dist_external`) | Épingler `altcha@2.3.0` et le noter comme écart validé à §24. Alternative à arbitrer (question Q1) : un solveur maison de 30 lignes dans un Worker (SHA-256 WebCrypto, comme `web/e2e/altcha.ts`), sans dépendance |
| S4 | **Important** | Spec §5.3 (hygiène du lien) et §5.2 (navigateur intégré) | Retirer tout de suite le `#` de la barre d'adresse casse le bouton « Ouvrir dans le navigateur » des apps (Instagram, Facebook…) : il transmet l'adresse **sans** la clé, et le destinataire se retrouve avec un lien mort | Dans un navigateur intégré détecté, retarder `replaceState` jusqu'à ce que la personne choisisse « Continuer ici quand même » ou déverrouille. Partout ailleurs, `replaceState` immédiat |
| S5 | **Important** | `svelte-check` / TypeScript 7 | `svelte-check@4.7.8` exige `typescript` ^5 ou ^6 ; le dépôt est en TypeScript 7.0.2 (version native, sans l'API JavaScript dont se sert `svelte-check`) | Logique dans des `.ts` / `.svelte.ts` vérifiés par `tsc` 7 ; composants minces ; `svelte-check` lancé depuis un petit paquet outil séparé épinglé sur `typescript@6.0.3` (`web/tools/svelte-check/`) |
| S6 | **Important** | Spec §12 (retrait des métadonnées JPEG) | Les JPEG d'iPhone et de nombreux Android contiennent un bloc **MPF** (APP2) et des **images secondaires après la fin de l'image principale** (carte de gain HDR, profondeur), chacune avec son propre EXIF (lieu, appareil). Réécrire seulement l'APP1 les laisse passer | Couper le fichier au premier marqueur EOI de l'image principale, retirer l'APP2 MPF, garder APP2 `ICC_PROFILE` et APP14 `Adobe` (nécessaire au décodage des couleurs). Fixtures de test dédiées |
| S7 | Moyen | Spec §12 | AVIF et GIF sont affichés, mais la spec ne dit rien de leurs métadonnées (AVIF : boîtes Exif/XMP ; GIF : extensions commentaire et XMP). Les documents bureautiques (Word, Excel…) gardent aussi auteur et historique | Avertissement « non nettoyé » pour tout ce qui n'est pas JPEG, PNG ou WebP nettoyé (§9.2), formulé selon la catégorie |
| S8 | Moyen | Spec §10 (Trusted Types) | Svelte 5 crée ses gabarits avec `innerHTML` : `require-trusted-types-for 'script'` exigerait une politique « default », que la spec exclut | Garder la CSP sans Trusted Types ; un test e2e le constate et l'écart est noté à §23 |
| S9 | Moyen | CSP `style-src 'self'` et Svelte | Un attribut `style="…"` écrit dans un gabarit Svelte passe par `innerHTML` et sera **bloqué** par la CSP (les directives `style:` posées par JavaScript, via CSSOM, passent). Vite peut aussi produire des `data:` pour les petits fichiers, bloqués par `font-src`/`img-src` | Interdiction des attributs `style` statiques (règle de lint + test e2e qui échoue sur toute violation CSP) ; `build.assetsInlineLimit: 0`, `build.modulePreload.polyfill: false` |
| S10 | Moyen | PDF isolé (spec §12) | Une `iframe` sandbox **sans** `allow-same-origin` a une origine opaque : ses scripts sont des ressources d'une autre origine pour le navigateur, donc bloquées par `Cross-Origin-Resource-Policy: same-origin` ; elle ne peut pas créer de Worker depuis une URL. pdf.js doit tourner sans worker | Prototype bloquant (tâche du plan) : page `/pdf-frame.html` + script classique (IIFE) servis avec `Cross-Origin-Resource-Policy: cross-origin` (fichiers publics, sans secret), pdf.js en « faux worker » (`globalThis.pdfjsWorker`), `disableWorkerRendering: true`. Échec sur Chromium ou WebKit → repli « téléchargement seulement » (déjà prévu par la spec) |
| S11 | Moyen | Spec §5.2 (« recharger consomme une ouverture ») et §5.3 | Après `replaceState`, recharger la page **avant** de déverrouiller perd la clé : l'écran ne peut plus rien ouvrir | État « Lien incomplet » distinct (§9.11), local, sans requête au serveur : « Rouvrez-le depuis le message d'origine ». Écart mineur au « message unique » de §5.2, qui vise les réponses du serveur |
| S12 | Moyen | `Opened.done()` et `pagehide` | Un `fetch` ordinaire lancé pendant `pagehide` est souvent annulé ; `done()` ne serait alors pas reçu, et le partage resterait jusqu'à `purge_at` (3 h au plus) | Demander à la branche de durcissement `keepalive: true` sur la requête `done` (corps minuscule) ; sinon, limite assumée : `purge_at` borne l'attente |
| S13 | Mineur | Spec §3, §19 (« clair et sombre ») vs brief (« fond sombre profond ») | Le monde « Nuit chiffrée » est sombre ; la spec exige aussi un thème clair accessible | Thème sombre par défaut ; variante claire « Aube » appliquée seulement si le système la demande (`prefers-color-scheme: light`). Question Q2 |
| S14 | Mineur | Spec §5.1 « jauge 34 / 100 Mo » | Valeur périmée depuis §24 (1 Gio) | Jauge « 34 Mo / 1 Go · 3 / 10 » (unités binaires affichées « Mo », « Go ») |
| S15 | Mineur | Spec §22 « 300 Mio par jour » | Contredit §24 (3 Gio par jour) | Aligner §22 sur §24 lors de la prochaine révision de la spec ; aucun effet sur l'interface (elle affiche `LimitError.retryAfterS`) |
| S16 | Mineur | Pages légales (spec §3) | Mentions légales, CGU et contact exigent l'identité, l'adresse de contact (spec §20, non choisie) et l'avis d'un juriste | Plan 2 livre « Comment ça marche / sécurité » et « Confidentialité » ; mentions, CGU et contact passent au Plan 3, **avant toute ouverture au public** |
| S17 | Mineur | `onProgress` d'`openShare` absent de la signature contractuelle | — | Aucune modification demandée : la progression de lecture se calcule dans l'interface en comptant les octets reçus par le `sink` de `saveItem` rapportés à `manifest.items[i].size` |

---

## 2. Monde visuel « Nuit chiffrée »

**Thèse.** La nuit d'un écran de téléphone dans une main, tard, quand on envoie quelque chose de privé. Un fond presque noir, profond et légèrement bleuté ; une seule lumière, menthe, qui marque ce qui est scellé, actif ou sûr. Le produit a deux gestes : **sceller** (le contenu devient illisible, un trait de lumière fait le tour de la capsule et se referme) et **dissoudre** (le contenu se défait en grain et disparaît). Tout le reste est calme, précis, dense quand il le faut.

**Ce que le monde refuse.** Le dégradé violet des produits « IA », le texte en dégradé, les halos colorés sans décalage autour des boutons, les cadenas en 3D, le vocabulaire « militaire », les cartes identiques icône + titre + texte comme structure de page, les étiquettes au-dessus des titres, les numéros de section décoratifs, « 100 % sécurisé ».

**Signature reconnaissable sans contenu.** Fond `#0B0D12` ; surfaces à peine plus claires, séparées par des filets fins ; un trait menthe de 1 à 2 px qui parcourt le bord de la capsule ; chiffres tabulaires ; phrase de passe en chasse fixe, mots séparés par des tirets fins ; grain discret au moment de la dissolution.

**Lumière d'ambiance.** Un seul champ lumineux à l'échelle de la page : un dégradé radial menthe à 6 % d'opacité, très large (120 vw), centré au-dessus du haut de l'écran, fixe. Ce n'est pas un halo autour d'un élément. Retiré en `prefers-contrast: more`.

---

## 3. Couleurs

Stratégie **Restreinte** : neutres teintés de bleu nuit + un accent menthe, réservé aux actions principales, à l'état « scellé », à la sélection et au focus. Le rouge ne sert qu'à la destruction et aux erreurs.

### 3.1 Jetons, thème sombre « Nuit » (par défaut)

| Jeton | Hex | Usage |
|---|---|---|
| `--bg` | `#0B0D12` | Fond de page |
| `--surface-1` | `#12151C` | Panneaux, barre d'actions |
| `--surface-2` | `#191D27` | Champs, capsule, lignes d'éléments |
| `--glass` | `rgb(18 21 28 / 0.80)` + `backdrop-filter: blur(20px) saturate(1.2)` | Barres collantes seulement (§5.4) |
| `--line` | `#262B36` | Filets décoratifs (non porteurs d'information) |
| `--line-strong` | `#68728A` | Bord des champs et contrôles (≥ 3:1) |
| `--text` | `#E9ECF2` | Texte principal |
| `--text-2` | `#A6AEBD` | Texte secondaire |
| `--text-3` | `#8A93A4` | Indications, texte d'exemple des champs |
| `--text-disabled` | `#5A6275` | Contrôles désactivés (exemptés par WCAG ; ne porte jamais seul une information) |
| `--accent` | `#5FE3B5` | Action principale, scellé, focus, sélection |
| `--accent-hover` | `#86EDC9` | Survol de l'action principale |
| `--on-accent` | `#05140F` | Texte sur fond menthe |
| `--accent-tint` | `#102A23` | Fond d'état « scellé », badge « nettoyé » |
| `--danger` | `#FF8A80` | Destruction, erreurs |
| `--on-danger` | `#1A0605` | Texte sur bouton de destruction |
| `--danger-tint` | `#2A1414` | Fond de bandeau d'erreur |
| `--warn` | `#F2C46D` | Avertissements (navigateur intégré, fichier à risque, non nettoyé) |
| `--warn-tint` | `#2A2312` | Fond de bandeau d'avertissement |
| `--info` | `#8DB2FF` | Liens dans le texte, informations neutres |
| `--selection` | `rgb(95 227 181 / 0.28)` | `::selection` |

### 3.2 Jetons, thème clair « Aube » (si `prefers-color-scheme: light`)

| Jeton | Hex |
|---|---|
| `--bg` | `#F4F5F8` |
| `--surface-1` | `#FFFFFF` |
| `--surface-2` | `#EBEDF2` |
| `--glass` | `rgb(255 255 255 / 0.80)` + même flou |
| `--line` / `--line-strong` | `#D9DCE4` / `#767F93` |
| `--text` / `--text-2` / `--text-3` | `#0F121A` / `#475064` / `#5C6579` |
| `--text-disabled` | `#9AA1B0` |
| `--accent` (texte, bord, focus) | `#0A7A5A` |
| `--accent-fill` (fond du bouton principal) / `--accent-hover` | `#0A7A5A` / `#086A4E` |
| `--on-accent` | `#FFFFFF` |
| `--accent-tint` | `#E3F5EE` |
| `--danger` / `--on-danger` / `--danger-tint` | `#B42318` / `#FFFFFF` / `#FCEBEA` |
| `--warn` / `--warn-tint` | `#8A5A00` / `#FBF1DC` |
| `--info` | `#2457C5` |

En thème sombre, `--accent-fill` = `--accent`.

### 3.3 Contrastes vérifiés (WCAG 2.1, formule de luminance relative)

Calculés pour cette spécification ; la tâche « jetons » du plan les recalcule dans un test unitaire (`tokens.contrast.test.ts`) qui échoue sous le seuil.

| Paire (sombre) | Ratio | Seuil | | Paire (clair) | Ratio | Seuil |
|---|---|---|---|---|---|---|
| `--text` / `--bg` | 16,42 | 4,5 | | `--text` / `--bg` | 17,17 | 4,5 |
| `--text` / `--surface-2` | 14,24 | 4,5 | | `--text` / `--surface-2` | 15,98 | 4,5 |
| `--text-2` / `--surface-2` | 7,55 | 4,5 | | `--text-2` / `--surface-2` | 6,90 | 4,5 |
| `--text-3` / `--surface-2` | 5,45 | 4,5 | | `--text-3` / `--surface-2` | 4,99 | 4,5 |
| `--accent` / `--bg` | 12,16 | 3 (focus, bord) | | `--accent` / `--surface-2` | 4,55 | 4,5 (texte) |
| `--on-accent` / `--accent` | 11,80 | 4,5 | | `--on-accent` / `--accent-fill` | 5,32 | 4,5 |
| `--on-accent` / `--accent-hover` | 13,45 | 4,5 | | `--on-accent` / `--accent-hover` | 6,60 | 4,5 |
| `--danger` / `--surface-2` | 7,38 | 4,5 | | `--danger` / `--surface-2` | 5,61 | 4,5 |
| `--on-danger` / `--danger` | 8,58 | 4,5 | | `--on-danger` / `--danger` | 6,57 | 4,5 |
| `--danger` / `--danger-tint` | 7,61 | 4,5 | | `--danger` / `--danger-tint` | 5,70 | 4,5 |
| `--warn` / `--warn-tint` | 9,57 | 4,5 | | `--warn` / `--warn-tint` | 5,28 | 4,5 |
| `--accent` / `--accent-tint` | 9,54 | 4,5 | | `--accent` / `--accent-tint` | 4,71 | 4,5 |
| `--info` / `--surface-2` | 7,98 | 4,5 | | `--info` / `--surface-2` | 5,53 | 4,5 |
| `--line-strong` / `--surface-2` | 3,50 | 3 (bord de champ) | | `--line-strong` / `--surface-1` | 4,02 | 3 |
| `--text` / verre sur fond blanc (pire cas) | 8,26 | 4,5 | | `--text` / verre sur fond noir (pire cas) | 11,66 | 4,5 |
| `--text-2` / verre sur fond blanc | **4,38** | 4,5 → **interdit** | | `--text-2` / verre sur fond noir | 5,03 | 4,5 |

Règle qui en découle : **sur du verre sombre, seul `--text` (et les boutons opaques) est permis**.

---

## 4. Typographie

### 4.1 Familles (hébergées, fichiers dans le dépôt)

| Rôle | Police | Licence | Fichier | Poids |
|---|---|---|---|---|
| Tout le texte d'interface et l'accueil | **Mona Sans** (GitHub), variable `wght` 200–900 et `wdth` 75–125 | SIL Open Font License 1.1 | `web/public/fonts/mona-sans-latin-standard-normal.woff2`, depuis `@fontsource-variable/mona-sans@5.3.0` | 98 124 octets |
| Phrase de passe, liens, champ du mot de passe | **JetBrains Mono**, variable `wght` 100–800 | SIL Open Font License 1.1 | `web/public/fonts/jetbrains-mono-latin-wght-normal.woff2`, depuis `@fontsource-variable/jetbrains-mono@5.3.0` | 40 404 octets |

- Le sous-ensemble `latin` (plage Fontsource `U+0000-00FF, U+0152-0153, U+2000-206F…`) couvre le français : accents, « œ », guillemets, espaces fines, « … », « − ». Il ne contient pas « ≈ » ni les flèches : les textes n'en utilisent pas. Pas d'italique (non utilisé).
- Empreintes SHA-256 attendues : Mona Sans `5ea3740633e5ac7af56c13d7e8ec32bcae12e7723e53d34284469a8947ccb2f3`, JetBrains Mono `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e`.
- Les fichiers sont **copiés** dans `web/public/fonts/` par un script (`web/scripts/copy-fonts.mjs`), avec leur empreinte SHA-256 vérifiée par un test, puis commités. Les paquets Fontsource restent en `devDependencies` pour la traçabilité, jamais chargés à l'exécution. Licence OFL ajoutée à `THIRD_PARTY_LICENSES.md`.
- `@font-face` dans `web/src/styles/fonts.css` : `font-display: swap`, `unicode-range` du sous-ensemble latin, `font-weight` et `font-stretch` en plages. Préchargement (`<link rel="preload" as="font" type="font/woff2" crossorigin>`) de Mona Sans seulement.
- Pourquoi Mona Sans : une grotesque d'outil, nette en petit, avec un axe de **largeur** qui donne à l'accueil une voix propre (titre élargi) sans seconde famille ; hors de la liste des polices par défaut des interfaces générées. Pourquoi une chasse fixe : la phrase de passe et les liens sont des données qu'on recopie ou dicte ; `l`, `1` et `I` doivent se distinguer. Elle ne sert nulle part ailleurs.
- Repli : `font-family: "Mona Sans", system-ui, sans-serif` et `"JetBrains Mono", ui-monospace, monospace`.

### 4.2 Échelle (rem fixes, rapport ≈ 1,2 ; titre d'accueil seul fluide)

| Jeton | Taille / interligne | Poids | Largeur (`font-stretch`, %) | Usage |
|---|---|---|---|---|
| `--fs-display` | `clamp(2.5rem, 1.6rem + 4vw, 4.25rem)` / 1.02 | 620 | 118 | Titre d'accueil uniquement ; approche −0,03 em |
| `--fs-h1` | 1.75rem / 1.15 | 650 | 108 | Titre d'écran |
| `--fs-h2` | 1.4375rem / 1.2 | 620 | 104 | Titre de section, capsule |
| `--fs-h3` | 1.1875rem / 1.3 | 600 | 100 | Sous-section |
| `--fs-body` | 1rem / 1.5 | 430 | 100 | Texte courant (16 px minimum sur téléphone) |
| `--fs-small` | 0.875rem / 1.45 | 450 | 100 | Indications, méta |
| `--fs-micro` | 0.75rem / 1.4 | 520 | 100 | Unités, compteurs ; jamais pour une phrase |
| `--fs-mono` | 1.0625rem / 1.5 | 480 | — | Phrase de passe (en bloc : 1.25rem, approche +0,01 em) |

- Chiffres : `font-variant-numeric: tabular-nums` pour la jauge, la progression, le compte à rebours, les tailles.
- Titres : `text-wrap: balance` ; paragraphes : `text-wrap: pretty`, mesure 65 ch au plus.
- Typographie française dans `fr.ts` : espace fine insécable (U+202F) avant « ; : ! ? » et à l'intérieur des guillemets, espace insécable (U+00A0) entre nombre et unité (« 34 Mo », « 4 h 15 »).

---

## 5. Espacement, rayons, élévation, verre

### 5.1 Espacement (base 4 px)

`--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48 · `--sp-8` 64 · `--sp-9` 96 (px). Groupes serrés (`--sp-2`/`--sp-3`), séparation large (`--sp-6`/`--sp-7`), plus d'espace au-dessus d'un titre qu'en dessous. Marge latérale : 16 px sous 600 px, 24 px jusqu'à 960 px, puis contenu centré, largeur maximale 1120 px.

### 5.2 Rayons

`--r-sm` 6 px (puces, badges) · `--r-md` 10 px (champs, boutons) · `--r-lg` 16 px (panneaux, lignes d'éléments) · `--r-xl` 24 px (capsule scellée, feuilles) · `--r-pill` 999 px (contrôle segmenté). Les rayons imbriqués décroissent : rayon intérieur = rayon extérieur − marge.

### 5.3 Élévation (ombres décalées et floues, jamais un halo centré)

| Jeton | Valeur (sombre) | Usage |
|---|---|---|
| `--e-1` | `0 1px 2px rgb(0 0 0 / .40)` | Lignes d'éléments, champs |
| `--e-2` | `0 8px 24px -8px rgb(0 0 0 / .60), 0 2px 6px rgb(0 0 0 / .35)` | Capsule, panneaux |
| `--e-3` | `0 24px 64px -16px rgb(0 0 0 / .70)` | Feuilles (`<dialog>`) |
| `--edge` | `inset 0 1px 0 rgb(255 255 255 / .05)` | Arête haute des surfaces sombres |

Thème clair : mêmes géométries, opacités divisées par 3, `--edge` retiré.

### 5.4 Verre : usage restreint et justifié

Le verre ne sert qu'aux éléments **sous lesquels le contenu défile** et qui doivent garder ce contexte visible :

1. la barre d'en-tête, une fois la page défilée ;
2. la barre d'actions collée en bas sur téléphone (composer, options, contenu) ;
3. le fond des feuilles `<dialog>` (`::backdrop` : `rgb(5 7 10 / .6)` + flou 8 px).

Ailleurs : surfaces opaques. Repli si `backdrop-filter` n'est pas pris en charge ou si `prefers-reduced-transparency: reduce` : `--surface-1` à 96 %. Sur le verre, seul `--text` (§3.3).

---

## 6. Icônes

- **Lucide**, via `@lucide/svelte@1.68.0` (licence ISC), un composant par icône importé nommément (arbre secoué au build : seules les icônes utilisées sont livrées). Aucun chargement à l'exécution depuis l'extérieur, aucun `{@html}`.
- Trait 1,75 px, taille 20 px (24 px dans les boutons d'action principaux), `currentColor`, `aria-hidden="true"` ; le libellé est porté par le texte du bouton ou `aria-label`.
- Jeu utilisé (liste fermée, toute icône ajoutée passe en revue) : `paperclip` (fichiers), `camera` (photo), `mic` / `square` (vocal / arrêt), `type` (texte), `x` (retirer), `lock` / `lock-open`, `shield-check` (nettoyé), `triangle-alert` (avertissement), `copy` / `check` (copié), `share-2`, `qr-code`, `refresh-cw` (régénérer), `eye` / `eye-off`, `clock`, `download`, `file`, `file-text`, `image`, `music`, `film`, `trash-2` (détruire), `flag` (signaler), `external-link` (navigateur intégré), `chevron-left`, `languages`, `wifi-off`, `clipboard-x` (vider le presse-papier), `circle-help`.
- Aucun emoji ni caractère Unicode (« ✕ », « ✓ », « ⋯ ») à la place d'une icône. Le « ✕ » de la spec §5.1 devient l'icône `x`.
- Logo : mot-symbole « shhdrop » en Mona Sans 650, largeur 112, minuscules, précédé d'un pictogramme dessiné (fichier SVG du dépôt) : une capsule arrondie dont le contour est un trait ouvert de 300° qui se referme — le geste du scellement. Le même dessin sert aux icônes PWA (§14).

---

## 7. Mouvement

### 7.1 Principe

Un seul moment écrit par geste du produit : **le scellement** (envoi) et **la dissolution** (fin de vie). Partout ailleurs, le mouvement ne fait qu'expliquer un changement d'état, vite. Aucun chargement chorégraphié, aucune apparition au défilement, aucun survol qui soulève.

### 7.2 Jetons

| Jeton | Valeur | Usage |
|---|---|---|
| `--dur-instant` | 120 ms | Pression, copie confirmée, bascule |
| `--dur-fast` | 180 ms | Survol, focus, changement de libellé |
| `--dur-base` | 240 ms | Apparition d'un bandeau, d'une ligne |
| `--dur-slow` | 400 ms | Changement d'étape, ouverture d'une feuille, regroupement en capsule |
| `--dur-moment` | 640 ms | Fermeture du sceau |
| `--dur-dissolve` | 1100 ms | Dissolution |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Arrivées |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Sorties (durée × 0,7) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Dissolution |

Aucun rebond ni ressort.

### 7.3 Le scellement (écran d'envoi, §9.4)

Une **capsule** : la surface `--surface-2`, rayon `--r-xl`, qui résume l'envoi (« 3 éléments · 34 Mo », icônes des types, noms des éléments sur une ligne chacun). Par-dessus son bord, un `<svg>` aux dimensions de la capsule contient un `<rect>` aux mêmes rayons, `pathLength="100"`, trait `--accent`, `stroke-dasharray: 100`.

1. **Regroupement** (au clic « Chiffrer et envoyer », 400 ms, `--ease-out`). Les lignes d'éléments du composeur glissent vers la capsule et s'y rangent : technique FLIP en Web Animations API (position mesurée avant et après, `transform` et `opacity` seulement), décalage de 30 ms entre lignes, 270 ms de décalage cumulé au plus.
2. **Préparation de la clé et vérification anti-robot** (durée réelle, indéterminée). Un trait court (8 unités sur 100) parcourt le bord en boucle, 1,6 s par tour, linéaire. Le libellé de phase change en fondu de 180 ms.
3. **Chiffrement et envoi** (durée réelle, déterminée). Le trait devient une progression : `stroke-dashoffset = 100 − 100 × fait / total`, transition de 240 ms à chaque segment. En même temps, les noms des éléments deviennent illisibles en proportion : `filter: blur(calc(var(--p) * 5px))`, opacité de 1 à 0,55, où `--p` = fait / total. C'est vrai : chaque segment est chiffré juste avant son envoi.
4. **Fermeture du sceau** (après `finalize`, 640 ms au total). Le trait se referme (100 %) et s'épaissit de 1 à 2 px ; le bord prend `--accent` à 40 % ; au centre, l'icône `lock-open` laisse place à `lock` : l'anse descend de 3 px (220 ms, `--ease-out`) ; la capsule se comprime d'un souffle (échelle 1 → 0,985 → 1, 280 ms), puis monte de 8 px (240 ms) pendant que le panneau « Lien prêt » se déplie dessous (`grid-template-rows: 0fr → 1fr`, 320 ms) avec ses trois blocs décalés de 60 ms.
5. **Échec**. Le trait s'arrête où il est et passe en `--danger` (180 ms) ; aucun tremblement. Le message d'erreur apparaît sous la capsule.

### 7.4 La dissolution (fin de vie : destruction, « Terminer et effacer », « Supprimé »)

Le contenu (la liste des éléments chez le destinataire, la carte d'état sur la page de gestion) se défait en grain du bas vers le haut, puis le message de fin apparaît à sa place.

- Propriété `@property --d { syntax: "<number>"; initial-value: 0; inherits: false }`, animée de 0 à 1 en 1100 ms, `--ease-in-out`.
- Masque à trois couches, CSS seul :
  `mask-image: linear-gradient(to top, #000 var(--solid), transparent var(--solid)), url(/assets/grain.png), linear-gradient(to top, transparent var(--solid), #000 var(--solid), #000 var(--edge-top), transparent var(--edge-top));`
  `mask-composite: add, intersect;` (préfixe `-webkit-mask-composite: source-over, source-in` pour WebKit), avec `--solid = (1 − --d) × 120 % − 20 %` et `--edge-top = (1 − --d) × 120 %` : la partie basse reste pleine, une bande de 20 % devient granuleuse, le haut est effacé.
- `grain.png` : tuile de bruit en niveaux de gris de 128 × 128 px, produite une fois par un script déterministe (`web/scripts/gen-grain.mjs`, graine fixe) et commitée (≈ 10 Ko). `mask-size: 128px`, `mask-position` décalé de 0 à 24 px pendant l'animation, pour que le grain frémisse.
- Le contenu monte de 4 px et prend un flou de 1 px sur le dernier tiers.
- À la fin : `wipe()` a déjà eu lieu (la dissolution n'est jouée **qu'après** la réponse du serveur ou la mise à zéro locale, jamais avant), le nœud est retiré, le message (« Ce partage a été détruit » ou « Supprimé ») apparaît en fondu de 240 ms et reçoit le focus.
- Repli si `@supports not (mask-composite: intersect)` ou sans `@property` : fondu et flou (opacité 1 → 0, flou 0 → 6 px, 400 ms).

### 7.5 Mouvement réduit (`prefers-reduced-motion: reduce`)

| Moment | Remplacement |
|---|---|
| Regroupement FLIP | Fondu enchaîné de 160 ms entre composeur et capsule |
| Trait qui tourne (indéterminé) | Trait immobile ; le libellé de phase pulse en opacité (1 ↔ 0,6, 1,2 s) |
| Progression du trait | Conservée (c'est un état), sans transition |
| Flou des noms | Remplacé par l'opacité seule |
| Fermeture du sceau | Couleur du bord et icône changent sans déplacement ni échelle ; panneau affiché sans dépliage |
| Dissolution | Fondu de 240 ms, puis message |
| Changements d'étape, feuilles | Fondu de 120 ms, sans déplacement |

### 7.6 Mise en œuvre et choix des outils

- **CSS** pour les états, la progression, la dissolution (`@property`, masques) ; **Web Animations API** pour le regroupement FLIP et l'enchaînement de la fermeture du sceau (interruption propre, promesses `finished` pour séquencer) ; transitions intégrées de Svelte 5 (qui s'appuient sur `element.animate()`, donc compatibles avec `style-src 'self'`) pour les apparitions simples.
- **Aucune bibliothèque d'animation** (GSAP, Motion…) : tout s'exprime avec la plateforme, et chaque dépendance ajoutée est du code tiers sur la page qui détient la clé du lien (spec §2, §10).
- Une animation ne masque jamais le contenu par défaut : si le script échoue, l'état final est visible. `will-change` posé seulement pendant l'animation. Les effets coûteux (flou, masque) sont bornés à la capsule ou à la liste.
- Un utilitaire `motion.ts` expose `reducedMotion()` (lecture de `matchMedia`, mise à jour à chaud) et `flip(elements, mutate)`.

---

## 8. Inventaire des composants

Chaque composant interactif a ses états : repos, survol (pointeur fin seulement, `@media (hover: hover)`), focus visible, pressé, désactivé, chargement, erreur. Zones tactiles ≥ 44 × 44 px.

| Composant | Rôle | Notes |
|---|---|---|
| `AppShell` | En-tête (logo, langue), contenu, pied (Sécurité, Confidentialité) | Verre au défilement ; `translate="no"` hérité de `<html>` |
| `Button` | `primary` (menthe pleine), `secondary` (contour `--line-strong`), `ghost`, `danger` | Hauteur 48 px (44 px en dense) ; état chargement : libellé conservé, icône remplacée par un trait tournant de 16 px ; `aria-busy` |
| `IconButton` | Bouton icône seule | `aria-label` obligatoire (contrôlé par test) |
| `Segmented` | Durée (1 h, 6 h, 12 h, 24 h) | `role="radiogroup"`, flèches clavier |
| `Stepper` | Ouvertures 1 à 10 | Boutons − / +, valeur en chiffres tabulaires, `aria-live="polite"` sur la valeur |
| `TextField` / `TextArea` | Saisie | Bord `--line-strong`, focus : anneau 2 px `--accent` décalé de 2 px ; erreurs reliées par `aria-describedby` ; attributs §12.3 |
| `PassphraseField` | Phrase générée ou mot de passe personnel | Chasse fixe, mots séparés par « - » ; boutons Régénérer, Copier, « Utiliser mon propre mot de passe » |
| `PasswordChecklist` | Indicateur de force | Liste de critères vrais (« 12 caractères minimum », « Absent des mots de passe courants ») ; pour la phrase générée : « 4 mots tirés au hasard parmi 7 776 (environ 52 bits) ». Aucune jauge d'entropie inventée |
| `CopyField` | Lien, mot de passe, lien de gestion | Valeur affichée tronquée au milieu, copie de la valeur entière, confirmation « Copié » 2 s (icône `check`), annoncée en `aria-live` |
| `Banner` | `info`, `warn`, `danger` | Fond teinté + icône + texte ; pas de bord gauche coloré épais ; `role="status"` ou `role="alert"` selon l'urgence |
| `CapacityGauge` | « 34 Mo / 1 Go · 3 / 10 » | Barre fine 4 px ; au-delà de 90 % : `--warn` ; dépassement : `--danger` et bouton bloqué |
| `ItemRow` | Élément du composeur ou du contenu | Icône du type, nom (`<bdi>`), taille, badges (« Nettoyé », « Non nettoyé »), action retirer / ouvrir / enregistrer |
| `DropZone` | Ajout de fichiers | Bouton natif `<input type="file" multiple>` stylé + glisser-déposer sur ordinateur ; contour en tirets `--line-strong`, menthe au survol de dépôt |
| `VoiceRecorder` | Vocal | États §9.2 ; niveau d'entrée en 5 barres (AnalyserNode), minuteur tabulaire |
| `SealCapsule` | Scellement | §7.3 |
| `Countdown` | Temps restant | Affichage « 4 h 15 », « 12 min », « 45 s » ; annonce lecteur d'écran §11 |
| `InlineConfirm` | Confirmation de destruction, de sortie | Remplace le bouton par « Confirmer / Annuler » sur place ; pas de modale |
| `Sheet` | Signalement (motifs), QR code sur téléphone | `<dialog>` natif, focus piégé par le navigateur, Échap ferme |
| `QrCode` | QR du lien de partage | SVG produit par code (chemins), jamais par `{@html}` ; chargé à la demande |
| `Viewer*` | Image, Audio, Vidéo, Texte, Pdf | §9.8 |
| `SaveButton` | Enregistrement en flux | Progression en octets, annulation, états §9.9 |
| `Dissolve` | Enveloppe la zone qui se dissout | §7.4 |
| `LiveRegion` | Annonces polies | Une seule région par page, file d'attente, débit limité |

---

## 9. Écrans et états

Routes (routeur interne d'une trentaine de lignes, sans dépendance) : `/` (accueil + envoi), `/s/:id` (ouverture), `/m/:id` (gestion), `/securite`, `/confidentialite`, toute autre adresse → page 404. Les liens de partage et de gestion ont la forme de la spec (`/s/{id}#{K_lien}`, `/m/{id}#{S_gestion}`).

Disposition : une colonne sur téléphone ; à partir de 960 px, deux colonnes (composer | options sur l'accueil ; liste | visionneuse sur le contenu). La barre d'actions principale est collée en bas sur téléphone (zone du pouce), en fin de colonne sur ordinateur.

### 9.1 Accueil (Persuade, court)

- Titre (`--fs-display`) : **« Un lien, un mot de passe, puis plus rien. »** / EN : « One link, one password, then nothing. »
- Une phrase : « Texte, photos, vidéos, vocaux, documents. Chiffrés sur votre appareil avant l'envoi : ni le serveur ni son propriétaire ne peuvent les lire. »
- Démonstration du mécanisme, pas une liste d'arguments : un schéma en une ligne, dessiné en SVG, « Votre appareil — chiffré — serveur (ne voit rien) — chiffré — destinataire », dont le trait menthe se trace une fois à l'affichage (600 ms ; immobile en mouvement réduit).
- Lien discret « Comment ça marche » → `/securite`.
- Le composeur commence juste dessous ; sur téléphone, son premier bloc (boutons d'ajout) est visible dans le premier écran (390 × 844).

### 9.2 Composer

- Boutons d'ajout, en rangée : **Fichiers**, **Photo**, **Vocal**, **Texte**. « Photo » = `<input type="file" accept="image/*" capture="environment">` (spec §10 : pas d'accès direct à la caméra). « Vocal » masqué si `MediaRecorder` est absent.
- Liste des éléments (`ItemRow`) : icône, nom, taille, badge, bouton retirer (`x`, `aria-label` « Retirer {nom} »).
- `CapacityGauge` toujours visible au-dessus de la barre d'actions.
- **Texte** : `TextArea` (attributs §12.3), compteur « 1 234 / 10 000 » en points de code ; au-delà : erreur et bouton bloqué. Un texte = un élément.
- **Vocal** : repos → demande du micro → refus (« Micro refusé. Autorisez-le dans les réglages du navigateur. ») / enregistrement (minuteur, niveau, bouton Arrêter) → écoute (lecteur natif, « Garder » / « Recommencer »). Format : `audio/mp4` (AAC) si `MediaRecorder.isTypeSupported`, sinon `audio/webm;codecs=opus` (spec §12). Nom : « Vocal 1.m4a » ou « .webm ».
- **Nettoyage des métadonnées** (`web/src/media/strip.ts`, sans réencodage) appliqué aux images ajoutées par Fichiers ou Photo, avant l'ajout à la liste :
  - JPEG : EXIF réécrit avec la seule orientation ; APP2 `ICC_PROFILE` et APP14 `Adobe` conservés ; APP1 XMP, APP13, APP2 MPF, COM et autres APPn retirés ; données coupées au premier EOI de l'image principale (S6).
  - PNG : `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME` retirés ; `iCCP`, `sRGB`, `gAMA`, `cHRM` conservés.
  - WebP : blocs `EXIF` et `XMP ` retirés, drapeaux du bloc `VP8X` et taille RIFF corrigés ; `ICCP` conservé.
  - Seules les images de 50 Mo au plus sont lues en mémoire pour le nettoyage ; au-delà (cas qui n'existe pas en pratique pour une photo), l'image est ajoutée « non nettoyée », avec l'avertissement.
  - Badge : « Nettoyé · lieu, appareil et date retirés ». En cas d'échec du nettoyage (fichier malformé) : l'élément n'est **pas** ajouté, message « Impossible de nettoyer cette photo. Elle n'a pas été ajoutée. »
- **Non nettoyé** (badge `--warn` + phrase) : vidéos (« peut contenir le lieu, la date et l'appareil »), HEIC, AVIF, GIF (« photo non nettoyée (format {format}) »), PDF (« peut contenir l'auteur et le logiciel utilisé »), autres documents (« peut contenir des informations sur son auteur »).
- Blocages avant l'envoi, avec la raison : aucun élément (bouton désactivé + « Ajoutez au moins un élément »), plus de 10 éléments (« 10 éléments maximum »), plus de 1 Go (« Trop gros : 1,2 Go sur 1 Go maximum. Retirez des éléments. »). La limite affichée est la capacité du plus grand palier moins la place maximale du manifeste (1 073 741 824 − 65 540 octets) ; `createShare` reste l'arbitre (`trop_gros`).
- Action : **Continuer** (téléphone : passe à l'étape Options, focus sur son titre) ; sur ordinateur, les options sont déjà à droite et l'action est directement « Chiffrer et envoyer ».

### 9.3 Options

- **Durée** : `Segmented` 1 h · 6 h · 12 h · **24 h** (par défaut). Indication : « Comptée à partir de la fin de l'envoi. »
- **Ouvertures** : `Stepper` 1 à 10, **1** par défaut. Indication : « Une ouverture = un déverrouillage réussi. »
- **Mot de passe** : phrase générée de 4 mots (`generatePassphrase(4)`), affichée en grand, en chasse fixe ; boutons **Régénérer**, **Copier**. Lien « Utiliser mon propre mot de passe » → champ texte (chasse fixe, bouton Afficher/Masquer), `PasswordChecklist` en direct, erreurs de `checkPassword` (« 12 caractères minimum », « Ce mot de passe est trop courant »). Rappel permanent : « Envoyez-le par un autre moyen que le lien. »
- Action : **Chiffrer et envoyer** (`primary`, icône `lock`). Retour possible à « Composer » sans rien perdre.

### 9.4 Scellement et envoi

La capsule (§7.3) occupe l'écran ; sous elle, le libellé de phase, la progression et un rappel « Gardez cet onglet ouvert pendant l'envoi ». Un gestionnaire `beforeunload` n'est actif **que** pendant l'envoi (la sortie abandonne l'envoi, spec §5.1).

| Phase | Détection | Libellé (FR) |
|---|---|---|
| `key` | Du clic jusqu'à l'appel de `solveCaptcha` | « Préparation de la clé… » |
| `captcha` | Pendant `solveCaptcha` et jusqu'au premier `onProgress(0, total)` | « Vérification anti-robot · aucun service tiers » ; après 5 s : « Cela peut prendre jusqu'à 30 secondes après plusieurs envois. » |
| `upload` | `onProgress(n, total)`, n < total | « Chiffrement et envoi · 42 % » + « 14,2 Mo / 34 Mo » |
| `stalled` | Aucun `onProgress` depuis 15 s pendant `upload`, ou événement `offline` | Bandeau `warn` « La connexion semble coupée. Shhdrop réessaie tout seul ; gardez cet onglet ouvert. » (icône `wifi-off`) |
| `finalize` | `onProgress(total, total)` reçu, promesse non résolue | « Finalisation… » |
| `sealed` | Promesse résolue | Fermeture du sceau, puis §9.5 |

Le délai minimal de 3 s du piège anti-robot est respecté par `createShare` lui-même : l'écran ne fait rien de plus que l'afficher sereinement (la phase `captcha` dure au moins ce temps).

**Widget ALTCHA** : `solveCaptcha(challenge)` monte `<altcha-widget>` (build externe) dans la ligne « Vérification anti-robot » de la capsule, avec `challengejson` = le défi reçu, `auto="onload"`, `hidelogo`, `hidefooter`, couleurs reprises des jetons (variables CSS du widget). La promesse se résout sur l'événement `statechange` à l'état `verified` (charge utile), se rejette sur `error` ou `expired`. Le widget est retiré après usage. Rien n'est demandé à la personne : pas de case à cocher.

**Erreurs de l'envoi** (les éléments restent dans le composeur, rien n'est perdu côté appareil) :

| Erreur | Message | Action |
|---|---|---|
| `Error("reseau")` | « L'envoi n'a pas abouti (connexion). Ce qui a déjà été envoyé sera effacé automatiquement. » | Réessayer |
| `NotFoundError` | « Le transfert a été interrompu, réessayez. » | Réessayer |
| `LimitError{retryAfterS}` | « Limite atteinte, réessayez dans {durée}. » | — |
| `Error("full")` | « Service temporairement saturé, réessayez plus tard. » | — |
| `Error("frozen")` | « Les nouveaux envois sont suspendus pour le moment. Réessayez plus tard. » | — |
| `Error("bad_request")` | Un seul nouvel essai automatique (nouveau défi, nouvelles clés) ; ensuite : « La vérification anti-robot a échoué. Réessayez. » | Réessayer |
| `NotReadableError` | « « {nom} » a été modifié ou déplacé pendant l'envoi. Retirez-le et ajoutez-le à nouveau. » | Retour au composeur |
| Autre | « Une erreur inattendue a interrompu l'envoi. Réessayez. » (le code n'est jamais affiché) | Réessayer |

« Réessayer » rappelle `createShare` en entier : nouvelles clés, nouveau sel, nouveau défi (jamais de rechiffrement d'un segment avec la même clé).

### 9.5 Lien prêt

Affiché seulement quand la promesse de `createShare` est résolue (spec §5.1).

1. **Lien de partage** : `CopyField` + **Partager** (`navigator.share({ url })`, masqué si absent ; ne partage **jamais** le mot de passe) + **QR code** (sur demande ; feuille sur téléphone, en place sur ordinateur ; légende « Le QR contient la clé : ne le montrez qu'au destinataire »).
2. **Mot de passe** : `CopyField` en chasse fixe, avec le rappel de la spec : « Envoyez-le par un **autre moyen** que le lien. Les deux dans la même messagerie, c'est comme ne pas en mettre. »
3. **Lien de gestion** : `CopyField` + « Gardez-le pour vous : il permet de suivre et de détruire le partage. »
4. **Vider le presse-papier** (`navigator.clipboard.writeText("")`) + « Ne vide pas l'historique du clavier ni le presse-papier partagé entre appareils. »
5. Mention : « Ces informations ne seront plus jamais affichées. » + expiration : « Expire dans 24 h (vers 21 h 45) si personne ne l'ouvre. »
6. **Terminé** → `InlineConfirm` « Vous ne pourrez plus les afficher. Terminer ? » → efface l'état (chaînes oubliées, tableaux à zéro) et revient au composeur vide.

### 9.6 Gestion (`/m/:id`)

- Au chargement : lecture de `parseLink(location.href)` puis `history.replaceState` (§12.1) ; squelette pendant `shareStatus`.
- État `ready` : « Ouvert 1 / 3 · Expire dans 4 h 15 » (chiffres tabulaires), bouton **Détruire maintenant** (`danger`, `InlineConfirm` « Détruire ce partage pour tout le monde ? C'est immédiat et définitif. »).
- État `draining` : « Toutes les ouvertures sont utilisées · effacement à la fin du dernier téléchargement » ; Détruire reste possible.
- État `uploading` : « Envoi en cours » (cas d'un second onglet).
- `NotFoundError` ou après destruction : dissolution (§7.4) puis **« Supprimé »**, sans raison (spec §5.1).
- Actualisation : bouton `refresh-cw` et relecture automatique toutes les 60 s tant que la page est visible (`visibilitychange`) ; `LimitError` suspend la relecture jusqu'à `retryAfterS`. `Error("reseau")` : bandeau « Connexion impossible » + Réessayer.

### 9.7 Ouverture (`/s/:id`)

1. Lecture de `parseLink(location.href)` ; si le `#` manque ou est invalide → §9.11 « Lien incomplet » ; sinon `history.replaceState` (sauf navigateur intégré, S4).
2. `fetchMeta` (squelette) → `NotFoundError` : §9.11 « Lien invalide ». `Error("reseau")` : « Connexion impossible. Vérifiez votre réseau et réessayez. »
3. Écran :
   - « Quelqu'un vous a envoyé un partage chiffré. Shhdrop ne vérifie pas l'identité de l'expéditeur. »
   - `Countdown` « Disponible encore 5 h 31 ».
   - Champ mot de passe (attributs §12.3), bouton Afficher/Masquer, **Déverrouiller** (`primary`, `lock-open`). La touche Entrée déclenche le déverrouillage (gestionnaire `keydown`, pas de `<form>`).
   - Note sous le bouton : « Déverrouiller utilise une ouverture. Si le téléchargement échoue ensuite, cette ouverture est perdue. »
4. Pendant `openShare` : bouton en chargement, « Déchiffrement de la clé… » (Argon2id, environ 1 s).
5. Erreurs : `BadPasswordError{attemptsLeft}` → « Mot de passe incorrect · {n} essai(s) restant(s) » ; avec 1 restant, en plus : « Au prochain échec, le partage sera détruit. » Le champ garde sa valeur, sélectionnée, focus. `LimitError` → « Trop de tentatives rapprochées. Réessayez dans {durée}. » `NotFoundError` → §9.11. `Error("reseau")` → message réseau (aucune ouverture consommée si l'échec précède le déverrouillage ; l'écran ne peut pas le savoir avec certitude et ne l'affirme pas).

**Navigateur intégré** (détection par l'agent utilisateur, table testée dans `inapp.ts` : Instagram, FBAN/FBAV/FB_IAB, Messenger, LinkedInApp, Snapchat, TikTok `musical_ly`/`BytedanceWebview`, Line, Telegram, WeChat `MicroMessenger`) : bandeau `warn` avant tout le reste : « Vous êtes dans le navigateur intégré de {app}, qui peut lire cette page. Ouvrez ce lien dans votre navigateur habituel (menu de l'app, puis « Ouvrir dans le navigateur »). » Boutons **Copier le lien** et **Continuer ici quand même**. Le champ mot de passe n'apparaît qu'après « Continuer ici ». Une PWA installée (`display-mode: standalone`) n'est jamais signalée.

### 9.8 Contenu

- Bandeau collé en haut (verre) : `Countdown` « Disponible encore 5 h 31 · disparaît quand vous quittez la page · recharger consomme une ouverture ».
- Liste des éléments (`ItemRow` avec `safeName(i)`, taille, type), puis actions par élément selon `previewKind(i)` et la taille :

| `previewKind` | ≤ 200 Mio | > 200 Mio |
|---|---|---|
| `text` | Affiché aussitôt (le texte est dans le manifeste), `<pre>` en texte brut, `dir="auto"`, bouton Copier | — (≤ 10 000 caractères) |
| `image` | Chargée automatiquement si ≤ 20 Mio, sinon bouton « Afficher » ; `<img>` depuis une URL blob, plein écran au toucher, zoom natif | Enregistrer seulement |
| `audio` | Bouton « Écouter » → `<audio controls>` | Enregistrer seulement |
| `video` | Bouton « Regarder » → téléchargement complet avec progression, puis `<video controls playsinline>` (spec §12) | Enregistrer seulement |
| `pdf` | Bouton « Lire » → visionneuse isolée (§13) | Enregistrer seulement |
| `none` | Enregistrer seulement | Enregistrer seulement |

- Lecture pour l'aperçu : `saveItem(i, sink)` avec un `sink` qui accumule les tranches et compte les octets (progression « 12 / 48 Mo ») ; à la fin, `new Blob(tranches, { type: TYPE_SUR[kind] })` où `TYPE_SUR` est une table fixe de l'interface (`image` → type d'origine seulement s'il est dans la liste blanche JPEG, PNG, WebP, GIF, AVIF, SVG, HEIC ; `audio` → `audio/mp4` ou `audio/webm` ; `video` → `video/mp4`, `video/quicktime` ou `video/webm` ; sinon refus d'affichage), puis mise à zéro des tranches.
- Pour les images, l'URL blob est **révoquée dès l'événement `load`** (l'image reste affichée) : un « Ouvrir l'image dans un nouvel onglet » ne mène nulle part, ce qui protège aussi contre un SVG ouvert comme document (§12.4).
- Erreurs de lecture : `Error("reseau")` → « Téléchargement interrompu. » + Réessayer (le jeton vaut 3 h) ; `NotFoundError` → « Ce partage n'est plus disponible. Ce qui est déjà affiché reste visible jusqu'à ce que vous quittiez la page. » (spec §13) ; `trop_gros_pour_apercu` ne peut pas survenir (seuil vérifié avant).
- Expiration pendant la lecture : quand le compte à rebours atteint zéro, bandeau « Expiré · ce qui est affiché disparaît quand vous quittez la page », boutons d'aperçu et d'enregistrement désactivés.
- Pied de la liste : **Terminer et effacer** (`secondary`) → `done()`, `wipe()`, révocation des URL blob, dissolution, « Effacé de cet appareil. » ; **Détruire maintenant** (`danger`, §9.10) ; **Signaler** (`ghost`, icône `flag`, §9.10).
- Mémoire : avant un aperçu de vidéo ou un enregistrement par Blob de plus de 200 Mio sur un appareil où `navigator.deviceMemory` < 4, ou sur iPhone/iPad (détection prudente), bandeau « Cet appareil risque de manquer de mémoire pour un fichier de cette taille. »

### 9.9 Enregistrer (fichiers lourds compris)

1. Si `isRiskyFile(i)` : `InlineConfirm` `warn` « « {nom} » peut exécuter du code sur votre appareil. N'ouvrez ce fichier que si vous faites confiance à l'expéditeur. » → « Enregistrer quand même » / « Annuler ».
2. Si `showSaveFilePicker` existe : sélecteur avec `suggestedName: safeName(i)` → `createWritable()` → `saveItem(i, chunk => writable.write(chunk))` avec progression en octets et bouton **Annuler** → `close()` → « Enregistré ». En cas d'erreur ou d'annulation : `writable.abort()` (le fichier partiel est supprimé) et « Enregistrement interrompu : le fichier incomplet a été supprimé. » + Réessayer. Annulation du sélecteur (`AbortError`) : retour silencieux.
3. Sinon : `collectToBlob(open, i)` (progression par le même comptage), puis lien `<a download="{safeName}">` sur une URL blob `application/octet-stream`, cliqué par le code, URL révoquée 60 s après. Note sous le bouton, pour les éléments > 200 Mio : « Sur ce navigateur, le fichier est assemblé en mémoire avant l'enregistrement. » (spec §18.7).
4. Jamais « Enregistré » tant que `close()` n'a pas réussi (ou que le lien de téléchargement n'a pas été déclenché, pour le repli).

### 9.10 Détruire, signaler

- **Détruire maintenant** : `InlineConfirm` `danger` « Détruire ce partage pour tout le monde ? C'est immédiat et définitif. » → appel → dissolution → « Ce partage a été détruit. »
- **Signaler** : `Sheet` « Signaler ce contenu » avec trois motifs en boutons radio (« Contenu illégal », « Logiciel malveillant ou hameçonnage », « Autre »), texte « Le partage sera détruit immédiatement. » → **Signaler et détruire**.
- Appel : `opened.destroy(reason)` quand il existe (S1, S2). Repli tant qu'il manque : `destroyShare(link, { password }, location.origin)` avec le mot de passe qui vient de déverrouiller (gardé dans une variable non réactive, oubliée par `wipe`) ; si la réponse est `NotFoundError` (cas `draining`), l'écran appelle `done()` et `wipe()` et dit la vérité : « Ce partage n'accepte plus d'ouverture et sera effacé dès la fin des téléchargements en cours. Il a été effacé de cet appareil. » Le mot de passe n'est jamais redemandé : aucun essai ne peut être perdu à la destruction.
- `Error("reseau")` : « Connexion impossible : le partage n'a pas été détruit. » + Réessayer.

### 9.11 Lien invalide, lien incomplet, navigateur non pris en charge, 404

| État | Quand | Texte |
|---|---|---|
| Lien invalide | `NotFoundError` à `fetchMeta` ou `openShare`, ou `Error("lien_invalide")` levée par l'une d'elles (par exemple origine différente de `location.origin`) | « Ce lien n'existe pas ou n'est plus disponible. » (message unique, spec §5.2). Visuel : la capsule déjà dissoute (grain immobile), lien « Envoyer quelque chose » vers `/` |
| Lien incomplet | Pas de `#`, ou `parseLink` refuse localement | « Ce lien est incomplet. Rouvrez-le depuis le message d'origine. » + « La partie secrète a peut-être été retirée de la barre d'adresse après une première visite. » |
| Navigateur non pris en charge | Absence de `crypto.subtle`, `WebAssembly`, `Blob.prototype.stream` ou `TextDecoder` | « Ce navigateur ne permet pas de chiffrer en sécurité. Utilisez une version récente de Safari, Chrome, Firefox ou Edge. » Rien n'est envoyé (spec §10) |
| 404 | Route inconnue | « Cette page n'existe pas. » + lien accueil |

### 9.12 Pages « Comment ça marche / sécurité » et « Confidentialité » (mode Read)

- `/securite` : le mécanisme en quatre paragraphes (clé dans le `#`, mot de passe, chiffrement dans le navigateur, autodestruction), le modèle de menaces résumé (spec §2), **les limites assumées** (spec §18, intégralement, en langage simple), la phrase de §18.10. Jamais « 100 % sécurisé ».
- `/confidentialite` : la liste exacte de ce qui est traité (spec §9), « aucun cookie, aucune mesure d'audience », la mention que l'adresse IP est vue sans être enregistrée (spec §18.3).
- Mesure 68 ch, `--fs-body` 1.0625rem, titres en `--fs-h2`.

---

## 10. Textes (FR / EN)

- Dictionnaires typés : `web/src/i18n/fr.ts` (référence, `as const`) et `en.ts` (`satisfies Record<keyof typeof fr, …>` : une clé manquante ne compile pas). Paramètres nommés (`{n}`, `{duree}`, `{nom}`), pluriels par `Intl.PluralRules`, nombres et tailles par `Intl.NumberFormat`, durées par un formateur maison testé (FR « 4 h 15 », « 12 min », « 45 s », « moins d'une minute » ; EN « 4h 15m », « 12 min », « 45 s », « less than a minute »).
- Langue : `navigator.languages` (premier qui commence par `fr` → français, sinon anglais) ; bascule dans l'en-tête (`languages`), sans mémorisation (aucun stockage). `<html lang>` mis à jour.
- Aucun texte venu du serveur n'est affiché.

Clés principales (extrait normatif ; le plan fixe la liste complète dans `fr.ts`) :

| Clé | FR | EN |
|---|---|---|
| `hero.title` | Un lien, un mot de passe, puis plus rien. | One link, one password, then nothing. |
| `hero.lede` | Texte, photos, vidéos, vocaux, documents. Chiffrés sur votre appareil avant l'envoi : ni le serveur ni son propriétaire ne peuvent les lire. | Text, photos, videos, voice notes, documents. Encrypted on your device before sending: neither the server nor its owner can read them. |
| `compose.add.files` / `.photo` / `.voice` / `.text` | Fichiers / Photo / Vocal / Texte | Files / Photo / Voice / Text |
| `compose.gauge` | {taille} / 1 Go · {n} / 10 | {size} / 1 GB · {n} / 10 |
| `compose.cleaned` | Nettoyé · lieu, appareil et date retirés | Cleaned · location, device and date removed |
| `compose.notCleaned.video` | Vidéo non nettoyée : elle peut contenir le lieu, la date et l'appareil. | Video not cleaned: it may contain location, date and device. |
| `compose.notCleaned.pdf` | PDF non nettoyé : il peut contenir l'auteur et le logiciel utilisé. | PDF not cleaned: it may contain the author and the software used. |
| `compose.empty` | Ajoutez au moins un élément. | Add at least one item. |
| `options.ttl.hint` | Comptée à partir de la fin de l'envoi. | Counted from the end of the upload. |
| `options.opens.hint` | Une ouverture = un déverrouillage réussi. | One open = one successful unlock. |
| `options.pw.generated` | 4 mots tirés au hasard parmi 7 776 (environ 52 bits) | 4 words drawn at random from 7,776 (about 52 bits) |
| `options.submit` | Chiffrer et envoyer | Encrypt and send |
| `seal.key` | Préparation de la clé… | Preparing the key… |
| `seal.captcha` | Vérification anti-robot · aucun service tiers | Bot check · no third-party service |
| `seal.upload` | Chiffrement et envoi · {pct} % | Encrypting and sending · {pct}% |
| `seal.stalled` | La connexion semble coupée. Shhdrop réessaie tout seul ; gardez cet onglet ouvert. | The connection seems lost. Shhdrop retries on its own; keep this tab open. |
| `ready.pw.reminder` | Envoyez-le par un autre moyen que le lien. Les deux dans la même messagerie, c'est comme ne pas en mettre. | Send it another way than the link. Both in the same chat is like having no password. |
| `ready.clipboard.note` | Ne vide pas l'historique du clavier ni le presse-papier partagé entre appareils. | Does not clear keyboard history or a clipboard shared across devices. |
| `ready.never` | Ces informations ne seront plus jamais affichées. | This information will never be shown again. |
| `open.intro` | Quelqu'un vous a envoyé un partage chiffré. Shhdrop ne vérifie pas l'identité de l'expéditeur. | Someone sent you an encrypted share. Shhdrop does not verify who the sender is. |
| `open.cost` | Déverrouiller utilise une ouverture. Si le téléchargement échoue ensuite, cette ouverture est perdue. | Unlocking uses one open. If the download then fails, that open is lost. |
| `open.badPw` | Mot de passe incorrect · {n} essai restant / {n} essais restants | Wrong password · {n} attempt left / {n} attempts left |
| `open.lastTry` | Au prochain échec, le partage sera détruit. | One more failure and the share will be destroyed. |
| `content.banner` | Disponible encore {duree} · disparaît quand vous quittez la page · recharger consomme une ouverture | Available for {duration} · disappears when you leave the page · reloading uses an open |
| `content.finish` | Terminer et effacer | Finish and erase |
| `content.destroy.confirm` | Détruire ce partage pour tout le monde ? C'est immédiat et définitif. | Destroy this share for everyone? It is immediate and final. |
| `content.risky` | « {nom} » peut exécuter du code sur votre appareil. N'ouvrez ce fichier que si vous faites confiance à l'expéditeur. | “{name}” can run code on your device. Only open it if you trust the sender. |
| `invalid` | Ce lien n'existe pas ou n'est plus disponible. | This link does not exist or is no longer available. |
| `manage.status` | Ouvert {u} / {max} · Expire dans {duree} | Opened {u} / {max} · Expires in {duration} |
| `manage.gone` | Supprimé | Deleted |
| `err.limit` | Limite atteinte, réessayez dans {duree}. | Limit reached, try again in {duration}. |
| `err.full` | Service temporairement saturé, réessayez plus tard. | Service temporarily full, try again later. |
| `err.interrupted` | Le transfert a été interrompu, réessayez. | The transfer was interrupted, try again. |

---

## 11. Accessibilité (spec §19)

- Contrastes : §3.3, recalculés par test ; `axe-core` sans violation (règles WCAG 2.1 A et AA) sur chaque écran et état, en sombre **et** en clair, sur Chromium et WebKit.
- Clavier : tout est atteignable dans l'ordre visuel ; focus visible : anneau 2 px `--accent`, décalé de 2 px, jamais retiré ; `:focus-visible` seulement. Au changement d'étape ou d'écran, le focus va au titre (`tabindex="-1"`). Échap ferme les feuilles. Lien d'évitement « Aller au contenu ».
- Lecteurs d'écran : un seul `LiveRegion` poli. Progression d'envoi annoncée tous les 10 % ; compte à rebours annoncé seulement aux seuils 1 h, 15 min, 5 min, 1 min et à l'expiration (`aria-live` poli) ; l'affichage visuel, lui, se met à jour chaque minute au-delà d'une heure, chaque seconde en dessous de 5 min. Erreurs en `role="alert"`. Capsule : `role="progressbar"` avec `aria-valuenow`, `aria-valuetext` (« 42 %, 14 Mo sur 34 »). Icônes décoratives `aria-hidden`.
- Cibles tactiles ≥ 44 × 44 px ; espacement ≥ 8 px entre cibles voisines.
- Agrandissement : mise en page en `rem`, aucun texte coupé à 200 % de zoom ni avec une taille de police système de 24 px ; testé à 320 px de large.
- Mouvement : §7.5. Transparence : §5.4. `prefers-contrast: more` : filets en `--line-strong`, lumière d'ambiance retirée, verre remplacé par du plein.
- Langue : `lang` sur `<html>` ; un nom de fichier étranger est enveloppé dans `<bdi>`.
- Vérification manuelle (spec §14) : VoiceOver (iPhone), TalkBack (Android).

---

## 12. Règles de sécurité de l'interface

### 12.1 Lien et historique

- `parseLink(location.href)` dès le démarrage de la route, puis `history.replaceState(null, "", location.pathname)` : le `#` disparaît de la barre d'adresse et de l'historique synchronisé (spec §5.3). Exception : navigateur intégré (S4).
- L'expéditeur ne voit jamais son lien dans la barre d'adresse : les liens sont affichés dans la page, pas navigués.
- Aucun lien, clé ni mot de passe dans `localStorage`, `sessionStorage`, IndexedDB, cookies, titre de page ou `console`.

### 12.2 Cache « page précédente » (spec §21)

- `pagehide` : `opened.wipe()`, révocation de toutes les URL blob, remise à zéro de l'état des écrans (lien, mot de passe, manifeste oubliés), tentative de `done()` (S12).
- `pageshow` avec `event.persisted` : `location.reload()`.
- Test e2e : contenu ouvert → navigation → Retour → la page recharge et le contenu n'est plus là.

### 12.3 Saisie

| Champ | Attributs |
|---|---|
| Mot de passe du destinataire | `type="password"`, `autocomplete="one-time-code"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`, `name` et `id` neutres (`shh-unlock`), hors de tout `<form>` |
| Mot de passe personnel de l'expéditeur | `type="text"` (masquable), mêmes attributs, `autocomplete="off"` |
| Texte du composeur | `autocomplete="off"`, `autocorrect="off"`, `spellcheck="false"`, `autocapitalize="off"` (spec §21 ; limite : le clavier peut tout de même apprendre) |

- Aucune balise `<form>` sur les écrans d'envoi et d'ouverture (spec §21) ; Entrée gérée par `keydown`.
- Vérification manuelle : aucun gestionnaire de mots de passe ne propose d'enregistrer (Chrome, Safari, Firefox).

### 12.4 Affichage du contenu reçu

- Choix de la visionneuse : `previewKind(i)` seulement ; nom : `safeName(i)` seulement.
- Texte : interpolation Svelte (`{texte}`), jamais `{@html}`, jamais de liens rendus cliquables.
- **`{@html}` interdit dans tout le code** (règle de lint et test de recherche dans les sources).
- SVG : `<img>` seulement (spec §12), URL révoquée au `load` ; le document SVG ne devient jamais un document navigable sur notre origine.
- Téléchargement : Blob `application/octet-stream` (`collectToBlob` l'impose), nom `safeName(i)`.
- Aucun `URL.createObjectURL` sur un type hors de la table `TYPE_SUR` (§9.8).

### 12.5 CSP (spec §10) et code

- Aucun script ni style en ligne, aucun `eval`, aucun `new Function`, aucun attribut `style` statique dans les gabarits (S9), aucune URL `data:` (`build.assetsInlineLimit: 0`).
- Test e2e commun à tous les parcours : écoute de `securitypolicyviolation` (injectée par Playwright) et de la console ; **toute** violation fait échouer le test.
- Aucune ressource tierce : test e2e qui intercepte les requêtes et échoue sur toute origine autre que celle du serveur (`blob:` permis).
- `translate="no"` sur `<html>` et `<meta name="google" content="notranslate">` (spec §21).
- `<meta name="robots" content="noindex">` n'est pas global ; le serveur ajoute `X-Robots-Tag: noindex` sur `/s/*` et `/m/*`, `robots.txt` les interdit (spec §10). `index.html` ne contient aucune balise d'aperçu (`og:*`) : les messageries n'affichent qu'un titre neutre.

### 12.6 Presse-papier

- Copie seulement sur geste explicite (`navigator.clipboard.writeText`), jamais automatique. Repli : sélection du texte et message « Copiez-le manuellement ».
- « Vider le presse-papier » écrit une chaîne vide, avec la mention honnête de §9.5.

---

## 13. PDF isolé (spec §12)

- `<iframe src="/pdf-frame.html" sandbox="allow-scripts" referrerpolicy="no-referrer" title="Document PDF">` ; jamais `allow-same-origin`, `allow-popups`, `allow-top-navigation`, `allow-forms`, `allow-downloads`.
- `pdf-frame.html` charge un **script classique** `pdf-frame.js` (build Vite séparé en format IIFE) contenant pdf.js (`pdfjs-dist@6.5.438`) et son code de worker importé sur le fil principal (`globalThis.pdfjsWorker`), plus `pdf-frame.css`. Le serveur sert ces trois fichiers avec `Cross-Origin-Resource-Policy: cross-origin` (S10) ; ils ne contiennent aucun secret.
- Options pdf.js : `disableWorkerRendering: true`, `enableXfa: false`, `useWasm: false` (aucune requête `fetch` depuis l'origine opaque), pas de calque d'annotations ni de calque de texte (pas de liens actifs, pas de formulaires), rendu en `<canvas>` page par page, à la demande au défilement.
- Données : le parent envoie `{ type: "pdf", bytes }` (ArrayBuffer **transféré**) à `iframe.contentWindow` seulement, après avoir reçu `{ type: "ready" }` venu de `event.source === iframe.contentWindow`. Le cadre n'accepte que les messages de `window.parent` et renvoie `{ type: "rendered", pages }` ou `{ type: "error" }`. Cible `"*"` imposée par l'origine opaque ; la vérification porte sur `event.source`.
- Commandes dans le cadre : page précédente/suivante, zoom −/+, ajustement à la largeur ; libellés passés par le parent (i18n).
- Échec (erreur, délai de 20 s, PDF chiffré par mot de passe) : « Ce PDF ne peut pas être affiché ici. » + Enregistrer.
- Le prototype de la première tâche PDF décide : s'il échoue sur Chromium **ou** WebKit, la visionneuse est retirée et `pdf` devient « Enregistrer seulement » (spec §12).

---

## 14. PWA et serveur statique

### 14.1 Manifeste et icônes (sans service worker, spec §10)

- `web/public/manifest.webmanifest` : `name` « Shhdrop », `short_name` « Shhdrop », `lang` « fr », `start_url` « / », `scope` « / », `display` « standalone », `background_color` et `theme_color` `#0B0D12`, `description` = `hero.lede` (FR), icônes : `icon.svg` (`any`), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (`maskable`, zone sûre de 80 %).
- `apple-touch-icon.png` 180 × 180 ; `<meta name="theme-color" content="#0B0D12">` et sa variante claire `#F4F5F8` (`media="(prefers-color-scheme: light)"`).
- PNG produits par un script à partir du SVG (`web/scripts/gen-icons.mjs`, avec `ffmpeg` ou `rsvg-convert` sur la machine de développement) et commités ; aucune dépendance npm d'image.
- Installation vérifiée à la main (spec §14) : « Ajouter à l'écran d'accueil » sur iPhone et Android, installation sur Chrome ordinateur.

### 14.2 Serveur statique Go (`SHH_STATIC_DIR`)

- `SHH_STATIC_DIR` pointe sur `web/dist`. Au démarrage : dossier et `index.html` doivent exister, sinon refus de démarrer (audit F7).
- Fichiers : servis s'ils existent, **jamais** de liste de dossier, **jamais** un nom qui commence par « . » (404).
- Repli SPA : `GET` de `/`, `/s/{id}`, `/m/{id}`, `/securite`, `/confidentialite` → `index.html` (200) ; toute autre route inconnue → `index.html` avec le code 404 (l'interface affiche sa page 404).
- `X-Robots-Tag: noindex` sur `/s/*` et `/m/*` ; `robots.txt` : `Disallow: /s/`, `Disallow: /m/`.
- `Cross-Origin-Resource-Policy: cross-origin` sur `/pdf-frame.js`, `/pdf-frame.css`, `/pdf-frame.html` seulement.
- Les en-têtes de sécurité existants (dont `Cache-Control: no-store`) restent sur toutes les réponses.

---

## 15. Dépendances ajoutées (versions exactes)

| Paquet | Version | Licence | Rôle | Pourquoi |
|---|---|---|---|---|
| `svelte` | 5.57.3 | MIT | Écrans | Choisi par la spec (§6) |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 (dev) | MIT | Build | Compatible Vite 8 (`peerDependencies`) |
| `altcha` | 2.3.0 | MIT | Widget anti-robot (`dist_external`) | S3 |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | PDF isolé | Spec §6 |
| `@lucide/svelte` | 1.68.0 | ISC | Icônes | §6 |
| `uqr` | 0.1.3 | MIT | Matrice du QR code (Reed-Solomon) | 27 Ko non compressé, sans dépendance, chargé à la demande ; écrire soi-même un encodeur QR est une source d'erreurs inutile ; le rendu SVG est fait par notre code à partir de la matrice (`encode()`), jamais par `renderSVG` + `{@html}` |
| `@fontsource-variable/mona-sans`, `@fontsource-variable/jetbrains-mono` | 5.3.0 (dev) | OFL-1.1 | Source des fichiers de police copiés | §4.1 |
| `@playwright/test` | 1.64.1 (dev) | Apache-2.0 | Parcours e2e Chromium et WebKit | Spec §14 |
| `@axe-core/playwright` | 4.14.0 (dev) | MPL-2.0 | Accessibilité | §11 |
| `typescript` (outil `svelte-check` seulement) | 6.0.3 (dev, paquet séparé) | Apache-2.0 | Vérification des `.svelte` | S5 |
| `svelte-check` | 4.7.8 (dev, paquet séparé) | MIT | Idem | S5 |

Toutes épinglées sans plage, `package-lock.json` commité, `npm audit` et licences ajoutées à `THIRD_PARTY_LICENSES.md`. Aucune autre dépendance d'exécution.

---

## 16. Hors du Plan 2

- Pages Mentions légales, CGU, Contact (S16) → Plan 3, avant l'ouverture au public.
- Compteur de signalements en mémoire, alertes → Plan 3.
- Mise en cache longue des fichiers à empreinte (`/assets/*`) : aujourd'hui `no-store` partout (simple et sûr) ; optimisation possible plus tard, à décider (Q4).
- Coller une image depuis le presse-papier, partage depuis la galerie, lecture vidéo pendant le téléchargement : non prévus (spec §3).

---

## 17. Questions ouvertes pour le propriétaire

| # | Question | Choix par défaut appliqué |
|---|---|---|
| Q1 | ALTCHA : garder le widget `altcha@2.3.0` (dernière v2, compatible avec notre serveur, mais pas « dernière version » au sens de §24) ou le remplacer par un solveur de 30 lignes sans dépendance ? | Widget 2.3.0, écart noté à §23 |
| Q2 | Thème clair « Aube » : suivre le réglage du système (exigé par la spec §3 et §19), ou toujours sombre ? | Suivre le système, sombre par défaut |
| Q3 | Valeurs par défaut des options : 24 h et 1 ouverture ? | Oui |
| Q4 | Mise en cache longue des fichiers à empreinte (`/assets/*`, `immutable`) pour accélérer les visites suivantes ? | Non (tout en `no-store`) |
| Q5 | Demander à la branche de durcissement `Opened.destroy(reason)` (S1, S2) et `keepalive` sur `done` (S12) avant le début du Plan 2 ? | Oui ; repli décrit en §9.10 en attendant |
