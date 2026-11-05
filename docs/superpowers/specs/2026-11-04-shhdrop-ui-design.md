# Shhdrop — spécification de l'interface (Plan 2)

Date : 4 novembre 2026 · Révision 3 (décisions du propriétaire du 4 novembre, analyse critique §18, pré-vol du plan P1–P43 du 5 novembre, Q2 et Q3 réglées) · Statut : à valider par le propriétaire
Spécification de référence : `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (notée « spec » ci-dessous, avec ses numéros de section, dans sa version v2.5, amendée le 5 novembre pour l'exception reCAPTCHA (§26), fusionnée sur `main`). En cas de conflit, la spec l'emporte, sauf décision du propriétaire notée en §0.2.
Plan d'exécution : `docs/superpowers/plans/2026-11-04-shhdrop-ecrans.md`.

Brief du propriétaire (impératif) : « interface pro d'expert, jolie, avec animations, très belle, 2027 ». Monde visuel : **« Nuit chiffrée »**, toujours sombre. Français et anglais. PWA pensée d'abord pour le téléphone, très bonne aussi sur ordinateur.

Modes de surface : **Operate** (tâche) pour composer, envoyer, gérer, ouvrir et lire ; **Persuade** pour un en-tête d'accueil court, au-dessus du formulaire de composition, sur la même page ; **Read** pour les pages Sécurité et Confidentialité.

---

## 0. Ce qui lie l'interface

### 0.1 API cliente

L'interface n'importe que `web/src/index.ts`. Elle n'importe jamais `transfer/api.ts` ni `crypto/*` (audit M1). `expectedOrigin` vaut toujours `location.origin`. L'interface ne fabrique jamais d'URL d'API.

**Existant (sur `main` depuis la fusion du durcissement, spec §25) :**

| Fonction | Usage dans l'interface |
|---|---|
| `createShare(origin, items, opts)` → `{ link, manage, expiresInS }` | Envoi. `items` : `Item[]` (`{ kind: "text" \| "file", name, mime, data: Uint8Array \| Blob }`) dans l'**ordre** voulu (l'ordre du manifeste est celui du tableau). `opts` : `ttlHours`, `maxOpens`, `password`, `solveCaptcha(challenge, ctx)`, `prepared?` (défi et preuve pré-calculés, voir les compléments ci-dessous), `onProgress(done, total)` en segments de 4 Mio |
| `fetchMeta(link, expectedOrigin)` → `{ expiresInS }` | Écran d'ouverture, sans consommer d'ouverture |
| `openShare(link, password, expectedOrigin, onProgress?)` → `Opened` | Déverrouillage (consomme une ouverture). `onProgress(n, total)` compte les segments lus, tous éléments confondus |
| `Opened.manifest` | Liste des éléments (textes inclus) |
| `Opened.safeName(i)` | **Seul** nom affiché ou proposé à l'enregistrement |
| `Opened.previewKind(i)` | `"image" \| "audio" \| "video" \| "text" \| "pdf" \| "none"` : **seule** source du choix de visionneuse (`none` au-delà de 200 Mio) |
| `Opened.isRiskyFile(i)` | Avertissement avant enregistrement |
| `Opened.item(i)` | Non utilisé : toute lecture passe par `saveItem`, dont l'interface compte les octets (§9.8) |
| `Opened.saveItem(i, sink)` | Aperçu et enregistrement, en flux |
| `Opened.done()` | Fin de lecture ; part en `keepalive` (survit à la fermeture de la page) |
| `Opened.destroy(reason?: "report")` | Destruction ou signalement par le destinataire, **même en état `draining`** ; motif non conservé par le serveur ; `Error("cles_effacees")` après `wipe()` |
| `Opened.wipe()` | Mise à zéro au mieux |
| `destroyShare(link, expectedOrigin, { password? })` | Utilisé **seulement** avec le lien de gestion (expéditeur). Jamais avec le lien de partage : le destinataire passe par `Opened.destroy` |
| `shareStatus(manage, expectedOrigin)` → `{ opensUsed, maxOpens, expiresInS, state }` | Page de gestion |
| `parseLink(url)` | `{kind:"s", origin, id, kLien}` ou `{kind:"m", origin, id, sGestion}` |
| `generatePassphrase(n ≥ 4)`, `checkPassword(pw)`, `PW_MIN_CHARS` | Écran d'options |
| `collectToBlob(opened, i)` | Repli d'enregistrement (Blob `application/octet-stream`) |
| `CAPTCHA_MIN_MS` | 3 100 ms : `createShare` attend lui-même ce délai, compté depuis la **réception du défi** (un défi préparé à l'avance a déjà consommé son attente) |
| Erreurs | `BadPasswordError{attemptsLeft}`, `NotFoundError`, `LimitError{retryAfterS}`, `Error("reseau")`, `Error("lien_invalide")`, `Error("origine_invalide")`, `Error("mot_de_passe_requis")` (mot de passe vide à l'ouverture) ; côté envoi, codes du serveur `Error("full")` (507), `Error("frozen")` (503), `Error("bad_request")`, `Error("internal")`, et erreurs locales (`vide`, `trop_d_elements`, `trop_gros`, `texte_trop_long`, `mot_de_passe_trop_court`, `mot_de_passe_trop_courant`, `duree_invalide`, `ouvertures_invalides`) ; erreurs du navigateur relayées telles quelles (`NotReadableError`, `NotFoundError` DOM d'un `File` devenu illisible) |

**Compléments demandés par ce plan (Task 0 du plan, dans `web/src/transfer/`, avec tests) :**

| Ajout | Contrat | Raison |
|---|---|---|
| `CreateOpts.signal?: AbortSignal` | Annulation à tout moment. Avant la création : rien n'existe sur le serveur. Après : l'appel `destroy` déjà présent dans le chemin d'échec de `createShare` (avec `S_gestion`, accepté par le serveur en état `uploading`) part en `keepalive`. Rejet par `DOMException("AbortError")` | Bouton Annuler, `pagehide` pendant l'envoi (§9.4). **Aucune nouvelle route serveur** : voir §18, A7 |
| `CreateOpts.onBytes?(sent, total)` | Octets **chiffrés** envoyés / total chiffré du palier, mis à jour pendant chaque segment ; la valeur émise est le **maximum atteint** (monotone : un segment réessayé n'émet rien avant de dépasser ce maximum) (`XMLHttpRequest.upload.onprogress` pour les `PUT` de segment dans le navigateur ; `fetch` reste utilisé partout ailleurs et en Node) | Vitesse, temps restant, détection de coupure fiables (§18, A3) |
| `CreateOpts.pause?: () => Promise<void>` | Attendue avant chaque segment : la pause prend effet à la fin du segment en cours | Pause / Reprendre (§9.4) |
| `CreateOpts.onRetry?({ attempt, inMs, offline })` + budget de coupure | Un segment qui échoue (coupure, 5xx, 429) est réessayé sans limite de nombre (attentes 1, 2, 4, 8, 16 puis 30 s ; `Retry-After` d'une 429 respecté ; essai immédiat sur l'événement `online` ; aucun essai interne, le budget seul réessaie) jusqu'à l'**échéance unique `SERVER_STALL_MS`** : 13 min après le dernier segment acquitté, au-delà `Error("reseau")`. `finalize` suit la même règle (rejouable : il ne fait que constater). 13 min < 15 min, délai d'effacement d'un envoi bloqué (spec §7.4 et §24) : marge de 2 min. La pause (§9.4.4) est bornée par la même échéance | Reprise automatique réelle (spec §13) au lieu d'un abandon après 15,5 s (§18, A4) |
| `solveCaptcha(challenge, ctx)` → `CaptchaProof` | `ctx = { fallbackOrigin: string \| null, mode: "pow" \| "fallback" }` (`fallbackOrigin` lu dans la réponse de `GET /api/captcha` ; `mode` vaut `"pow"` sauf au dernier essai, imposé par l'écran d'envoi, §9.4.2) ; `CaptchaProof = { kind: "pow", payload: string } \| { kind: "recaptcha", token: string }`. Le corps de création porte `altcha` **ou** `recaptcha` (+ **`captcha_salt`**, le sel du défi émis, pour lier `shown_at` ; la clé `salt` du corps reste le sel KDF) | Repli reCAPTCHA (§15) |
| `cleanName(name)` exporté (alias de `safeName`) | La fonction de nettoyage déjà utilisée par `safeName`, appliquée aux noms affichés côté expéditeur | Noms piégés affichés chez l'expéditeur (§18, A31) |
| `prepareCaptcha(origin, net?)` → `PreparedCaptcha` ; `CreateOpts.prepared?: { cap, proof }` | Récupère le défi à l'avance (`GET /api/captcha`, instant de réception noté ; `PreparedCaptcha` expose `challenge`, `fallbackOrigin`, `expiresAt`, le reste est interne). `createShare` utilise `prepared` s'il reste plus de 15 s de validité, sinon il lit un nouveau défi. Les écrans n'appellent jamais `/api/captcha` eux-mêmes | Pré-calcul de la preuve de travail dès le premier élément composé (Q2, §9.4.2) |
| `SERVER_STALL_MS` (13 min), `PREVIEW_MAX` | Constantes exportées par `index.ts` : échéance unique de la pause et de la coupure ; taille maximale d'aperçu (l'écran ne recopie pas la valeur de `crypto/container`) | §9.4.3, §9.4.4, §9.8 |

### 0.2 Décisions du propriétaire (4 novembre, contraignantes)

| # | Décision | Effet dans ce document |
|---|---|---|
| P1 | **Toujours sombre** « Nuit chiffrée » : thème clair « Aube » supprimé | §3 (un seul jeu de jetons), §11, §14.1 (un seul `theme-color`), plan (tests et captures sombres seulement). Écart avec spec §3 et §19 (« clair et sombre ») à reporter dans la spec (§18, A25) |
| P2 | **Défauts : 12 h et 1 ouverture** | §9.3 |
| P3 | **Anti-robot** : preuve de travail maison (Worker, WebCrypto) ; **repli Google reCAPTCHA** isolé dans un cadre d'une autre origine, seulement si la preuve échoue | §9.4.2, §15, tâches serveur et client du plan. Exception validée par le propriétaire le 5 novembre : CLAUDE.md et spec v2.5 §26 amendés (§18, A1 réglé) |
| P4 | **Composer** : glisser-déposer, coller, regroupement par catégorie, réordonnancement, retrait, doublons ; renommage à décider | §9.2 (renommage retenu, §18, A10) |
| P5 | **Jauge** de taille et de nombre, vivante, dépassement visible avant l'envoi | §9.2.5 |
| P6 | **Écran d'envoi** complet : progression, vitesse, temps restant, segments, phases, coupure et reprise, Pause, Annuler (suppression côté serveur), sceau lié à la vraie progression ; après succès, « Supprimer ce partage » | §7.3, §9.4, §9.5 |
| P7 | **Penser à tout** : états limites des deux côtés | §9 (tableaux d'états), §18 |
| P8 | **Démo sur GitHub Pages** (`skoow.github.io/Shhdrop`) : build à part, faux serveur en mémoire, vrai chiffrement, bandeau permanent, anti-robot désactivé, CSP par meta ; publiée à chaque push sur `main` | §14.3 ; tâche « Démo » tôt dans le plan, puis mise à jour à chaque tâche d'écran |

### 0.3 Reports du Plan 1 traités ici

| Report (`2026-11-04-shhdrop-coeur-decisions.md`) | Traitement |
|---|---|
| Nouveau défi anti-robot à chaque création | `createShare` le fait ; l'interface ne garde aucun défi et rappelle `createShare` en entier pour un nouvel essai (§9.4) |
| Widget ALTCHA compatible `altcha-lib-go` v1 | Remplacé par un solveur maison (P3, §9.4.2) : aucune dépendance |
| Garder `K_preuve` pour détruire pendant `draining` | Fait par `Opened.destroy` (spec §25, S1) |
| Un mauvais mot de passe à la destruction coûte un essai | Sans objet : le destinataire détruit par `Opened.destroy`, sans ressaisie |
| Abandonner le fichier partiel si `saveItem` échoue | `writable.abort()` et message explicite (§9.9) |
| `done()` ; « en cas d'échec, l'ouverture est perdue » | « Terminer et effacer », `pagehide`, avertissement avant déverrouillage (§9.7) |
| `finalize` non réessayé | Réessayé dans le budget de coupure (§0.1) ; sinon « Le transfert a été interrompu, réessayez » |
| Serveur statique : repli SPA, ni liste de dossiers ni fichiers cachés | Déjà livré sur `main` par le durcissement (`server/cmd/shhdrop/static.go`) ; ce plan n'ajoute que des en-têtes par chemin (§14.2) |
| Noms et types MIME du manifeste non fiables | `safeName`, `previewKind`, Blob `application/octet-stream` (§12) |
| Mise à jour vite/vitest avant tout `vite dev` | Fait sur `main` (vite 8.3.5, vitest 5.1.0) |

---

## 1. Signalements de la révision 1 (état au 4 novembre)

| # | Gravité | Sujet | État |
|---|---|---|---|
| S1 | Important | Destruction par le destinataire en `draining` | **Réglé** par `Opened.destroy` (spec §25). Le repli « mot de passe gardé en mémoire » est supprimé : moins de secret retenu |
| S2 | Important | Motif de signalement | **Réglé autrement** : l'API n'envoie que `"report"`, le serveur ne garde rien. L'écran ne propose plus de choix de motif (§18, A13) |
| S3 | Important | ALTCHA 3.x ne lit plus les défis v1 | **Sans objet** : solveur maison (P3) |
| S4 | Important | `replaceState` immédiat casse « Ouvrir dans le navigateur » des apps | Maintenu (§12.1) |
| S5 | Important | `svelte-check` et TypeScript 7 | Maintenu : paquet outil séparé sur `typescript@6.0.3` |
| S6 | Important | JPEG d'iPhone : MPF et images secondaires | Maintenu (§9.2.6) |
| S7 | Moyen | AVIF, GIF, bureautique non nettoyés | Maintenu |
| S8 | Moyen | Trusted Types incompatibles avec Svelte 5 | Maintenu : CSP sans Trusted Types, constaté par un test |
| S9 | Moyen | Attributs `style` statiques bloqués par la CSP | Maintenu |
| S10 | Moyen | pdf.js dans un cadre à origine opaque | Maintenu (§13) |
| S11 | Moyen | Recharger avant de déverrouiller perd la clé | Maintenu (« Lien incomplet », §9.11) |
| S12 | Moyen | `done()` pendant `pagehide` | **Réglé** (`keepalive`, spec §25) |
| S13 | Mineur | Thème clair | **Tranché** : toujours sombre (P1) |
| S14 | Mineur | Jauge « 34 / 100 Mo » périmée | Maintenu : « 34 Mo / 1 Go · 3 / 10 » |
| S15 | Mineur | Spec §22 « 300 Mio par jour » contre §24 | Maintenu, à aligner dans la spec |
| S16 | Mineur | Pages légales | Maintenu : Plan 3, avant toute ouverture au public |
| S17 | Mineur | Progression de lecture | **Réglé** : `openShare(…, onProgress)` existe ; l'interface compte aussi les octets du `sink` |

---

## 2. Monde visuel « Nuit chiffrée »

**Thèse.** La nuit d'un écran de téléphone dans une main, tard, quand on envoie quelque chose de privé. Un fond presque noir, profond et légèrement bleuté ; une seule lumière, menthe, qui marque ce qui est scellé, actif ou sûr. Le produit a deux gestes : **sceller** (le contenu devient illisible, un trait de lumière fait le tour de la capsule et se referme) et **dissoudre** (le contenu se défait en grain et disparaît). Tout le reste est calme, précis, dense quand il le faut. Le sombre est choisi pour la scène d'usage (soir, téléphone, contenu privé) : `color-scheme: dark` sur `:root`, pour que les contrôles natifs, les barres de défilement et les sélecteurs du système soient sombres eux aussi.

**Ce que le monde refuse.** Le dégradé violet des produits « IA », le texte en dégradé, les halos colorés sans décalage autour des boutons, les cadenas en 3D, le vocabulaire « militaire », les cartes identiques icône + titre + texte comme structure de page, les étiquettes au-dessus des titres, les numéros de section décoratifs, « 100 % sécurisé ».

**Signature reconnaissable sans contenu.** Fond `#0B0D12` ; surfaces à peine plus claires, séparées par des filets fins ; un trait menthe de 1 à 2 px qui parcourt le bord de la capsule ; chiffres tabulaires ; phrase de passe en chasse fixe, mots séparés par des tirets fins ; grain discret au moment de la dissolution.

**Lumière d'ambiance.** Un seul champ lumineux à l'échelle de la page : un dégradé radial menthe à 6 % d'opacité, très large (120 vw), centré au-dessus du haut de l'écran, fixe. Ce n'est pas un halo autour d'un élément. Retiré en `prefers-contrast: more` et en `forced-colors: active`.

---

## 3. Couleurs

Stratégie **Restreinte** : neutres teintés de bleu nuit + un accent menthe, réservé aux actions principales, à l'état « scellé », à la sélection et au focus. Le rouge ne sert qu'à la destruction et aux erreurs. **Un seul thème** (P1).

### 3.1 Jetons

| Jeton | Hex | Usage |
|---|---|---|
| `--bg` | `#0B0D12` | Fond de page |
| `--surface-1` | `#12151C` | Panneaux, barre d'actions |
| `--surface-2` | `#191D27` | Champs, capsule, lignes d'éléments |
| `--surface-3` | `#202533` | Ligne en cours de déplacement, en-tête de catégorie survolé |
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
| `--accent-tint` | `#102A23` | Fond d'état « scellé », badge « nettoyé », zone de dépôt active |
| `--danger` | `#FF8A80` | Destruction, erreurs, jauge dépassée |
| `--on-danger` | `#1A0605` | Texte sur bouton de destruction |
| `--danger-tint` | `#2A1414` | Fond de bandeau d'erreur |
| `--warn` | `#F2C46D` | Avertissements (navigateur intégré, fichier à risque, non nettoyé, doublon, jauge > 90 %) |
| `--warn-tint` | `#2A2312` | Fond de bandeau d'avertissement |
| `--info` | `#8DB2FF` | Liens dans le texte, informations neutres |
| `--selection` | `rgb(95 227 181 / 0.28)` | `::selection` |
| `--scrim` | `rgb(5 7 10 / 0.72)` | Voile de la cible de dépôt pleine page (§9.2.2) et `::backdrop` |

### 3.2 Contrastes vérifiés (WCAG 2.1, formule de luminance relative)

Calculés pour cette spécification ; la tâche « jetons » du plan les recalcule dans un test unitaire qui échoue sous le seuil.

| Paire | Ratio | Seuil |
|---|---|---|
| `--text` / `--bg` | 16,42 | 4,5 |
| `--text` / `--surface-2` | 14,24 | 4,5 |
| `--text` / `--surface-3` | 12,92 | 4,5 |
| `--text-2` / `--surface-2` | 7,55 | 4,5 |
| `--text-2` / `--surface-3` | 6,85 | 4,5 |
| `--text-3` / `--surface-2` | 5,45 | 4,5 |
| `--accent` / `--bg` | 12,16 | 3 (focus, bord) |
| `--on-accent` / `--accent` | 11,80 | 4,5 |
| `--on-accent` / `--accent-hover` | 13,45 | 4,5 |
| `--danger` / `--surface-2` | 7,38 | 4,5 |
| `--on-danger` / `--danger` | 8,58 | 4,5 |
| `--danger` / `--danger-tint` | 7,61 | 4,5 |
| `--warn` / `--warn-tint` | 9,57 | 4,5 |
| `--warn` / `--surface-2` | 10,34 | 4,5 |
| `--accent` / `--accent-tint` | 9,54 | 4,5 |
| `--info` / `--surface-2` | 7,98 | 4,5 |
| `--line-strong` / `--surface-2` | 3,50 | 3 (bord de champ) |
| `--text` / verre sur fond blanc (pire cas : photo claire qui défile dessous) | 8,26 | 4,5 |
| `--text-2` / verre sur fond blanc | **4,38** | 4,5 → **interdit** |

Règle : **sur le verre, seul `--text` (et les boutons opaques) est permis**. Les valeurs `--surface-3` et `--warn` / `--surface-2` sont nouvelles : le test les vérifie comme les autres.

### 3.3 Contraste forcé (`forced-colors: active`, Windows)

- Focus : `outline: 2px solid CanvasText` ; boutons principaux : `border: 1px solid ButtonText` ; jauge, trait de la capsule, barres de progression : `Highlight` sur `Canvas` ; badges : bord `CanvasText`.
- Lumière d'ambiance, grain, verre et ombres retirés. Les icônes suivent `currentColor` (déjà le cas).

---

## 4. Typographie

### 4.1 Familles (hébergées, fichiers dans le dépôt)

| Rôle | Police | Licence | Fichier | Poids |
|---|---|---|---|---|
| Tout le texte d'interface et l'accueil | **Mona Sans** (GitHub), variable `wght` 200–900 et `wdth` 75–125 | SIL Open Font License 1.1 | `web/public/fonts/mona-sans-latin-standard-normal.woff2`, depuis `@fontsource-variable/mona-sans@5.3.0` | 98 124 octets |
| Phrase de passe, liens, champ du mot de passe, détails techniques de l'envoi | **JetBrains Mono**, variable `wght` 100–800 | SIL Open Font License 1.1 | `web/public/fonts/jetbrains-mono-latin-wght-normal.woff2`, depuis `@fontsource-variable/jetbrains-mono@5.3.0` | 40 404 octets |

- Le sous-ensemble `latin` couvre le français (accents, « œ », guillemets, espaces fines, « … », « − »). Il ne contient pas « ≈ » ni les flèches : les textes n'en utilisent pas (les raccourcis clavier s'écrivent « Alt + flèche haut »). Les noms de fichiers en écritures non latines (arabe, hébreu, chinois…) s'affichent avec la police système de repli : c'est voulu, aucun sous-ensemble supplémentaire n'est chargé.
- Empreintes SHA-256 attendues : Mona Sans `5ea3740633e5ac7af56c13d7e8ec32bcae12e7723e53d34284469a8947ccb2f3`, JetBrains Mono `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e`.
- Fichiers **copiés** dans `web/public/fonts/` par `web/scripts/copy-fonts.mjs`, empreinte vérifiée par un test, puis commités. Licence OFL ajoutée à `THIRD_PARTY_LICENSES.md`.
- `@font-face` dans `web/src/ui/fonts.css` : `font-display: swap`, `unicode-range` du sous-ensemble latin, plages de `font-weight` et `font-stretch`. Préchargement de Mona Sans seulement.
- Pourquoi Mona Sans : une grotesque d'outil, nette en petit, avec un axe de **largeur** qui donne à l'accueil une voix propre sans seconde famille. Pourquoi une chasse fixe : la phrase de passe, les liens et les mesures d'envoi sont des données qu'on recopie, dicte ou compare ; elle ne sert nulle part ailleurs.
- Repli : `"Mona Sans", system-ui, sans-serif` et `"JetBrains Mono", ui-monospace, monospace`.

### 4.2 Échelle (rem fixes, rapport ≈ 1,2 ; titre d'accueil seul fluide)

| Jeton | Taille / interligne | Poids | Largeur (%) | Usage |
|---|---|---|---|---|
| `--fs-display` | `clamp(2.5rem, 1.6rem + 4vw, 4.25rem)` / 1.02 | 620 | 118 | Titre d'accueil uniquement ; approche −0,03 em |
| `--fs-h1` | 1.75rem / 1.15 | 650 | 108 | Titre d'écran |
| `--fs-h2` | 1.4375rem / 1.2 | 620 | 104 | Titre de section, capsule |
| `--fs-h3` | 1.1875rem / 1.3 | 600 | 100 | Sous-section, en-tête de catégorie |
| `--fs-body` | 1rem / 1.5 | 430 | 100 | Texte courant (16 px minimum sur téléphone, y compris dans les champs : sinon Safari iOS zoome au focus) |
| `--fs-small` | 0.875rem / 1.45 | 450 | 100 | Indications, méta |
| `--fs-micro` | 0.75rem / 1.4 | 520 | 100 | Unités, compteurs ; jamais pour une phrase |
| `--fs-mono` | 1.0625rem / 1.5 | 480 | — | Phrase de passe (en bloc : 1.25rem) |
| `--fs-figure` | 2.75rem / 1 | 560 | 112 | Pourcentage de l'envoi, dans la capsule |

- Chiffres : `font-variant-numeric: tabular-nums` pour la jauge, la progression, la vitesse, le compte à rebours, les tailles.
- Titres : `text-wrap: balance` ; paragraphes : `text-wrap: pretty`, mesure 65 ch au plus.
- Typographie française dans `fr.ts` : espace fine insécable (U+202F) avant « ; : ! ? » et à l'intérieur des guillemets, espace insécable (U+00A0) entre nombre et unité (« 34 Mo », « 4 h 15 », « 2,1 Mo/s »).

---

## 5. Espacement, rayons, élévation, verre

### 5.1 Espacement (base 4 px)

`--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48 · `--sp-8` 64 · `--sp-9` 96 (px). Groupes serrés (`--sp-2`/`--sp-3`), séparation large (`--sp-6`/`--sp-7`), plus d'espace au-dessus d'un titre qu'en dessous. Marge latérale : 16 px sous 600 px, 24 px jusqu'à 960 px, puis contenu centré, largeur maximale 1120 px. Les marges latérales et la barre collée du bas ajoutent `env(safe-area-inset-left/right/bottom)` (encoche, barre d'accueil, paysage).

### 5.2 Rayons

`--r-sm` 6 px (puces, badges) · `--r-md` 10 px (champs, boutons) · `--r-lg` 16 px (panneaux, lignes d'éléments) · `--r-xl` 24 px (capsule scellée, feuilles) · `--r-pill` 999 px (contrôle segmenté). Rayon intérieur = rayon extérieur − marge.

### 5.3 Élévation (ombres décalées et floues, jamais un halo centré)

| Jeton | Valeur | Usage |
|---|---|---|
| `--e-1` | `0 1px 2px rgb(0 0 0 / .40)` | Lignes d'éléments, champs |
| `--e-2` | `0 8px 24px -8px rgb(0 0 0 / .60), 0 2px 6px rgb(0 0 0 / .35)` | Capsule, panneaux, ligne soulevée pendant un déplacement |
| `--e-3` | `0 24px 64px -16px rgb(0 0 0 / .70)` | Feuilles (`<dialog>`) |
| `--edge` | `inset 0 1px 0 rgb(255 255 255 / .05)` | Arête haute des surfaces |

### 5.4 Verre : usage restreint et justifié

Le verre ne sert qu'aux éléments **sous lesquels le contenu défile** : la barre d'en-tête une fois la page défilée, la barre d'actions collée en bas sur téléphone, le `::backdrop` des feuilles (`--scrim` + flou 8 px). Ailleurs : surfaces opaques. Repli si `backdrop-filter` manque, si `prefers-reduced-transparency: reduce` ou en `prefers-contrast: more` : `--surface-1` plein. Sur le verre, seul `--text` (§3.2).

---

## 6. Icônes

- **Lucide**, via `@lucide/svelte@1.68.0` (ISC), un composant par icône importé nommément. Aucun chargement extérieur, aucun `{@html}`.
- Trait 1,75 px, taille 20 px (24 px dans les boutons principaux), `currentColor`, `aria-hidden="true"` ; le libellé est porté par le texte du bouton ou `aria-label`.
- Jeu fermé (toute icône ajoutée passe en revue) : `paperclip` (fichiers), `camera` (photo), `mic` / `square` (vocal / arrêt), `type` (texte), `clipboard-paste` (coller), `x` (retirer), `undo-2` (annuler un retrait), `pencil` (renommer, modifier un texte), `grip-vertical` (poignée de déplacement), `arrow-up` / `arrow-down` (monter / descendre en mode déplacement), `lock` / `lock-open`, `shield-check` (nettoyé), `shield-alert` (vérification anti-robot de repli), `triangle-alert` (avertissement), `copy` / `check` (copié), `share-2`, `qr-code`, `refresh-cw` (régénérer, actualiser), `eye` / `eye-off`, `clock`, `timer` (reprise automatique), `pause` / `play`, `download`, `file`, `file-text`, `image`, `music`, `audio-lines` (vocal), `film`, `folder-x` (dossier refusé), `trash-2` (détruire, supprimer), `flag` (signaler), `external-link` (navigateur intégré), `chevron-left`, `languages`, `wifi-off`, `clipboard-x` (vider le presse-papier), `circle-help`, `minus` / `plus` (Stepper), `info` (bandeau d'information).
- Aucun emoji ni caractère Unicode (« ✕ », « ✓ », « ⋯ ») à la place d'une icône.
- Logo : mot-symbole « shhdrop » en Mona Sans 650, largeur 112, minuscules, précédé d'un pictogramme dessiné (SVG du dépôt) : une capsule arrondie dont le contour est un trait ouvert de 300° qui se referme. Le même dessin sert aux icônes PWA (§14).

---

## 7. Mouvement

### 7.1 Principe

Un seul moment écrit par geste du produit : **le scellement** (envoi) et **la dissolution** (fin de vie). Partout ailleurs, le mouvement explique un changement d'état, vite. Aucun chargement chorégraphié, aucune apparition au défilement, aucun survol qui soulève. Le réordonnancement des lignes est un changement d'état : FLIP de 180 ms, pas un moment.

### 7.2 Jetons

| Jeton | Valeur | Usage |
|---|---|---|
| `--dur-instant` | 120 ms | Pression, copie confirmée, bascule |
| `--dur-fast` | 180 ms | Survol, focus, changement de libellé, déplacement d'une ligne |
| `--dur-base` | 240 ms | Apparition d'un bandeau, d'une ligne, transition du trait de progression |
| `--dur-slow` | 400 ms | Changement d'étape, ouverture d'une feuille, regroupement en capsule |
| `--dur-moment` | 640 ms | Fermeture du sceau |
| `--dur-dissolve` | 1100 ms | Dissolution |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Arrivées |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Sorties (durée × 0,7) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Dissolution |

Aucun rebond ni ressort.

### 7.3 Le scellement (écran d'envoi, §9.4)

Une **capsule** : surface `--surface-2`, rayon `--r-xl`, qui résume l'envoi (« 3 éléments · 34 Mo », icônes des catégories, noms des éléments sur une ligne chacun, 4 au plus puis « + 6 autres »). Par-dessus son bord, un `<svg>` aux dimensions de la capsule contient un `<rect>` aux mêmes rayons, `pathLength="100"`, trait `--accent`, `stroke-dasharray: 100`. Le tracé **commence et finit au milieu du bord haut**, marqué par une encoche fixe de 2 px en `--line-strong` : on lit d'où part la progression. Au centre : le pourcentage en `--fs-figure` pendant l'envoi.

1. **Regroupement** (au clic « Chiffrer et envoyer », 400 ms, `--ease-out`). Les lignes du composeur glissent vers la capsule (FLIP en Web Animations API, `transform` et `opacity` seulement, décalage de 30 ms entre lignes, 270 ms cumulés au plus). Le composeur n'est pas détruit : il est masqué (`inert`, `hidden`) et revient intact en cas d'échec ou d'annulation.
2. **Préparation des clés et vérification anti-robot** (durée réelle, indéterminée). Un trait court (8 unités sur 100) parcourt le bord en boucle, 1,6 s par tour, linéaire. Le libellé de phase change en fondu de 180 ms.
3. **Chiffrement et envoi** (durée réelle). Le trait devient la barre de progression : `stroke-dashoffset = 100 − 100 × envoyé / total` en **octets** (`onBytes`), lissé par une transition de 240 ms. Les noms des éléments deviennent illisibles en proportion : `filter: blur(calc(var(--p) * 5px))`, opacité 1 → 0,55. C'est vrai : chaque segment est chiffré juste avant son envoi.
4. **Pause** : le trait s'arrête et passe en `--text-3` (180 ms) ; reprise : retour en `--accent`. **Coupure** : le trait reste où il est et pulse en opacité (1 ↔ 0,5, 1,6 s) ; le bandeau de coupure explique (§9.4.3).
5. **Fermeture du sceau** (après la résolution de `createShare`, donc après `finalize`, 640 ms). Le trait se referme (100 %) et s'épaissit de 1 à 2 px ; l'icône `lock-open` laisse place à `lock` (l'anse descend de 3 px, 220 ms) ; la capsule se comprime d'un souffle (1 → 0,985 → 1, 280 ms) puis monte de 8 px pendant que le panneau « Lien prêt » se déplie dessous (`grid-template-rows: 0fr → 1fr`, 320 ms), trois blocs décalés de 60 ms. **Jamais avant** la résolution : à 100 % des octets, la capsule affiche « Finalisation… » avec le trait plein mais fin.
6. **Échec ou annulation**. Le trait s'arrête où il est et passe en `--danger` (échec) ou `--text-3` (annulation), 180 ms ; aucun tremblement. Le message apparaît sous la capsule ; les lignes reviennent au composeur (FLIP inverse, 240 ms).

### 7.4 La dissolution (fin de vie : destruction, « Terminer et effacer », « Supprimé »)

Le contenu (la liste chez le destinataire, la carte d'état sur la page de gestion, le panneau « Lien prêt » après « Supprimer ce partage ») se défait en grain du bas vers le haut, puis le message de fin apparaît à sa place.

- `@property --d { syntax: "<number>"; initial-value: 0; inherits: false }`, animée de 0 à 1 en 1100 ms, `--ease-in-out`.
- Masque à trois couches, CSS seul : `mask-image: linear-gradient(to top, #000 var(--solid), transparent var(--solid)), url(/assets/grain.png), linear-gradient(to top, transparent var(--solid), #000 var(--solid), #000 var(--edge-top), transparent var(--edge-top));` `mask-composite: add, intersect;` (WebKit : `-webkit-mask-composite: source-over, source-in`), avec `--solid = (1 − --d) × 120 % − 20 %` et `--edge-top = (1 − --d) × 120 %`.
- `grain.png` : tuile de bruit 128 × 128 px, produite par `web/scripts/gen-grain.mjs` (graine fixe) et commitée. `mask-size: 128px`, `mask-position` décalé de 0 à 24 px pendant l'animation.
- Le contenu monte de 4 px et prend un flou de 1 px sur le dernier tiers.
- La dissolution n'est jouée **qu'après** la réponse du serveur ou la mise à zéro locale, jamais avant. À la fin, le nœud est retiré, le message apparaît en fondu de 240 ms et reçoit le focus.
- Repli si `@supports not (mask-composite: intersect)` ou sans `@property` : fondu et flou (400 ms).

### 7.5 Mouvement réduit (`prefers-reduced-motion: reduce`)

| Moment | Remplacement |
|---|---|
| Regroupement FLIP, retour au composeur | Fondu enchaîné de 160 ms |
| Trait qui tourne (indéterminé) | Trait immobile ; le libellé de phase pulse en opacité (1 ↔ 0,6, 1,2 s) |
| Progression du trait | Conservée (c'est un état), sans transition |
| Flou des noms | Opacité seule |
| Pulsation de coupure | Trait immobile en `--warn` |
| Fermeture du sceau | Couleur du bord et icône changent sans déplacement ni échelle ; panneau affiché sans dépliage |
| Dissolution | Fondu de 240 ms, puis message |
| Déplacement d'une ligne | Sans animation (la ligne change de place, le focus la suit) |
| Changements d'étape, feuilles, cible de dépôt | Fondu de 120 ms, sans déplacement |

### 7.6 Mise en œuvre

- **CSS** pour les états, la progression, la dissolution ; **Web Animations API** pour le FLIP et l'enchaînement du sceau (promesses `finished`) ; transitions de Svelte 5 (via `element.animate()`, compatibles avec `style-src 'self'`) pour les apparitions simples.
- **Aucune bibliothèque d'animation** : chaque dépendance est du code tiers sur la page qui détient la clé du lien (spec §2, §10).
- Une animation ne masque jamais le contenu par défaut : si le script échoue, l'état final est visible. `will-change` seulement pendant l'animation. Effets coûteux bornés à la capsule ou à la liste. Pendant l'envoi, la mise à jour visuelle de la progression est limitée à une fois par image (`requestAnimationFrame`), quel que soit le rythme de `onBytes`.
- `web/src/ui/motion.ts` : `reducedMotion()` (mise à jour à chaud) et `flip(elements, mutate)`.

---

## 8. Inventaire des composants

Chaque composant interactif a ses états : repos, survol (`@media (hover: hover)`), focus visible, pressé, désactivé, chargement, erreur. Zones tactiles ≥ 44 × 44 px, 8 px au moins entre cibles voisines.

| Composant | Rôle | Notes |
|---|---|---|
| `AppShell` | En-tête (logo, langue), contenu, pied (Sécurité, Confidentialité) | Verre au défilement ; `translate="no"` hérité de `<html>` ; intercepte `dragover`/`drop` sur toute la page (§9.2.2) |
| `Button` | `primary`, `secondary`, `ghost`, `danger` | 48 px (44 px en dense) ; chargement : libellé conservé, icône remplacée par un trait tournant de 16 px, `aria-busy`, **désactivé dès le premier appui** (synchrone) |
| `IconButton` | Icône seule | `aria-label` obligatoire (type requis, contrôlé par test) |
| `Segmented` | Durée (1 h, 6 h, 12 h, 24 h) | `role="radiogroup"`, flèches clavier |
| `Stepper` | Ouvertures 1 à 10 | − / +, valeur tabulaire, `aria-live="polite"` sur la valeur |
| `TextField` / `TextArea` | Saisie | Bord `--line-strong`, focus : anneau 2 px `--accent` décalé de 2 px ; erreurs par `aria-describedby` ; attributs §12.3 ; `font-size` ≥ 16 px |
| `PassphraseField` | Phrase générée ou mot de passe personnel | Chasse fixe ; Régénérer, Copier, « Utiliser mon propre mot de passe » |
| `PasswordChecklist` | Indicateur honnête | Critères vrais (« 12 caractères minimum », « Absent des mots de passe courants ») ; phrase générée : « 4 mots tirés au hasard parmi 7 776 (environ 52 bits) » |
| `CopyField` | Lien, mot de passe, lien de gestion | Valeur tronquée au milieu, copie entière, « Copié » 2 s (icône `check`), annoncé en `aria-live` |
| `Banner` | `info`, `warn`, `danger` | Fond teinté + icône + texte ; pas de bord gauche épais ; `role="status"` ou `role="alert"` ; action facultative (un bouton au plus) |
| `CapacityGauge` | « 34 Mo / 1 Go · 3 / 10 » | §9.2.5 |
| `CategoryGroup` | En-tête de catégorie + ses lignes | `<section aria-labelledby>`, titre `--fs-h3` « Photos », méta « 3 · 12 Mo » |
| `ItemRow` | Élément du composeur ou du contenu | Poignée (composeur), vignette ou icône, nom (`<bdi>`, troncature au milieu, extension toujours visible), taille, badges, actions (retirer, renommer / ouvrir, enregistrer) |
| `ReorderHandle` | Poignée de déplacement | §9.2.4 |
| `DropZone` | Ajout par dépôt ou sélection | Bouton natif `<input type="file" multiple>` stylé + zone de dépôt ; contour en tirets `--line-strong`, `--accent` + `--accent-tint` pendant un survol de dépôt |
| `DropOverlay` | Cible pleine page pendant un glisser | §9.2.2 |
| `UndoToast` | « Retiré · Annuler » | 6 s, `role="status"`, se ferme au clavier (Échap), une seule à la fois |
| `VoiceRecorder` | Vocal | États §9.2.7 ; niveau en 5 barres (AnalyserNode), minuteur tabulaire |
| `SealCapsule` | Scellement | §7.3, `role="progressbar"` |
| `UploadStats` | Mesures de l'envoi | §9.4.1 |
| `PhaseList` | Quatre phases de l'envoi | §9.4.1, liste ordonnée, état de chaque phase en texte (pas seulement en couleur) |
| `Countdown` | Temps restant | « 4 h 15 », « 12 min », « 45 s » ; annonces §11 |
| `InlineConfirm` | Confirmation de destruction, d'annulation, de sortie | Remplace le bouton par « Confirmer / Annuler » sur place, focus sur « Annuler » ; pas de modale |
| `Sheet` | QR code sur téléphone, vérification de repli, signalement | `<dialog>` natif + `showModal()`, Échap ferme, focus rendu au déclencheur |
| `VerifFrame` | Cadre reCAPTCHA isolé | §15 |
| `QrCode` | QR du lien | SVG produit par code (chemins), chargé à la demande |
| `Viewer*` | Image, Audio, Vidéo, Texte, Pdf | §9.8 |
| `SaveButton` | Enregistrement en flux | Progression en octets, Annuler, états §9.9 |
| `Dissolve` | Enveloppe la zone qui se dissout | §7.4 |
| `LiveRegion` | Annonces polies | Une seule région par page, file d'attente, une annonce par seconde au plus |

---

## 9. Écrans et états

Routes (routeur interne d'une trentaine de lignes) : `/` (accueil + envoi), `/s/:id` (ouverture), `/m/:id` (gestion), `/securite`, `/confidentialite`, toute autre adresse → page 404 de l'interface (le serveur répond 200 avec `index.html`, comportement existant de `static.go`, spec §10). Les liens de partage et de gestion ont la forme `/s/{id}#{K_lien}`, `/m/{id}#{S_gestion}`.

Disposition : une colonne sur téléphone ; à partir de 960 px, deux colonnes (composer | options ; liste | visionneuse). La barre d'actions principale est collée en bas sur téléphone (zone du pouce), en fin de colonne sur ordinateur. **Clavier virtuel ouvert** (détecté par `visualViewport.height < 0,75 × innerHeight`) : la barre collée du bas passe dans le flux (plus de `position: sticky`) pour ne jamais couvrir le champ actif ; le champ qui reçoit le focus est amené au centre (`scrollIntoView({ block: "center" })`) ; `<meta name="viewport" … interactive-widget=resizes-content>`. **Paysage sur téléphone** (hauteur < 500 px) : en-tête non collé, capsule réduite (hauteur auto, pas de plein écran), barre d'actions dans le flux. **320 px** : tout tient sans défilement horizontal (contrôlé par test), les rangées de boutons passent à la ligne.

Navigateur pris en charge (vérifié avant toute route) : `crypto.subtle`, `crypto.getRandomValues`, `WebAssembly`, `Blob.prototype.stream`, `TextDecoder`, `AbortController`. `Worker` n'est **pas** exigé : sans lui, la preuve de travail échoue et le repli s'applique (§9.4.2).

### 9.1 Accueil (Persuade, court)

- Titre (`--fs-display`) : **« Un lien, un mot de passe, puis plus rien. »** / EN : « One link, one password, then nothing. »
- Une phrase : « Texte, photos, vidéos, vocaux, documents. Chiffrés sur votre appareil avant l'envoi : le serveur ne reçoit que des données chiffrées, jamais la clé. »
- Démonstration du mécanisme : un schéma en une ligne, SVG, « Votre appareil — chiffré — serveur (ne lit rien) — chiffré — destinataire », trait menthe tracé une fois (600 ms ; immobile en mouvement réduit).
- Lien « Comment ça marche » → `/securite`.
- Le composeur commence juste dessous ; sur téléphone (390 × 844), la rangée d'ajout est dans le premier écran. Une fois au moins un élément ajouté, le titre d'accueil se replie (hauteur réduite, `--fs-h1`) pour laisser la place à la liste : le Persuade a fait son travail.

### 9.2 Composer

#### 9.2.1 Ajouter

- Rangée d'ajout : **Fichiers**, **Photo**, **Vocal**, **Texte**, et **Coller** (seulement si `navigator.clipboard.read` existe ; surtout utile au téléphone, où Ctrl/Cmd + V n'existe pas). « Photo » = `<input type="file" accept="image/*" capture="environment">` (spec §10 : pas d'accès direct à la caméra). « Vocal » masqué si `MediaRecorder` manque ou si aucun format n'est pris en charge (§9.2.7).
- Sur ordinateur, la zone de dépôt (`DropZone`) est sous la rangée : « Déposez des fichiers ici, ou collez-les (Ctrl + V) » (« Cmd + V » sur Apple, détecté par `navigator.platform` / `userAgentData`).
- Toute addition passe par une seule fonction (`composer.add`), quelle que soit la source (sélecteur, dépôt, collage, photo, vocal), qui applique dans l'ordre : lecture d'essai (§9.2.8) → limite de nombre → nettoyage des métadonnées (images) → détection de doublon → insertion à la fin de sa catégorie → annonce « 3 éléments ajoutés ».
- Nommage : une photo prise par « Photo » est nommée **« Photo {n}.jpg »** (le nom d'origine, souvent « image.jpg » ou un horodatage, n'est pas gardé) ; une image collée « Image collée {n}.png » ; un vocal « Vocal {n}.m4a » (ou `.webm`) ; un texte n'a pas de nom affiché au destinataire autre que « Texte {n} ». Les fichiers choisis gardent leur nom (renommable, §9.2.4).

#### 9.2.2 Glisser-déposer

- **Cible pleine page** : dès qu'un glisser contenant des fichiers (`dataTransfer.types` inclut `"Files"`) entre dans la fenêtre, `DropOverlay` couvre la page : voile `--scrim`, cadre en tirets `--accent` à 16 px des bords, texte centré « Déposez pour ajouter » + « 10 éléments, 1 Go au plus ». Compteur `dragenter`/`dragleave` pour ne pas clignoter entre éléments enfants ; fermeture sur `drop`, `dragend`, Échap ou sortie de la fenêtre.
- **Sur toutes les autres routes** (ouverture, contenu, gestion, envoi en cours, lien prêt), `AppShell` appelle `preventDefault()` sur `dragover` et `drop` **sans rien ajouter** : sans cela, déposer un fichier par erreur fait naviguer l'onglet vers ce fichier, ce qui consommerait une ouverture sur la page de contenu ou abandonnerait un envoi (§18, A11).
- **Dossiers : refusés**, avec un message, pas aplatis. Raison : un dossier dépasse vite 10 éléments, sa structure serait perdue sans le dire, et l'aplatir demande un parcours récursif (`webkitGetAsEntry`) pour un cas rare. Détection : `item.webkitGetAsEntry()?.isDirectory` quand il existe, sinon l'échec de la lecture d'essai (Safari présente un dossier comme un `File` illisible). Message (`warn`, icône `folder-x`) : « Les dossiers ne peuvent pas être ajoutés. Ajoutez les fichiers eux-mêmes, ou une archive .zip. »
- Plusieurs fichiers d'un coup : acceptés dans l'ordre du dépôt.

#### 9.2.3 Coller

- **Ctrl/Cmd + V** sur la route d'accueil : écouteur `paste` sur `document`.
  - Si le presse-papier contient des fichiers (`clipboardData.files`, images comprises) : ils sont ajoutés comme éléments, `preventDefault()`, **même si le focus est dans la zone de texte** (on ne colle pas une image dans un texte).
  - Sinon, si le focus est dans un champ de saisie : comportement natif (le texte est collé dans le champ).
  - Sinon, du texte brut (`text/plain` seulement, jamais `text/html`) : un nouvel élément Texte est créé, son éditeur s'ouvre avec ce texte, focus dans la zone. Rien n'est ajouté sans que la personne le voie.
- **Bouton Coller** (téléphone surtout) : `navigator.clipboard.read()` sur ce geste seulement ; pour chaque `ClipboardItem`, les types `image/png`, `image/jpeg`, `image/webp`, `image/gif` deviennent des images (nettoyées comme les autres), `text/plain` un élément Texte (éditeur ouvert). Safari affiche sa bulle système « Coller » : c'est attendu. Refus (`NotAllowedError`) : « Le navigateur a refusé l'accès au presse-papier. » Presse-papier vide ou sans type utilisable : « Rien à coller. »
- Aucune lecture du presse-papier sans geste explicite. L'écouteur `paste` n'existe que sur la route d'accueil, hors envoi en cours.

#### 9.2.4 Liste : catégories, ordre, retrait, renommage, doublons

- **Catégories**, dans cet ordre fixe : **Texte**, **Photos**, **Vidéos**, **Audio et vocaux**, **Documents**, **Autres**. Attribution (`kinds.ts`, testée) : texte → Texte ; `image/*` ou extension d'image → Photos ; `video/*` → Vidéos ; `audio/*` ou vocal → Audio et vocaux ; PDF, bureautique (`.doc(x)`, `.xls(x)`, `.ppt(x)`, `.odt`, `.ods`, `.odp`, `.rtf`, `.txt`, `.md`, `.csv`, `.pages`, `.numbers`, `.key`, `.epub`) → Documents ; reste → Autres.
- Affichage : un `CategoryGroup` par catégorie non vide, en-tête « Photos » + méta « 3 · 12 Mo » (nombre et taille cumulée, chiffres tabulaires). Avec une seule catégorie présente, l'en-tête reste (repère constant), sans répétition de la méta dans la jauge.
- **Ordre du manifeste** = ordre des catégories ci-dessus, puis ordre dans chaque catégorie. Le destinataire voit exactement cet ordre et ces groupes (§9.8). On ne réordonne donc **qu'à l'intérieur d'une catégorie** (§18, A9). Le texte en premier est voulu : c'est souvent le message qui accompagne le reste.
- **Réordonnancement** :
  - Poignée `grip-vertical` à gauche de chaque ligne (si la catégorie a au moins 2 éléments), `aria-label` « Déplacer {nom} », `aria-describedby` vers l'aide « Alt + flèche haut ou bas pour déplacer ».
  - Pointeur (souris et doigt) : appui sur la poignée puis glisser (Pointer Events + `setPointerCapture`, pas l'API HTML Drag and Drop, qui ne marche pas au doigt) ; la ligne se soulève (`--surface-3`, `--e-2`), les autres s'écartent (FLIP 180 ms), défilement automatique près des bords. Au doigt, le glisser démarre après 150 ms d'appui sur la poignée seulement (le reste de la ligne fait défiler la page). `touch-action: none` sur la poignée seulement.
  - Clavier : **Alt + ↑ / Alt + ↓** sur une ligne ou sa poignée déplace d'un rang ; le focus suit la ligne. En limite de catégorie : rien ne bouge, annonce « Premier de la catégorie » / « Dernier de la catégorie ».
  - Lecteurs d'écran au toucher (VoiceOver, TalkBack, sans touche Alt) : activer la poignée ouvre le **mode déplacement** de la ligne : deux boutons « Monter » (`arrow-up`) et « Descendre » (`arrow-down`) et « Terminé » apparaissent à sa place ; Échap ou « Terminé » en sort.
  - Annonce après chaque déplacement : « {nom} : position 2 sur 4 dans Photos. »
- **Retrait** : bouton `x` (« Retirer {nom} »), immédiat ; `UndoToast` « {nom} retiré · Annuler » pendant 6 s, qui remet l'élément à sa place. Le focus va à la ligne suivante (ou précédente, ou au bouton d'ajout si la liste est vide). Pour un texte, le contenu retiré est gardé 6 s puis oublié. Les URL blob des vignettes sont révoquées à l'oubli définitif.
- **Renommage : retenu.** Le nom d'un fichier est visible du destinataire et trahit souvent ce que le nettoyage retire ailleurs (« IMG_20261104_235901.jpg » donne la date et l'heure, « CV_Prénom_Nom.pdf » une identité). Bouton `pencil` (« Renommer {nom} ») → champ en place avec la base du nom sélectionnée, l'**extension affichée à part et non modifiable** (« .jpg ») ; Entrée valide, Échap annule, perte de focus valide. Règles : 1 à 120 points de code après `cleanName`, sans `/`, `\` ni caractères de contrôle ; erreur en place (« Nom vide » / « 120 caractères au plus »). Un texte se « Modifie » (rouvre l'éditeur) au lieu de se renommer.
- **Doublons** : même nom (après `cleanName`, sans casse) **et** même taille qu'un élément présent → l'élément est ajouté quand même, avec un badge `warn` « En double ? » sur les deux lignes et l'annonce « {nom} semble déjà ajouté. » Retirer l'un des deux enlève le badge. Aucun blocage (deux fichiers identiques peuvent être voulus).
- **Vignettes** : pour les images nettoyées (JPEG, PNG, WebP, GIF, AVIF), vignette carrée de 40 px (`<img>` sur une URL blob de la donnée **nettoyée**, `object-fit: cover`, `decoding="async"`) ; échec de décodage (HEIC hors Safari) : icône de la catégorie. Aucune vignette vidéo (éviterait un décodage lourd).
- **Ligne** : vignette ou icône, nom (`<bdi>`, troncature au milieu qui garde l'extension, nom complet en `title` et dans l'`aria-label` des actions), taille (« 4,2 Mo », « 0 octet »), badges (« Nettoyé », « Non nettoyé », « En double ? »), actions. Sous 360 px, la taille passe sous le nom.

#### 9.2.5 Jauge de capacité

- `CapacityGauge` toujours visible au-dessus de la barre d'actions (collée avec elle sur téléphone). Deux mesures sur une ligne : **taille** « 340 Mo / 1 Go » et **nombre** « 3 / 10 », chacune avec sa barre fine de 4 px (taille : proportion de `CONTENT_MAX` ; nombre : 10 crans).
- Liste vide : la jauge affiche « Rien à envoyer pour l'instant · 1 Go et 10 éléments au plus » (pas de « 0 o / 1 Go »).
- États : < 90 % : `--accent` ; ≥ 90 % : `--warn` + « Presque plein » ; **dépassement** (> `CONTENT_MAX`) : barre pleine `--danger`, valeur en `--danger` et en gras, texte « Trop gros : 1,2 Go sur 1 Go. Retirez 200 Mo. » (`role="alert"` au moment où l'état apparaît), bouton d'envoi désactivé avec la même raison en `aria-describedby`. Le dépassement de taille est **permis dans la liste** pour que la personne voie quoi retirer.
- Nombre : le 11ᵉ élément et suivants sont **refusés à l'ajout** (« 2 éléments n'ont pas été ajoutés : 10 au plus. » avec leurs noms). Un onzième élément n'a jamais besoin d'exister, contrairement à un dépassement de taille, qu'on règle en choisissant quoi retirer (§18, A27).
- `CONTENT_MAX = 1 073 741 824 − 65 540` octets (capacité du plus grand palier moins la place maximale du manifeste) ; `createShare` reste l'arbitre (`trop_gros`). La taille affichée est la somme des tailles des éléments (texte compté en octets UTF-8).
- Mise à jour à chaque ajout, retrait, nettoyage terminé (une image nettoyée est un peu plus petite) ; annonce polie seulement aux franchissements de seuil (90 %, dépassement, retour sous la limite).

#### 9.2.6 Nettoyage des métadonnées

`web/src/media/strip.ts`, sans réencodage, appliqué aux images à l'ajout, avant l'insertion (la ligne affiche « Nettoyage… » pendant ce temps) :

- JPEG : EXIF réécrit avec la seule orientation ; APP2 `ICC_PROFILE` et APP14 `Adobe` conservés ; APP1 XMP, APP13, APP2 MPF, COM et autres APPn retirés ; données coupées au premier EOI de l'image principale (S6).
- PNG : `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME` retirés ; `iCCP`, `sRGB`, `gAMA`, `cHRM` conservés.
- WebP : `EXIF` et `XMP ` retirés, drapeaux `VP8X` et taille RIFF corrigés ; `ICCP` conservé.
- Images de plus de 50 Mo : non lues en mémoire, ajoutées « non nettoyées » avec l'avertissement.
- Badge réussi : « Nettoyé · lieu, appareil et date de prise de vue retirés ». Échec (fichier malformé) : élément **non ajouté**, « Impossible de nettoyer « {nom} ». Elle n'a pas été ajoutée. »
- **Non nettoyé** (badge `--warn` + phrase) : vidéos (« peut contenir le lieu, la date et l'appareil »), HEIC, AVIF, GIF (« photo non nettoyée (format {format}) »), PDF (« peut contenir l'auteur et le logiciel utilisé »), documents (« peut contenir des informations sur son auteur »). Pour HEIC, en plus : « Sur iPhone, ajoutez-la avec « Photo » : iOS la convertit en JPEG, qui sera nettoyé. »

#### 9.2.7 Texte et vocal

- **Texte** : `TextArea` (attributs §12.3), compteur « 1 234 / 10 000 » en points de code ; au-delà : erreur et bouton « Ajouter » bloqué. Un texte = un élément. Plusieurs textes possibles (« Texte 1 », « Texte 2 »).
- **Vocal** : repos → demande du micro → refus (« Micro refusé. Autorisez-le dans les réglages du navigateur. ») / enregistrement (minuteur, niveau, Arrêter) → écoute (lecteur natif, « Garder » / « Recommencer »). Format : `audio/mp4` (AAC) si `MediaRecorder.isTypeSupported`, sinon `audio/webm;codecs=opus` (spec §12). Durée maximale d'un vocal : 30 min (borne mémoire ; avertissement à 29 min, arrêt automatique). Pistes du micro arrêtées dès la fin, et sur `pagehide`.

#### 9.2.8 Lecture d'essai et fichiers particuliers

- Chaque fichier ajouté est lu sur son premier octet (`file.slice(0, 1).arrayBuffer()`, ou le fichier entier s'il est vide). Échec : « Impossible de lire « {nom} » (dossier, fichier déplacé ou inaccessible). » et rien n'est ajouté. Cela attrape les dossiers de Safari et les fichiers en nuage non téléchargés.
- **Fichier vide** (0 octet) : accepté, taille « 0 octet ».
- **Très gros fichier unique** (jusqu'à 1 Go) : accepté sans lecture complète (seules les images ≤ 50 Mo sont lues pour le nettoyage) ; `createShare` lit par tranches.
- **Noms très longs ou de droite à gauche** : affichés via `cleanName` dans `<bdi>`, troncature au milieu.

#### 9.2.9 Envoyer

- Blocages, chacun avec sa raison sous le bouton (`aria-describedby`) : liste vide (« Ajoutez au moins un élément »), dépassement de taille (§9.2.5), texte en cours d'édition trop long, nettoyage en cours (« Nettoyage en cours… », le bouton se débloque seul), mot de passe personnel refusé (§9.3), hors ligne (`navigator.onLine === false` : « Vous êtes hors ligne. »).
- Téléphone : **Continuer** passe à l'étape Options (focus sur son titre). Ordinateur : les options sont déjà à droite, l'action est directement **Chiffrer et envoyer**.
- Le composeur garde tout en mémoire tant que la page vit ; quitter la page avec des éléments dans la liste déclenche `beforeunload` (la liste serait perdue). Aucun stockage.

### 9.3 Options

- **Durée** : `Segmented` 1 h · 6 h · **12 h** (par défaut) · 24 h. Indication : « Comptée à partir de la fin de l'envoi. »
- **Ouvertures** : `Stepper` 1 à 10, **1** par défaut. Indication : « Une ouverture = un déverrouillage réussi. »
- **Mot de passe** : phrase de 4 mots (`generatePassphrase(4)`), en grand, en chasse fixe ; **Régénérer**, **Copier**. « Utiliser mon propre mot de passe » → champ (chasse fixe, Afficher/Masquer), `PasswordChecklist` en direct, erreurs de `checkPassword` (« 12 caractères minimum », « Ce mot de passe est trop courant »). Revenir à la phrase générée : « Utiliser une phrase générée ». Rappel permanent : « Envoyez-le par un autre moyen que le lien. »
- Action : **Chiffrer et envoyer** (`primary`, icône `lock`). Retour possible à « Composer » sans rien perdre.

### 9.4 Envoi (scellement)

L'écran remplace le composeur (masqué, intact). La capsule (§7.3) est en haut ; sous elle, `UploadStats`, `PhaseList`, les actions, puis le rappel « Gardez cet onglet ouvert pendant l'envoi. » Le titre de l'onglet devient « 42 % · Shhdrop » pendant l'envoi (repère quand l'onglet est en arrière-plan ; aucune donnée sensible), puis « Shhdrop ».

#### 9.4.1 Phases et mesures

| Phase | Détection | Libellé (FR) |
|---|---|---|
| `keys` | Du clic à l'appel de `solveCaptcha` | « Préparation des clés » (Argon2id, environ 1 s) |
| `captcha` | Pendant `solveCaptcha`, puis jusqu'au premier `onProgress(0, total)` (comprend l'attente de 3,1 s et la création) | « Vérification anti-robot » + détail §9.4.2 |
| `upload` | Après `onProgress(0, total)`, tant que des octets restent | « Chiffrement et envoi » + « chaque bloc est chiffré juste avant d'être envoyé » |
| `paused` | Pause demandée (§9.4.4) | « En pause » |
| `offline` | `onRetry` reçu, ou événement `offline`, ou aucun octet depuis 10 s pendant `upload` | Bandeau §9.4.3 |
| `finalize` | Tous les octets envoyés (`onBytes(total, total)`), promesse non résolue | « Finalisation » |
| `sealed` | Promesse résolue | Fermeture du sceau, puis §9.5 |

`PhaseList` montre les quatre phases visibles (Préparation des clés · Vérification anti-robot · Chiffrement et envoi · Finalisation), chacune « à venir », « en cours » ou « faite » (texte + icône, pas la couleur seule). La liste sert de repère ; la capsule porte l'information principale.

`UploadStats`, par ordre d'importance (§18, A28) :
1. **Pourcentage** au centre de la capsule (`--fs-figure`), arrondi à l'entier inférieur (jamais « 100 % » avant le dernier octet).
2. Ligne principale : « **214 Mo / 400 Mo** · **4,2 Mo/s** · **environ 1 min** ».
   - Les tailles sont celles du **paquet chiffré** (palier) : il est plus gros que le contenu (34 Mo de contenu → 50 Mo envoyés). Une ligne d'aide l'explique une fois : « La taille envoyée est arrondie au palier supérieur pour masquer la taille réelle. » (§18, A18)
   - **Vitesse** : moyenne mobile exponentielle sur 3 s des octets de `onBytes` (`v ← v + (1 − e^(−Δt/3)) × (Δoctets/Δt − v)`), affichée seulement après 3 s d'envoi, masquée en pause et pendant une coupure ; unités « Ko/s », « Mo/s ».
   - **Temps restant** : (total − envoyé) / v, arrondi (« environ 12 min », « environ 1 min », « moins d'une minute »), affiché après 5 s, mis à jour au plus toutes les 2 s, masqué si la vitesse est nulle.
3. Ligne de détail, en chasse fixe `--fs-small` `--text-2` : « Bloc 12 / 100 » (`onProgress`).
- **Envoi trop lent pour finir** : si le temps restant estimé dépasse le temps restant avant la limite de 3 h de l'envoi (spec §7.4 ; mesuré depuis la création), bandeau `warn` : « À cette vitesse, l'envoi ne finira pas avant la limite de 3 h. Changez de réseau ou retirez des éléments. » (pas d'arrêt automatique).

#### 9.4.2 Vérification anti-robot (P3)

**Principal : preuve de travail maison**, compatible avec le défi `altcha-lib-go` v1 que sert déjà le serveur (`algorithm: "SHA-256"`, `challenge` = hex(SHA-256(`salt` + `number`)), `maxNumber`, `salt` qui finit par « & », `signature`) :

- `web/src/captcha/pow.ts` (hôte) + `web/src/captcha/pow.worker.ts` (Worker dédié, module, fichier servi par notre origine, donc permis par `script-src 'self'`).
- Le Worker essaie `number` de 0 à `maxNumber` : `crypto.subtle.digest("SHA-256", encode(salt + number))`, par lots de 64 condensés en parallèle, compare à `challenge`. Il rend `{ number, took }` ou « non trouvé ». Il poste sa progression toutes les 250 ms (`{ tried }`). Pas de SHA-256 écrit à la main (CLAUDE.md : aucune crypto maison).
- Charge utile : `btoa(JSON.stringify({ algorithm, challenge, number, salt, signature, took }))`, rendue en `{ kind: "pow", payload }`.
- **Pré-calcul (Q2)** : la preuve de travail est lancée dès le **premier élément ajouté** au composeur (`prepareCaptcha`, puis le Worker), pas au clic d'envoi ; l'envoi la consomme (`CreateOpts.prepared`) si le défi a encore plus de 15 s de validité. Le défi serveur dure 2 min : il est renouvelé quand il reste 30 s de validité, **au plus deux renouvellements**, puis le calcul se fait à l'envoi. Garde-fous (processeur et vie privée) : seulement **page visible** ; arrêt sur `pagehide`, page masquée et liste vidée ; au niveau de difficulté maximal (environ 30 s de calcul), un recalcul toutes les 2 min occuperait un téléphone environ 25 % du temps, d'où la limite de deux renouvellements. Le serveur apprend qu'une composition est en cours (un `GET /api/captcha` part avant l'envoi) ; aucun contenu ni clé n'est concerné. Une preuve est invalidée par une création sur la même connexion (contrôle de niveau du serveur) ou par un changement d'adresse IP : un `bad_request` avec une preuve pré-calculée relance un essai complet **sans** pré-calcul (jamais directement le repli Google). Le pré-calcul n'est pas branché dans la démo.
- **Annulable** : `worker.terminate()` sur Annuler, `pagehide`, borne dépassée.
- Affichage : trait indéterminé ; libellé « Vérification anti-robot · calcul sur votre appareil » ; après 5 s, « Encore {durée} au plus » calculé sur la vitesse mesurée et l'espace restant (`maxNumber − tried`) : c'est une borne vraie, pas une estimation optimiste. Si le calcul a été pré-calculé, il est déjà avancé (voire fini) au clic d'envoi.
- **Échec de la preuve** → repli (décision Q2 du 5 novembre : plus de délai fixe) : `Worker` absent ou erreur à la création (CSP d'un navigateur intégré, mode restreint), erreur du Worker, **borne vraie dépassée** (après 5 s de mesure, `(maxNumber − tried) / vitesse` supérieur à **60 s**, ou 60 s écoulées sans solution), ou refus du serveur. Ordre des essais d'une création : (1) preuve pré-calculée ou preuve de travail ; (2) nouvel essai complet en preuve de travail, sans pré-calcul (`Error("bad_request")` au premier) ; (3) repli Google (`ctx.mode = "fallback"`) seulement si `fallbackOrigin` n'est pas `null` ; sinon, ou en cas d'échec, l'erreur `captcha` (§9.4.6). Sans repli possible, le calcul va jusqu'au bout et l'écran affiche « Encore {durée} au plus ». Le repli n'est **proposé qu'après le clic d'envoi**, jamais pendant le pré-calcul.

**Repli : Google reCAPTCHA**, seulement si `ctx.fallbackOrigin` n'est pas `null` (repli activé côté serveur, §15) :

- La capsule reste ; une `Sheet` s'ouvre : titre « Vérification supplémentaire », texte : « La vérification automatique n'a pas abouti sur cet appareil. Vous pouvez utiliser celle de Google. **Google verra votre adresse IP** et pourra déposer ses cookies dans son cadre. Votre contenu, votre lien et votre mot de passe restent hors de sa portée : la vérification tourne dans une page séparée, sans accès à cette page. » Boutons **Continuer avec Google** (`secondary`, icône `shield-alert`) et **Annuler l'envoi** (`ghost`). Lien « En savoir plus » → `/confidentialite#verification`.
- **Rien n'est chargé depuis Google avant ce clic** (consentement explicite : le code n'appelle `askFallback`, donc ne crée le cadre, qu'après la résolution `true` de la feuille de consentement ; testé). Après le clic : `VerifFrame` dans la feuille (§15) ; la case « Je ne suis pas un robot » s'affiche ; une éventuelle grille d'images tient dans le cadre (largeur `min(100 %, 400px)`, hauteur `min(600px, 85dvh)`).
- Jeton reçu → `{ kind: "recaptcha", token }`, la feuille se ferme, l'envoi continue. Jeton expiré (2 min) : la case se réarme d'elle-même dans le cadre. Fermeture de la feuille (Échap) = Annuler l'envoi.
- Le défi du serveur dure 2 min : si la vérification Google n'est pas finie avant, `createShare` échoue (`bad_request`) et l'écran propose « Réessayer » (nouveau défi, nouvelles clés).
- Repli désactivé sur le serveur, ou cadre qui ne répond pas en 15 s : « La vérification anti-robot n'a pas pu se faire sur cet appareil. Réessayez, ou essayez depuis un autre navigateur. » + Réessayer.

#### 9.4.3 Coupure réseau et reprise

- Déclencheurs : `onRetry({ attempt, inMs, offline })`, événement `offline`, ou aucun octet depuis 10 s pendant `upload`.
- Bandeau `warn` (icône `wifi-off`), sous la capsule : « Connexion perdue. Nouvel essai dans 8 s… » (compte à rebours tabulaire, à partir de `inMs`) ; hors ligne : « Hors ligne. L'envoi reprendra dès le retour du réseau. » ; ligne de délai : « L'envoi est conservé encore {durée} sans connexion. » (échéance de 13 min après le dernier segment acquitté, §0.1). Bouton **Réessayer maintenant** (relance l'attente en cours). Le trait pulse (§7.3).
- Retour du réseau (premier octet reçu) : bandeau remplacé 3 s par « Connexion rétablie », annonce polie.
- Budget épuisé : `Error("reseau")` → message d'erreur (§9.4.6).
- **Arrière-plan sur téléphone** (`visibilitychange` → `hidden`) : iOS et Android suspendent souvent la page ; l'envoi s'arrête de fait. Au retour (`visible`), si l'envoi a été interrompu, la reprise se fait par le même mécanisme et un bandeau `info` dit : « L'envoi s'est arrêté pendant que l'app était en arrière-plan. Il reprend. » Pour limiter ce cas, l'écran demande un **verrou d'écran** (`navigator.wakeLock.request("screen")`, si disponible) de la phase `keys` jusqu'à la fin, relâché à la fin, en pause, à l'annulation, et redemandé au retour en `visible`.

#### 9.4.4 Pause et reprise

- Bouton **Pause** (`secondary`, icône `pause`), actif en phase `upload` seulement. Au clic : « Mise en pause après le bloc en cours… » (un bloc fait 4 Mio), puis « En pause ». La promesse de `opts.pause` reste en attente jusqu'à **Reprendre** (`primary`, icône `play`).
- **Pause bornée à 10 min et par l'échéance de 13 min** (`SERVER_STALL_MS` après le dernier segment acquitté, la même que celle de la coupure) : le serveur efface un envoi qui ne reçoit plus de segment pendant 15 min (spec §7.4). La reprise automatique a lieu à `min(10 min, échéance)`. Pendant la pause : « Reprise automatique dans 9:12 » (`timer`) ; à 0, reprise d'office, annonce « Reprise automatique de l'envoi ». La pause est refusée (bouton désactivé, raison en `title` et `aria-describedby`) s'il reste moins de 15 min avant la limite de 3 h.
- Pendant la pause, le verrou d'écran est relâché ; la vitesse et le temps restant sont masqués.

#### 9.4.5 Annuler

- Bouton **Annuler** (`ghost`), actif de `keys` à `finalize` exclu. `InlineConfirm` : « Annuler l'envoi ? Ce qui a été envoyé sera effacé du serveur. » → **Annuler l'envoi** / **Continuer**.
- Effet : `AbortController.abort()` → `createShare` arrête le Worker de preuve ou la vérification, la requête en cours, et détruit le partage s'il a été créé (`S_gestion`, `keepalive`). Retour au composeur intact, focus sur le bouton d'envoi, bandeau `info` : « Envoi annulé. Il compte quand même dans la limite d'envois du jour. » (si la création avait eu lieu ; sinon : « Envoi annulé. »).
- Pendant `finalize`, Annuler est masqué : l'annulation à cet instant laisserait un partage peut-être déjà actif. On attend la fin, puis « Supprimer ce partage » (§9.5) reste possible.

#### 9.4.6 Sortie de page, double envoi, erreurs

- **`beforeunload`** actif de `keys` jusqu'à la résolution (dialogue générique du navigateur ; inexistant sur Safari iOS, où seul le rappel à l'écran protège).
- **`pagehide`** pendant l'envoi : `abort()` (le partage créé est détruit en `keepalive`), arrêt du Worker. Fermer l'onglet ne laisse donc pas, au mieux, de réservation ; au pire (page tuée sans `pagehide`), le serveur l'efface après 15 min sans segment.
- **Double envoi** : le bouton « Chiffrer et envoyer » est désactivé de façon synchrone au premier appui ; `sender.start()` refuse tout appel hors état `idle` (testé).
- Erreurs (les éléments restent dans le composeur, rien n'est perdu côté appareil) :

| Erreur | Message | Action |
|---|---|---|
| `AbortError` | Aucun message d'erreur (voir Annuler) | — |
| `Error("reseau")` | « L'envoi n'a pas abouti : la connexion est restée coupée trop longtemps. Ce qui a été envoyé sera effacé. » | Réessayer |
| `NotFoundError` | « Le transfert a été interrompu (le serveur a peut-être redémarré). Réessayez. » | Réessayer |
| `LimitError{retryAfterS}` | « Limite d'envois atteinte. Réessayez dans {durée}. » ; le bouton Réessayer est désactivé avec un compte à rebours, puis se réactive | Réessayer (différé) |
| `Error("full")` (507) | « Le service est plein pour le moment. Réessayez plus tard. » | Réessayer |
| `Error("frozen")` (503) | « Les nouveaux envois sont suspendus pour le moment. Réessayez plus tard. » | — |
| `Error("bad_request")` | Un nouvel essai complet automatique (nouveau défi, nouvelles clés, sans pré-calcul), puis repli anti-robot si disponible (§9.4.2) ; ensuite : « La vérification anti-robot a échoué. Réessayez. » | Réessayer |
| `NotReadableError` ou `NotFoundError` DOM | « « {nom} » a été modifié ou déplacé pendant l'envoi. Retirez-le et ajoutez-le à nouveau. » La ligne fautive est marquée en `--danger` au retour au composeur | Retour au composeur |
| `trop_gros`, `trop_d_elements`, `vide`, `texte_trop_long` | Ne peuvent pas survenir (bloqués avant) ; si cela arrive : retour au composeur avec la raison de la jauge | Retour au composeur |
| Autre | « Une erreur inattendue a interrompu l'envoi. Réessayez. » (le code n'est jamais affiché) | Réessayer |

« Réessayer » rappelle `createShare` en entier : nouvelles clés, nouveau sel, nouveau défi (jamais de rechiffrement d'un segment avec la même clé). Le focus va au message d'erreur (`role="alert"`, `tabindex="-1"`).

### 9.5 Lien prêt

Affiché seulement quand la promesse de `createShare` est résolue (spec §5.1). Focus sur le titre « Lien prêt ». Annonce : « Partage créé. »

1. **Lien de partage** : `CopyField` + **Partager** (`navigator.share({ url })`, masqué si absent ; ne partage **jamais** le mot de passe) + **QR code** (feuille sur téléphone, en place sur ordinateur ; légende « Le QR contient la clé : ne le montrez qu'au destinataire »).
2. **Mot de passe** : `CopyField` en chasse fixe : « Envoyez-le par un **autre moyen** que le lien. Les deux dans la même messagerie, c'est comme ne pas en mettre. »
3. **Lien de gestion** : `CopyField` + « Gardez-le pour vous : il permet de suivre et de supprimer le partage. »
4. **Vider le presse-papier** + « Ne vide pas l'historique du clavier ni le presse-papier partagé entre appareils. »
5. Mention : « Ces informations ne seront plus jamais affichées. » + expiration calculée sur `expiresInS` : « Expire dans 12 h (vers 9 h 45) si personne ne l'ouvre. »
6. **Terminé** (`secondary`) → `InlineConfirm` « Vous ne pourrez plus les afficher. Terminer ? » → efface l'état (chaînes oubliées, références nulles) et revient au composeur vide.
7. **Supprimer ce partage** (`ghost` en `--danger`, icône `trash-2`, séparé des autres actions par `--sp-6` et un filet) → `InlineConfirm` `danger` « Supprimer ce partage pour tout le monde ? Le lien ne mènera plus à rien. » → `destroyShare(manage, location.origin)` → dissolution du panneau → « Partage supprimé. » + **Nouvel envoi**. `NotFoundError` (déjà expiré ou détruit) : même résultat (« Partage supprimé. »). `Error("reseau")` : « Connexion impossible : le partage n'a pas été supprimé. » + Réessayer.
- **`beforeunload`** reste actif sur cet écran jusqu'à « Terminé » ou « Supprimer » : recharger ou fermer par erreur ferait perdre le lien et le mot de passe d'un partage qui existe (§18, A12).

### 9.6 Gestion (`/m/:id`)

- Au chargement : `parseLink(location.href)` puis `history.replaceState` (§12.1) ; squelette pendant `shareStatus`.
- `ready` : « Ouvert 1 / 3 · Expire dans 4 h 15 » (tabulaire), **Supprimer maintenant** (`danger`, `InlineConfirm` « Supprimer ce partage pour tout le monde ? C'est immédiat et définitif. »).
- `draining` : « Toutes les ouvertures sont utilisées · effacement à la fin du dernier téléchargement » ; Supprimer reste possible.
- `uploading` : « Envoi en cours » (cas d'un second onglet), Supprimer possible (arrête l'envoi de l'autre onglet, qui affichera « Le transfert a été interrompu »).
- `NotFoundError` ou après suppression : dissolution puis **« Supprimé »**, sans raison (spec §5.1).
- Actualisation : bouton `refresh-cw` et relecture toutes les 60 s tant que la page est visible ; `LimitError` suspend la relecture jusqu'à `retryAfterS` ; `Error("reseau")` : bandeau « Connexion impossible » + Réessayer ; hors ligne : relecture suspendue jusqu'à `online`.
- Le compte à rebours local continue entre deux relectures ; à zéro : relecture immédiate (qui rendra « Supprimé »).

### 9.7 Ouverture (`/s/:id`)

1. `parseLink(location.href)` ; `#` absent ou invalide → §9.11 « Lien incomplet » ; sinon `replaceState` (sauf navigateur intégré, S4).
2. `fetchMeta` (squelette) → `NotFoundError` ou `Error("lien_invalide")` : §9.11 « Lien invalide ». `Error("reseau")` : « Connexion impossible. Vérifiez votre réseau et réessayez. » + Réessayer. `LimitError` : « Trop de demandes rapprochées. Réessayez dans {durée}. »
3. Écran :
   - « Quelqu'un vous a envoyé un partage chiffré. Shhdrop ne vérifie pas l'identité de l'expéditeur. »
   - `Countdown` « Disponible encore 5 h 31 ». **À zéro** (avant déverrouillage) : passage local à « Lien invalide », sans requête (§18, A22).
   - Champ mot de passe (attributs §12.3), Afficher/Masquer, **Déverrouiller** (`primary`, `lock-open`), Entrée par `keydown`.
   - Note : « Déverrouiller utilise une ouverture. Si le téléchargement échoue ensuite, cette ouverture est perdue. »
4. Pendant `openShare` : bouton en chargement, « Déchiffrement de la clé… » (Argon2id, environ 1 s, plus sur un vieux téléphone). Double appui sans effet (bouton désactivé synchrone).
5. Erreurs :
   - `BadPasswordError{attemptsLeft}` → « Mot de passe incorrect · {n} essai(s) restant(s) » ; avec 1 restant, en plus : « Au prochain échec, le partage sera détruit. » Le champ garde sa valeur, sélectionnée, focus.
   - Échec du **dernier** essai (on avait `attemptsLeft = 1`, la réponse est `NotFoundError`) → « Mot de passe incorrect. Le partage a été détruit. » (et non le message générique : la personne sait déjà qu'il existait, §18, A23).
   - `LimitError` → « Trop de tentatives rapprochées. Réessayez dans {durée}. » (bouton désactivé, compte à rebours).
   - `NotFoundError` (autre cas) → §9.11.
   - `Error("reseau")` → message réseau, sans affirmer si une ouverture a été consommée (l'écran ne peut pas le savoir).

**Navigateur intégré** (table testée dans `env.ts` : Instagram, FBAN/FBAV/FB_IAB, Messenger, LinkedInApp, Snapchat, TikTok `musical_ly`/`BytedanceWebview`, Line, Telegram, WeChat `MicroMessenger`) : bandeau `warn` avant tout le reste : « Vous êtes dans le navigateur intégré de {app}, qui peut lire cette page. Ouvrez ce lien dans votre navigateur habituel (menu de l'app, puis « Ouvrir dans le navigateur »). » Boutons **Copier le lien** et **Continuer ici quand même**. Le champ n'apparaît qu'après « Continuer ici ». Une PWA installée n'est jamais signalée.

### 9.8 Contenu

- Bandeau collé en haut (verre) : `Countdown` « Disponible encore 5 h 31 · disparaît quand vous quittez la page · recharger consomme une ouverture ».
- Éléments regroupés par catégorie, dans l'ordre du manifeste (§9.2.4), catégorie déduite de `previewKind(i)` et de l'extension de `safeName(i)` (purement visuel). Chaque ligne : `safeName(i)`, taille, actions selon `previewKind(i)` et la taille :

| `previewKind` | ≤ 200 Mio | > 200 Mio |
|---|---|---|
| `text` | Affiché aussitôt (le texte est dans le manifeste), `<pre>` en texte brut, `dir="auto"`, Copier | — (≤ 10 000 caractères) |
| `image` | Chargée automatiquement si ≤ 20 Mio, sinon « Afficher » ; `<img>` depuis une URL blob, plein écran au toucher, zoom natif | Enregistrer seulement |
| `audio` | « Écouter » → `<audio controls>` | Enregistrer seulement |
| `video` | « Regarder » → téléchargement complet avec progression, puis `<video controls playsinline>` (spec §12) | Enregistrer seulement |
| `pdf` | « Lire » → visionneuse isolée (§13) | Enregistrer seulement |
| `none` | Enregistrer seulement | Enregistrer seulement |

- Lecture pour l'aperçu : `saveItem(i, sink)` avec un `sink` qui accumule les tranches et compte les octets (progression « 12 Mo / 48 Mo », pourcentage, Annuler) ; à la fin, `new Blob(tranches, { type: TYPE_SUR[kind] })` (table fixe : `image` → type d'origine seulement s'il est dans la liste blanche JPEG, PNG, WebP, GIF, AVIF, SVG, HEIC ; `audio` → `audio/mp4` ou `audio/webm` ; `video` → `video/mp4`, `video/quicktime` ou `video/webm` ; sinon refus), puis mise à zéro des tranches. Un seul aperçu en téléchargement à la fois (les autres boutons attendent) : borne mémoire et bande passante.
- **Échec de décodage** (`error` sur `<img>`, `<audio>`, `<video>`, par exemple une vidéo HEVC d'iPhone sur Android) : la visionneuse est retirée, « Ce fichier ne peut pas être lu sur cet appareil. Enregistrez-le pour l'ouvrir avec une autre application. » + Enregistrer (spec §12 : un échec de décodage vaut `none`).
- Images : l'URL blob est **révoquée dès `load`** (§12.4).
- Erreurs de lecture : `Error("reseau")` → « Téléchargement interrompu. » + Réessayer (le jeton vaut 3 h) ; `NotFoundError` → « Ce partage n'est plus disponible (expiré ou détruit). Ce qui est déjà affiché reste visible jusqu'à ce que vous quittiez la page. » et tous les boutons de lecture et d'enregistrement sont désactivés.
- **Expiration pendant la lecture** : compte à rebours à zéro → bandeau « Expiré · ce qui est affiché disparaît quand vous quittez la page », boutons d'aperçu et d'enregistrement désactivés, téléchargements en cours arrêtés par le serveur (message « Téléchargement interrompu : le partage a expiré. »).
- **`beforeunload`** actif seulement pendant un aperçu ou un enregistrement en cours (recharger couperait le téléchargement et consommerait une ouverture) ; jamais le reste du temps (quitter la page est la fin normale).
- Pied de la liste : **Terminer et effacer** (`secondary`) → `done()`, `wipe()`, révocation des URL blob, dissolution, « Effacé de cet appareil. » ; **Détruire maintenant** (`danger`, §9.10) ; **Signaler** (`ghost`, `flag`, §9.10).
- Mémoire : avant un aperçu vidéo ou un enregistrement par Blob de plus de 200 Mio sur un appareil où `navigator.deviceMemory` < 4, ou sur iPhone/iPad, bandeau « Cet appareil risque de manquer de mémoire pour un fichier de cette taille. »

### 9.9 Enregistrer (fichiers lourds compris)

1. Si `isRiskyFile(i)` : `InlineConfirm` `warn` « « {nom} » peut exécuter du code sur votre appareil. N'ouvrez ce fichier que si vous faites confiance à l'expéditeur. » → « Enregistrer quand même » / « Annuler ».
2. Si `showSaveFilePicker` existe : sélecteur avec `suggestedName: safeName(i)` → `createWritable()` → `saveItem(i, chunk => writable.write(chunk))` avec progression (« 120 Mo / 800 Mo · 18 Mo/s ») et **Annuler** → `close()` → « Enregistré ». Erreur ou annulation : `writable.abort()` (fichier partiel supprimé) et « Enregistrement interrompu : le fichier incomplet a été supprimé. » + Réessayer. Annulation du sélecteur (`AbortError`) : retour silencieux. Disque plein (`QuotaExceededError`) : « Plus de place sur cet appareil. Le fichier incomplet a été supprimé. »
3. Sinon : `collectToBlob(opened, i)` (même progression), puis `<a download="{safeName}">` sur une URL blob `application/octet-stream`, cliqué par le code, URL révoquée 60 s après. Note sous le bouton, au-delà de 200 Mio : « Sur ce navigateur, le fichier est assemblé en mémoire avant l'enregistrement. » (spec §18.7). Annuler arrête `saveItem` (signal) et libère le Blob.
4. Jamais « Enregistré » tant que `close()` n'a pas réussi (ou que le lien n'a pas été déclenché, pour le repli).

### 9.10 Détruire, signaler (destinataire)

- **Détruire maintenant** : `InlineConfirm` `danger` « Détruire ce partage pour tout le monde ? C'est immédiat et définitif. » → `opened.destroy()` → `wipe()` → dissolution → « Ce partage a été détruit. »
- **Signaler** : `Sheet` « Signaler ce contenu » : « Le partage sera détruit immédiatement pour tout le monde. Shhdrop ne peut pas voir le contenu et ne garde aucune trace de votre signalement. Pour un contenu illégal, vous pouvez aussi le signaler aux autorités (en France : PHAROS, internet-signalement.gouv.fr). » → **Signaler et détruire** (`danger`) / **Annuler**. Appel : `opened.destroy("report")`. Pas de choix de motif : le serveur n'en garde aucun (§18, A13).
- `NotFoundError` (déjà détruit ou expiré) : même fin (« Ce partage n'existe plus. »), `wipe()`.
- `Error("reseau")` : « Connexion impossible : le partage n'a pas été détruit. » + Réessayer (rien n'est effacé localement).
- Après `wipe()`, les boutons de destruction disparaissent (`cles_effacees` ne peut pas être atteint par l'interface).

### 9.11 Lien invalide, lien incomplet, navigateur non pris en charge, 404

| État | Quand | Texte |
|---|---|---|
| Lien invalide | `NotFoundError` à `fetchMeta` ou `openShare`, `Error("lien_invalide")`, ou compte à rebours à zéro avant déverrouillage | « Ce lien n'existe pas ou n'est plus disponible. » (message unique, spec §5.2). Visuel : la capsule déjà dissoute (grain immobile), lien « Envoyer quelque chose » vers `/` |
| Lien incomplet | Pas de `#`, ou `parseLink` refuse localement (la requête `?…` est ignorée avant l'analyse : nos liens n'en portent jamais, les applications y ajoutent `?fbclid=…`) | « Ce lien est incomplet. Rouvrez-le depuis le message d'origine. » + « La partie secrète a peut-être été retirée de la barre d'adresse après une première visite. » |
| Navigateur non pris en charge | Une capacité de §9 manque | « Ce navigateur ne permet pas de chiffrer en sécurité. Utilisez une version récente de Safari, Chrome, Firefox ou Edge. » Rien n'est envoyé (spec §10) |
| 404 | Route inconnue | « Cette page n'existe pas. » + lien accueil |

### 9.12 Pages « Comment ça marche / sécurité » et « Confidentialité » (Read)

- `/securite` : le mécanisme en quatre paragraphes (clé dans le `#`, mot de passe, chiffrement dans le navigateur, autodestruction), le modèle de menaces résumé (spec §2), **les limites assumées** (spec §18, intégralement, en langage simple), la phrase de §18.11. Jamais « 100 % sécurisé ».
- `/confidentialite` : la liste exacte de ce qui est traité (spec §9) ; « Shhdrop ne dépose aucun cookie et ne mesure pas l'audience » ; l'adresse IP est vue sans être enregistrée (spec §18.3). Section `#verification` : « Vérification anti-robot. Par défaut, elle se fait sur votre appareil, sans service tiers. Si elle échoue, Shhdrop peut vous proposer la vérification de Google reCAPTCHA. Elle ne se charge qu'après votre accord, dans une page séparée (`{origine de vérification}`) qui n'a accès ni à votre contenu, ni à votre lien, ni à votre mot de passe. Dans ce cas, **Google voit votre adresse IP** et des informations sur votre navigateur, et peut déposer des cookies sur ses propres domaines ; ses règles de confidentialité s'appliquent (lien). Le serveur de Shhdrop transmet seulement à Google le jeton de vérification, jamais votre adresse IP. »
- Mesure 68 ch, `--fs-body` 1.0625rem, titres en `--fs-h2`.

---

## 10. Textes (FR / EN)

- Dictionnaires typés : `web/src/i18n/fr.ts` (référence, `as const`) et `en.ts` (`satisfies Record<keyof typeof fr, …>`). Paramètres nommés, pluriels par `Intl.PluralRules`, nombres et tailles par `Intl.NumberFormat`, durées par un formateur testé (FR « 4 h 15 », « 12 min », « 45 s », « moins d'une minute » ; EN « 4h 15m », « 12 min », « 45 s », « less than a minute »), vitesses (« 4,2 Mo/s » / « 4.2 MB/s »). Les formateurs produisent eux-mêmes des espaces insécables entre un nombre et son unité : U+202F en français, U+00A0 en anglais (les écrans n'ont pas besoin de CSS pour éviter la coupure).
- Langue : `navigator.languages` (la première langue de la liste dont la langue primaire est `fr` ou `en` décide ; aucune des deux → français) ; bascule dans l'en-tête, sans mémorisation. `<html lang>` mis à jour. La bascule est désactivée pendant un envoi (elle ne change rien d'utile et ferait sauter les libellés).
- Aucun texte venu du serveur n'est affiché.

Clés principales (extrait normatif ; le plan fixe la liste complète) :

| Clé | FR | EN |
|---|---|---|
| `hero.title` | Un lien, un mot de passe, puis plus rien. | One link, one password, then nothing. |
| `hero.lede` | Texte, photos, vidéos, vocaux, documents. Chiffrés sur votre appareil avant l'envoi : le serveur ne reçoit que des données chiffrées, jamais la clé. | Text, photos, videos, voice notes, documents. Encrypted on your device before sending: the server only receives encrypted data, never the key. |
| `compose.add.files` / `.photo` / `.voice` / `.text` / `.paste` | Fichiers / Photo / Vocal / Texte / Coller | Files / Photo / Voice / Text / Paste |
| `compose.drop` | Déposez pour ajouter | Drop to add |
| `compose.folder` | Les dossiers ne peuvent pas être ajoutés. Ajoutez les fichiers eux-mêmes, ou une archive .zip. | Folders can't be added. Add the files themselves, or a .zip archive. |
| `compose.cat.*` | Texte / Photos / Vidéos / Audio et vocaux / Documents / Autres | Text / Photos / Videos / Audio and voice / Documents / Other |
| `compose.moved` | {nom} : position {i} sur {n} dans {categorie}. | {name}: position {i} of {n} in {category}. |
| `compose.removed` | {nom} retiré | {name} removed |
| `compose.duplicate` | En double ? | Duplicate? |
| `compose.gauge` | {taille} / 1 Go · {n} / 10 | {size} / 1 GB · {n} / 10 |
| `compose.gauge.empty` | Rien à envoyer pour l'instant · 1 Go et 10 éléments au plus | Nothing to send yet · up to 1 GB and 10 items |
| `compose.tooBig` | Trop gros : {taille} sur 1 Go. Retirez {exces}. | Too big: {size} of 1 GB. Remove {excess}. |
| `compose.tooMany` | {n} éléments n'ont pas été ajoutés : 10 au plus. | {n} items were not added: 10 at most. |
| `compose.cleaned` | Nettoyé · lieu, appareil et date de prise de vue retirés | Cleaned · location, device and capture date removed |
| `options.ttl.hint` | Comptée à partir de la fin de l'envoi. | Counted from the end of the upload. |
| `options.opens.hint` | Une ouverture = un déverrouillage réussi. | One open = one successful unlock. |
| `options.submit` | Chiffrer et envoyer | Encrypt and send |
| `seal.keys` | Préparation des clés | Preparing keys |
| `seal.captcha` | Vérification anti-robot · calcul sur votre appareil | Bot check · computed on your device |
| `seal.upload` | Chiffrement et envoi | Encrypting and sending |
| `seal.padding` | La taille envoyée est arrondie au palier supérieur pour masquer la taille réelle. | The uploaded size is rounded up to hide the real size. |
| `seal.offline` | Connexion perdue. Nouvel essai dans {duree}… | Connection lost. Retrying in {duration}… |
| `seal.paused` | En pause · reprise automatique dans {duree} | Paused · resumes automatically in {duration} |
| `seal.cancel.confirm` | Annuler l'envoi ? Ce qui a été envoyé sera effacé du serveur. | Cancel the upload? What was sent will be erased from the server. |
| `verif.title` | Vérification supplémentaire | Extra check |
| `verif.body` | (texte de §9.4.2) | (text of §9.4.2) |
| `verif.continue` | Continuer avec Google | Continue with Google |
| `ready.pw.reminder` | Envoyez-le par un autre moyen que le lien. Les deux dans la même messagerie, c'est comme ne pas en mettre. | Send it another way than the link. Both in the same chat is like having no password. |
| `ready.delete.confirm` | Supprimer ce partage pour tout le monde ? Le lien ne mènera plus à rien. | Delete this share for everyone? The link will lead nowhere. |
| `ready.never` | Ces informations ne seront plus jamais affichées. | This information will never be shown again. |
| `open.intro` | Quelqu'un vous a envoyé un partage chiffré. Shhdrop ne vérifie pas l'identité de l'expéditeur. | Someone sent you an encrypted share. Shhdrop does not verify who the sender is. |
| `open.cost` | Déverrouiller utilise une ouverture. Si le téléchargement échoue ensuite, cette ouverture est perdue. | Unlocking uses one open. If the download then fails, that open is lost. |
| `open.badPw` | Mot de passe incorrect · {n} essai restant / {n} essais restants | Wrong password · {n} attempt left / {n} attempts left |
| `open.lastTry` | Au prochain échec, le partage sera détruit. | One more failure and the share will be destroyed. |
| `open.destroyedByPw` | Mot de passe incorrect. Le partage a été détruit. | Wrong password. The share has been destroyed. |
| `content.banner` | Disponible encore {duree} · disparaît quand vous quittez la page · recharger consomme une ouverture | Available for {duration} · disappears when you leave the page · reloading uses an open |
| `content.finish` | Terminer et effacer | Finish and erase |
| `content.undecodable` | Ce fichier ne peut pas être lu sur cet appareil. Enregistrez-le pour l'ouvrir avec une autre application. | This file can't be played on this device. Save it to open it with another app. |
| `content.risky` | « {nom} » peut exécuter du code sur votre appareil. N'ouvrez ce fichier que si vous faites confiance à l'expéditeur. | “{name}” can run code on your device. Only open it if you trust the sender. |
| `report.body` | (texte de §9.10) | (text of §9.10) |
| `invalid` | Ce lien n'existe pas ou n'est plus disponible. | This link does not exist or is no longer available. |
| `manage.status` | Ouvert {u} / {max} · Expire dans {duree} | Opened {u} / {max} · Expires in {duration} |
| `manage.gone` | Supprimé | Deleted |
| `err.limit` | Limite d'envois atteinte. Réessayez dans {duree}. | Upload limit reached. Try again in {duration}. |
| `err.full` | Le service est plein pour le moment. Réessayez plus tard. | The service is full right now. Try again later. |
| `err.interrupted` | Le transfert a été interrompu (le serveur a peut-être redémarré). Réessayez. | The transfer was interrupted (the server may have restarted). Try again. |

---

## 11. Accessibilité (spec §19)

- Contrastes : §3.2, recalculés par test ; `axe-core` sans violation (WCAG 2.1 A et AA) sur chaque écran et état, sur Chromium et WebKit. Contraste forcé : §3.3, vérifié par une capture Chromium en `forced-colors: active`.
- Clavier : tout atteignable dans l'ordre visuel ; anneau 2 px `--accent` décalé de 2 px, `:focus-visible` seulement, jamais retiré. Au changement d'étape ou d'écran, le focus va au titre (`tabindex="-1"`) ; après une erreur, au message ; après un retrait, à la ligne voisine ; après un déplacement, il reste sur la ligne déplacée. Échap ferme les feuilles et la cible de dépôt. Lien d'évitement « Aller au contenu ». Pendant l'envoi, le composeur masqué est `inert`.
- Lecteurs d'écran : un seul `LiveRegion` poli. Envoi annoncé tous les 10 % (« 40 %, environ 2 min restantes »), plus « En pause », « Connexion perdue », « Connexion rétablie », « Partage créé » ; preuve de travail : « Vérification anti-robot en cours » une fois ; compte à rebours annoncé aux seuils 1 h, 15 min, 5 min, 1 min et à l'expiration ; affichage visuel à la minute au-delà d'une heure, à la seconde sous 5 min. Erreurs en `role="alert"`. Capsule : `role="progressbar"`, `aria-valuenow`, `aria-valuetext` (« 42 %, 214 Mo sur 400 Mo »). Jauge : deux `role="meter"` (taille, nombre) avec `aria-valuetext`. Icônes décoratives `aria-hidden`.
- Glisser-déposer, réordonnancement à la souris, collage : chacun a son équivalent au clavier ou par bouton (Fichiers, Alt + flèches et mode déplacement, Coller).
- Cibles tactiles ≥ 44 × 44 px (poignée de déplacement comprise) ; ≥ 8 px entre cibles.
- Agrandissement : mise en page en `rem`, aucun texte coupé à 200 % ni avec une police système de 24 px ; testé à 320 px de large et en paysage 844 × 390.
- Mouvement : §7.5. Transparence : §5.4. `prefers-contrast: more` : filets en `--line-strong`, lumière d'ambiance retirée, verre remplacé par du plein.
- Langue : `lang` sur `<html>` ; noms de fichiers dans `<bdi>`.
- Vérification manuelle (spec §14) : VoiceOver (iPhone, y compris le mode déplacement), TalkBack (Android).

---

## 12. Règles de sécurité de l'interface

### 12.1 Lien et historique

- `parseLink(location.href)` (requête ignorée) dès le démarrage de la route, puis `history.replaceState(null, "", location.pathname)` (spec §5.3) : le `#` **et la requête** (paramètres de suivi) quittent la barre et l'historique. Sur **toute autre route** (404 comprise : lien abîmé `/s/{id}/#…`, `/S/…`, hors base de démo), un `#` non vide est retiré de la même façon, y compris quand il est collé dans la barre sur la même page (`hashchange`). Exceptions : navigateur intégré (S4) et navigateur non pris en charge (§9.11). Un dernier segment avec un point (`/s/{id}.`) est servi par l'application comme les autres (spec §10, « Fichiers du site »).
- L'expéditeur ne voit jamais son lien dans la barre d'adresse : les liens sont affichés, pas navigués.
- Aucun lien, clé ni mot de passe dans `localStorage`, `sessionStorage`, IndexedDB, cookies, titre de page, `console`, ni dans un message `postMessage` (cadre PDF, cadre de vérification).

### 12.2 Cache « page précédente » (spec §21)

- `pagehide` : arrêt de l'envoi en cours (§9.4.6), `opened.wipe()`, révocation de toutes les URL blob, remise à zéro de l'état (lien, mot de passe, manifeste, composeur oubliés), `done()` (en `keepalive`), arrêt du micro.
- `pageshow` avec `event.persisted` : `location.reload()`.
- Test e2e : contenu ouvert → navigation → Retour → la page recharge et le contenu n'est plus là.

### 12.3 Saisie

| Champ | Attributs |
|---|---|
| Mot de passe du destinataire | `type="password"`, `autocomplete="one-time-code"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`, `name`/`id` neutres (`shh-unlock`), hors de tout `<form>`, `enterkeyhint="go"` |
| Mot de passe personnel de l'expéditeur | `type="text"` (masquable), mêmes attributs, `autocomplete="off"` |
| Texte du composeur, renommage | `autocomplete="off"`, `autocorrect="off"`, `spellcheck="false"`, `autocapitalize="off"` (spec §21 ; limite : le clavier peut tout de même apprendre) |

- Aucune balise `<form>` sur les écrans d'envoi et d'ouverture ; Entrée gérée par `keydown`.
- Vérification manuelle : aucun gestionnaire de mots de passe ne propose d'enregistrer.

### 12.4 Affichage du contenu reçu

- Visionneuse : `previewKind(i)` seulement ; nom : `safeName(i)` seulement.
- Texte : interpolation Svelte, jamais `{@html}`, jamais de liens rendus cliquables.
- **`{@html}` interdit dans tout le code** (règle de lint et test de recherche).
- SVG : `<img>` seulement, URL révoquée au `load`.
- Téléchargement : Blob `application/octet-stream`, nom `safeName(i)`.
- Aucun `URL.createObjectURL` sur un type hors de `TYPE_SUR` (§9.8) côté destinataire ; côté expéditeur, seulement pour les vignettes d'images nettoyées (sa propre donnée).

### 12.5 CSP (spec §10) et code

- Aucun script ni style en ligne, aucun `eval`, aucun `new Function`, aucun attribut `style` statique (S9), aucune URL `data:`.
- **Ajout unique à la CSP** des pages de l'application, et seulement quand le repli est activé : `frame-src 'self' {SHH_VERIF_ORIGIN}`. `connect-src`, `script-src`, `img-src` restent inchangés : Google n'est jamais joignable depuis la page qui détient les clés.
- Test e2e commun : toute violation CSP ou message « Refused to » fait échouer le test.
- Test e2e « aucune ressource tierce » : toute requête **du cadre principal** vers une autre origine que le serveur échoue le test. La seule exception, dans les seuls tests du repli, est le chargement du document `VerifFrame` depuis l'origine de vérification de test ; les requêtes faites **depuis** ce cadre ne sont jamais celles de la page principale.
- `translate="no"` sur `<html>` et `<meta name="google" content="notranslate">`.
- Le serveur ajoute `X-Robots-Tag: noindex` sur `/s/*` et `/m/*`, `robots.txt` les interdit. `index.html` ne contient aucune balise `og:*`.

### 12.6 Presse-papier

- Écriture seulement sur geste explicite ; repli : sélection du texte et « Copiez-le manuellement ».
- Lecture seulement sur geste explicite (Ctrl/Cmd + V, bouton Coller), seulement sur l'accueil (§9.2.3).
- « Vider le presse-papier » écrit une chaîne vide, avec la mention honnête de §9.5.

---

## 13. PDF isolé (spec §12)

- `<iframe src="/pdf-frame.html" sandbox="allow-scripts" referrerpolicy="no-referrer" title="Document PDF">` ; jamais `allow-same-origin`, `allow-popups`, `allow-top-navigation`, `allow-forms`, `allow-downloads`.
- `pdf-frame.html` charge un **script classique** `pdf-frame.js` (build Vite séparé, IIFE) contenant pdf.js (`pdfjs-dist@6.5.438`) et son worker sur le fil principal (`globalThis.pdfjsWorker`), plus `pdf-frame.css`. Le serveur sert ces trois fichiers (noms sans empreinte, produits par `vite.pdf-frame.config.ts`) avec `Cross-Origin-Resource-Policy: cross-origin` (S10) ; ils ne contiennent aucun secret. `/pdf-frame.html` porte en plus `frame-ancestors 'self'` à la place du `frame-ancestors 'none'` des autres réponses (liste fermée, test Go) : sans cela l'application ne pourrait pas l'afficher dans son propre `iframe` en production, alors que la démo, dont la CSP est une meta qui ignore `frame-ancestors`, passerait.
- Options : `isEvalSupported: false` (sans lui pdf.js compile les polices par `new Function`, ce que la CSP interdit), `disableWorkerRendering: true`, `enableXfa: false`, `useWasm: false`, `isOffscreenCanvasSupported: false`, pas de calque d'annotations ni de texte, rendu en `<canvas>` page par page, à la demande.
- Données : le parent envoie `{ type: "pdf", bytes }` (ArrayBuffer **transféré**) après `{ type: "ready" }` venu de `event.source === iframe.contentWindow`. Le cadre n'accepte que les messages de `window.parent`, renvoie `{ type: "rendered", pages }` ou `{ type: "error" }`. Cible `"*"` imposée par l'origine opaque ; la vérification porte sur `event.source`.
- Commandes : page précédente/suivante, zoom −/+, ajustement à la largeur ; libellés passés par le parent.
- Échec (erreur, 20 s, PDF chiffré) : « Ce PDF ne peut pas être affiché ici. » + Enregistrer.
- Les noms d'options ci-dessus sont à vérifier dans `pdfjs-dist@6.5.438` avant le prototype (`disableWorkerRendering` n'est pas une option documentée de pdf.js) ; ce paragraphe est corrigé selon le résultat.
- Le prototype de la tâche PDF décide : il tourne contre le **serveur Go** (en-têtes réels), sur Chromium **et** WebKit ; échec sur l'un des deux → visionneuse retirée, `pdf` en « Enregistrer seulement ». La démo n'est qu'un contrôle de plus (ni CORP ni `frame-ancestors` sur Pages).

---

## 14. PWA et serveur statique

### 14.1 Manifeste et icônes (sans service worker, spec §10)

- `web/public/manifest.webmanifest` : `name` et `short_name` « Shhdrop », `lang` « fr », `start_url` et `scope` « ./ » (relatifs au manifeste : racine en production, `/Shhdrop/` dans la démo ; même valeur dans les deux builds), `display` « standalone », `background_color` et `theme_color` `#0B0D12`, `description` = `hero.lede`, icônes `icon.svg` (`any`), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (zone sûre 80 %).
- `apple-touch-icon.png` 180 × 180 ; **une seule** `<meta name="theme-color" content="#0B0D12">` (P1) ; `<meta name="color-scheme" content="dark">`.
- PNG produits par `web/scripts/gen-icons.mjs` (`rsvg-convert` ou `ffmpeg`, outil local) et commités.
- Installation vérifiée à la main (iPhone, Android, Chrome ordinateur).

### 14.2 Serveur statique Go

- **Déjà livré** sur `main` par le durcissement (`server/cmd/shhdrop/static.go`) : `SHH_STATIC_DIR`, `os.Root`, fichiers cachés refusés, aucune liste de dossier, repli monopage (chemin sans extension → `index.html`, 200), `GET`/`HEAD` seulement.
- Ce plan ajoute seulement : `X-Robots-Tag: noindex` sur `/s/*` et `/m/*` ; `robots.txt` (`Disallow: /s/`, `Disallow: /m/`) ; `Cross-Origin-Resource-Policy: cross-origin` sur `/pdf-frame.js`, `/pdf-frame.css`, `/pdf-frame.html` seulement, et `frame-ancestors 'self'` (au lieu de `'none'`) sur `/pdf-frame.html` seulement (§13) ; `frame-src` étendu quand le repli est activé (§12.5). Les en-têtes existants (dont `Cache-Control: no-store`) restent sur toutes les réponses.

---

### 14.3 Démo sur GitHub Pages (P8)

But : essayer toute l'interface à l'adresse `https://skoow.github.io/Shhdrop/` sans serveur. **Le vrai client tourne** (Argon2id, AES-GCM, paquet chiffré, segments) ; seul le réseau est remplacé par un faux serveur en mémoire dans la page.

**Construction séparée, absente de la production.**
- `npm run build:demo` = `vite build --mode demo` : `base: "/Shhdrop/"`, sortie `web/dist-demo/` (jamais `web/dist/`).
- Tout le code de démo vit dans `web/src/demo/` et n'est atteint que par `if (import.meta.env.MODE === "demo") await import("./demo/install")` dans `main.ts` : en production, la condition vaut `false` à la compilation et le module disparaît. Deux gardes : un greffon Vite (`demoGuard`) qui **fait échouer** le build de production si un module de `src/demo/` y entre, et un script `web/scripts/check-dist.mjs` (lancé par `make test-web` et la CI après `npm run build`) qui échoue si `dist/` contient la marque `__SHH_DEMO__` (chaîne présente dans chaque module de démo), `fake-server`, la balise meta CSP de démo ou le bandeau, et qui vérifie l'inverse sur `dist-demo/`.

**Faux serveur** (`web/src/demo/fake-server.ts`) :
- Installé avant le démarrage de l'application : remplace `globalThis.fetch` et `XMLHttpRequest` (les envois de segments passent par XHR, §0.1) pour les seules URL `/api/*` de l'origine ; toute autre requête part normalement (fichiers du site).
- Répond aux **mêmes routes**, mêmes corps JSON, mêmes codes (`/api/captcha`, création, segments, `finalize`, `meta`, `unlock`, lecture de segments, `done`, `destroy`, `status`) et applique les mêmes règles visibles : palier et taille exacte des segments, `K_accès` / `K_preuve` / `S_gestion` comparés par empreinte SHA-256, ouvertures, 5 essais puis destruction, `draining`, expiration (horloge réelle), 404 uniformes. Il ne stocke que du chiffré, dans une `Map` de la page. Les limites par connexion et les quotas ne sont pas simulés.
- Débit simulé : 20 Mo/s pour les segments (pour que l'écran d'envoi se voie) ; `?lent` le ramène à 1 Mo/s et `?coupure` coupe le réseau 20 s au milieu de l'envoi (pour essayer la reprise).
- Fidélité prouvée : les tests du faux serveur font tourner le **vrai** client (`createShare`, `openShare`, `destroyShare`, `shareStatus`) contre lui, et rejouent les cas d'erreur de la spec §13.

**Anti-robot désactivé** : en démo, `solveCaptcha` rend aussitôt une preuve factice que seul le faux serveur accepte ; le libellé de phase devient « Vérification anti-robot désactivée (démo) ». Aucun repli reCAPTCHA (`fallback: null`). L'attente de 3,1 s de `createShare` reste (c'est le vrai client).

**« Le lien ne marche que dans cet onglet »** : tout est en mémoire ; recharger, ouvrir un nouvel onglet ou un autre appareil fait tout perdre.
- Bandeau `warn` collé tout en haut, **sur toutes les pages, non fermable** : « Démo : rien n'est envoyé, le lien ne marche que dans cet onglet. » (EN : « Demo: nothing is sent, the link only works in this tab. ») ; le titre des onglets commence par « Démo · ».
- Sur « Lien prêt », un bouton en plus : **Ouvrir comme destinataire (démo)**, qui navigue dans l'application (`pushState`, sans rechargement) vers le lien, et un retour « Revenir à la gestion (démo) » sur l'écran de contenu. Coller le lien dans la barre d'adresse recharge la page : le lien est alors invalide, et l'écran « Lien invalide » ajoute en démo « (normal en démo : le partage n'existait que dans l'onglet d'origine) ».
- Les liens affichés en démo incluent la base (`https://skoow.github.io/Shhdrop/s/{id}#…`) ; `link.ts` retire `import.meta.env.BASE_URL` du chemin avant `parseLink`, et le routeur en fait autant.
- GitHub Pages n'a pas de repli monopage : le build copie `index.html` en `404.html` (une adresse profonde est servie avec le code 404, l'application s'affiche quand même).

**CSP par balise meta** (Pages n'envoie pas nos en-têtes). Injectée par le greffon Vite en mode démo seulement, en premier élément de `<head>` :
`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'">`, plus `<meta name="referrer" content="no-referrer">` et `<meta name="robots" content="noindex">`.

Ce qui manque par rapport à la production (écrit aussi sur la page Sécurité de la démo) :

| Protection de production | En démo |
|---|---|
| `frame-ancestors 'none'` | **Absent** : ignoré dans une balise meta ; la démo peut être affichée dans le cadre d'un autre site (clickjacking possible, sans enjeu : aucun secret réel) |
| `report-uri`, `sandbox` de CSP | Absents (non pris en charge en meta) |
| `Strict-Transport-Security` | Le nôtre est absent ; `github.io` est dans la liste HSTS préchargée des navigateurs et Pages force HTTPS |
| `Permissions-Policy: microphone=(self), camera=(), geolocation=()` | **Absent** (aucun équivalent meta) : le micro reste demandé par le navigateur, mais la politique n'est pas restreinte |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | Absents |
| `X-Content-Type-Options: nosniff` | Dépend de Pages (non garanti par nous) |
| `Cache-Control: no-store` | Absent : Pages met en cache ; le bfcache est neutralisé par `pagehide`/`pageshow` comme en production |
| `X-Robots-Tag: noindex` | Remplacé par la meta `robots` |
| Origine propre | **Partagée** : `skoow.github.io` est commune à tous les dépôts Pages du propriétaire ; sans enjeu en démo (rien de réel), à ne jamais réutiliser pour la production |
| `Trusted Types` | Absent dans les deux (S8) |

Les tests e2e de la démo exigent zéro violation de la CSP meta et zéro requête hors de l'origine.

**Publication** : `.github/workflows/pages.yml` (déjà présent sur `main` avec une page d'attente) se déclenche sur un push vers `main` ; il installe Node, lance `npm ci`, `npm run build:demo`, `node scripts/check-dist.mjs --demo`, puis `actions/upload-pages-artifact` sur `web/dist-demo` et `actions/deploy-pages` (actions épinglées par empreinte). La démo est mise à jour à chaque tâche du plan qui change un écran.

---

## 15. Repli anti-robot reCAPTCHA (P3) : architecture

### 15.1 Choix : reCAPTCHA v2 « case à cocher »

v2 case à cocher plutôt que v3 invisible :
- **Consentement lisible** : la personne a cliqué « Continuer avec Google », puis coche une case ; v3 tourne en silence, ce qui contredit l'esprit du produit et la mention de la page Confidentialité.
- **Décision franche** : v2 rend « réussi / échoué » ; v3 rend une note de 0 à 1 qu'il faudrait seuiller, et qui pénalise justement les visiteurs prudents (VPN, Tor, navigateurs anti-pistage), sans recours pour eux. v2 leur propose une grille d'images.
- **Isolement** : v3 obtient de meilleures notes en tournant sur toutes les pages du site, ce que l'isolement interdit ; v2 n'a besoin que de sa page.

### 15.2 Origine séparée

- Une page statique du dépôt, `web/verif/index.html` + `verif.js` + `verif.css` (build séparé, aucun code partagé avec l'application), servie sur une **origine distincte** fournie par la configuration `SHH_VERIF_ORIGIN`. Le Plan 3 la déploie (Caddy).
- **Recommandé : un site distinct**, soit un domaine enregistrable acheté (par exemple `shhverif.net`), soit, sans achat, un sous-domaine d'un suffixe public comme une page GitHub d'une organisation dédiée (`<nom>.github.io`, `github.io` est dans la liste Public Suffix, donc un site à part : même isolement qu'un domaine acheté). Le serveur refuse au démarrage une origine du même site que l'application (spec §26 ; `SHH_ORIGIN` donne l'origine du site, `sameSite()` utilise une liste minimale embarquée des suffixes publics `github.io` et `pages.dev`, sinon les deux derniers labels : `a.github.io` et `b.github.io` sont deux sites, `verif.shhdrop.app` et `shhdrop.app` un seul ; limite : un suffixe à plusieurs labels absent de la liste, comme `co.uk`, est refusé par prudence), pas un sous-domaine de `shhdrop.app` : l'isolement des sites des navigateurs (processus séparés) se fait **par site** (domaine enregistrable), pas par origine ; un sous-domaine partagerait aussi les cookies posés sur `shhdrop.app`. Si le propriétaire garde `verif.shhdrop.app` : `Origin-Agent-Cluster: ?1` sur les deux origines, aucun cookie posé sur le domaine parent, et le risque résiduel est écrit dans la spec (§18, A2, question Q1). **Q1 reste ouverte** (§19) : le code est générique sur `SHH_VERIF_ORIGIN` ; la proposition à étudier est une **organisation GitHub gratuite** dédiée (`<nom>.github.io`, suffixe public, donc un site distinct sans achat de domaine).
- En-têtes de la page de vérification : `Content-Security-Policy: default-src 'none'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; style-src 'self' 'unsafe-inline'; img-src https://www.gstatic.com/recaptcha/; connect-src https://www.google.com/recaptcha/; frame-ancestors {origine de l'application}; base-uri 'none'; form-action 'none'` (à ajuster sur la documentation CSP de reCAPTCHA pendant le prototype ; `'unsafe-inline'` en style y est acceptable : la page ne détient aucun secret), `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cache-Control: no-store`. La clé de site (publique) est écrite dans `verif/config.js` au déploiement.

### 15.3 Cadre et messages

- Dans la page de l'application : `<iframe src="{SHH_VERIF_ORIGIN}/?lang=fr" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" allow="" title="Vérification Google reCAPTCHA">`. `allow-same-origin` concerne **l'origine de vérification**, distincte : il ne donne aucun accès à la page de l'application. `allow-popups` laisse s'ouvrir les liens « Confidentialité / Conditions » de Google (la page de l'application a `Cross-Origin-Opener-Policy: same-origin` : aucune fenêtre ouverte ne garde de lien vers elle). Jamais `allow-top-navigation`, `allow-forms`, `allow-modals`.
- Protocole (`v: 1`) : cadre → parent `{ v: 1, type: "ready" }`, `{ v: 1, type: "token", token }`, `{ v: 1, type: "expired" }`, `{ v: 1, type: "error" }` avec `targetOrigin` = origine de l'application (configurée dans `verif/config.js`) ; parent → cadre : rien (la langue passe par l'URL). Le parent n'accepte un message que si `event.origin === fallbackOrigin` **et** `event.source === iframe.contentWindow` ; le jeton doit être une chaîne de 20 à 4 096 caractères `[A-Za-z0-9_-]`. Tout autre message est ignoré.
- Le cadre est créé au clic « Continuer avec Google » (la dépendance `consent` du solveur résout `true` ; `askFallback` n'est pas appelé avant, et `false` annule l'envoi), retiré dès le jeton reçu, l'annulation ou la fermeture de la feuille.

### 15.4 Serveur

- Configuration : `SHH_RECAPTCHA_SECRET` (repli désactivé si vide), `SHH_VERIF_ORIGIN` (origine `https://` exacte, obligatoire si le secret est donné, d'un **autre site** que `SHH_ORIGIN`),  `SHH_ORIGIN` (origine publique du site, obligatoire si le secret est donné ; sert au contrôle « site différent »), `SHH_RECAPTCHA_VERIFY_URL` (tests seulement ; `https://` sauf boucle locale ; défaut `https://www.google.com/recaptcha/api/siteverify`). Erreur de configuration : arrêt du démarrage.
- `GET /api/captcha` ajoute `"fallback": "{SHH_VERIF_ORIGIN}"` quand le repli est activé, sinon `"fallback": null`.
- `POST /api/shares` accepte **soit** `altcha` (inchangé), **soit** `recaptcha` (jeton, ≤ 4 096 caractères) + `captcha_salt` (le sel du défi émis ; la clé `salt` du corps est le sel KDF et ne change pas) ; les deux ou aucun → 400. Contrôles pour `recaptcha` : `shown_at` valide et lié à ce sel, sel au format strict, non expiré, lié à la connexion, **non déjà consommé** (marqué consommé comme un défi résolu), délai de 3 s respecté ; puis appel `siteverify` (`secret`, `response` ; **jamais `remoteip`**), délai 5 s, **hors du verrou** du module anti-robot (le sel est consommé définitivement sous verrou, le verrou est relâché, puis Google est appelé : un `siteverify` lent ne bloque ni les défis ni les autres vérifications ; une panne de Google fait perdre le sel, la personne recommence) ; exige `success: true` et `hostname` = hôte de `SHH_VERIF_ORIGIN`, `challenge_ts` de moins de 2 min. Empreinte SHA-256 du jeton gardée en mémoire 2 min (usage unique, même si Google le revalidait). Échec ou indisponibilité de Google → même réponse que pour une preuve invalide (400 `bad_request`).
- Une création par repli compte dans la même fenêtre d'une heure que les preuves de travail (la difficulté continue de doubler) et dans toutes les limites de la spec §4.
- Le jeton n'est jamais journalisé ni stocké.

---

## 16. Dépendances ajoutées (versions exactes)

| Paquet | Version | Licence | Rôle | Pourquoi |
|---|---|---|---|---|
| `svelte` | 5.57.3 | MIT | Écrans | Choisi par la spec (§6) |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 (dev) | MIT | Build | Compatible Vite 8 |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | PDF isolé | Spec §6 |
| `@lucide/svelte` | 1.68.0 | ISC | Icônes | §6 |
| `uqr` | 0.1.3 | MIT | Matrice du QR code | 27 Ko, sans dépendance, chargé à la demande ; rendu SVG par notre code |
| `@fontsource-variable/mona-sans`, `@fontsource-variable/jetbrains-mono` | 5.3.0 (dev) | OFL-1.1 | Source des polices copiées | §4.1 |
| `@playwright/test` | 1.64.1 (dev) | Apache-2.0 | Parcours e2e | Spec §14 |
| `@axe-core/playwright` | 4.14.0 (dev) | MPL-2.0 | Accessibilité | §11 |
| `typescript` (outil `svelte-check`) | 6.0.3 (dev, paquet séparé) | Apache-2.0 | Vérification des `.svelte` | S5 |
| `svelte-check` | 4.7.8 (dev, paquet séparé) | MIT | Idem | S5 |

Retiré : `altcha` (P3, solveur maison). reCAPTCHA n'est **pas** une dépendance : son script n'est chargé que par la page de vérification, depuis Google, après consentement. Toutes épinglées sans plage, `package-lock.json` commité, `npm audit`, licences dans `THIRD_PARTY_LICENSES.md`.

---

## 17. Hors du Plan 2

- Mentions légales, CGU, Contact (S16) → Plan 3, avant l'ouverture au public.
- Compteur de signalements, alertes → Plan 3.
- Déploiement de l'origine de vérification (Caddy, DNS, clé de site) → Plan 3.
- Démo : simulation des limites par connexion et des quotas, persistance entre onglets : non (§14.3).
- Mise en cache longue des fichiers à empreinte : non (`no-store` partout).
- Partage depuis la galerie, lecture vidéo pendant le téléchargement : non prévus (spec §3). Aplatir un dossier déposé : refusé (§9.2.2).

---

## 18. Analyse critique et corrections

Méthode : revue de conception sur la spécification (pas encore de rendu) selon les heuristiques de la compétence *impeccable* (Nielsen, charge cognitive, parcours émotionnel, personas, *craft floor*), plus une confrontation ligne à ligne avec la spec v2.4, l'API du durcissement (sur `main`), le code serveur existant et CLAUDE.md. Le détecteur automatique (`impeccable detect`) ne s'applique qu'à du balisage : il sera lancé à la Task 28 du plan sur le code réel. Toutes les corrections ci-dessous sont **déjà intégrées** aux sections citées et au plan.

### 18.1 Santé de la conception (Nielsen, avant → après corrections)

| # | Heuristique | Avant | Après | Point clé |
|---|---|---|---|---|
| 1 | Visibilité de l'état | 2 | 4 | Progression en octets, vitesse, temps restant, phases, coupure avec compte à rebours (A3, A4) |
| 2 | Correspondance avec le monde réel | 3 | 3 | Taille envoyée ≠ taille du contenu : expliquée, pas cachée (A18) |
| 3 | Contrôle et liberté | 1 | 4 | Pause, Annuler, Supprimer ce partage, Annuler un retrait, renommer (A5, A7, A10) |
| 4 | Cohérence et standards | 3 | 4 | « Détruire » (destinataire) / « Supprimer » (expéditeur) fixés ; un seul bouton principal par écran |
| 5 | Prévention des erreurs | 2 | 4 | Dépôt hors cible neutralisé, double envoi, sortie du « Lien prêt », jauge avant envoi (A11, A12, A21) |
| 6 | Reconnaître plutôt que se souvenir | 3 | 4 | Catégories, vignettes, ordre identique chez le destinataire |
| 7 | Souplesse et efficacité | 2 | 4 | Glisser-déposer, coller, Alt + flèches, envoi direct sur ordinateur |
| 8 | Esthétique et minimalisme | 3 | 3 | L'écran d'envoi reste dense ; hiérarchie imposée (A28) |
| 9 | Récupération des erreurs | 2 | 4 | Chaque erreur nomme le problème et la suite ; dernier essai de mot de passe explicite (A23) |
| 10 | Aide et documentation | 3 | 3 | Indications en place ; pages Sécurité et Confidentialité |
| | **Total** | **24/40 (Acceptable)** | **37/40 (Excellent, sur le papier)** | À confirmer sur le rendu (Task 28) |

Charge cognitive (après) : 1 point faible sur 8 (« choix minimaux » : l'écran d'envoi porte jusqu'à 3 actions et 3 lignes de mesures ; accepté pour un public expert, avec une hiérarchie stricte). Parcours émotionnel : le pic (fermeture du sceau) n'arrive qu'après `finalize` ; la vallée (coupure réseau) est rassurée par un compte à rebours et un délai de conservation lisibles ; la fin (« Lien prêt ») protège contre la perte par fermeture.

### 18.2 Constats

Gravité : **Critique** (bloque les tâches concernées), **Important** (à corriger avant mise en ligne), **Moyen**, **Mineur**. Entre parenthèses, l'équivalent P0–P3.

| # | Gravité | Endroit | Problème | Correction (intégrée) |
|---|---|---|---|---|
| A1 | **Critique** (P0) | CLAUDE.md « Aucune ressource tierce sur le site » ; spec §22 D4 et §24 (« exclus : reCAPTCHA ») | La décision P3 contredit une règle du projet et deux décisions écrites de la spec. Appliquer P3 sans amendement viole CLAUDE.md | Conception qui garde **la page de l'application** sans aucune ressource tierce (Google seulement dans un cadre d'une autre origine, après consentement). **Réglé le 5 novembre (Q3)** : le propriétaire a validé l'exception ; CLAUDE.md et la spec v2.5 (§26) sont amendés ; les Tasks 15 et 16 ne sont plus bloquées |
| A2 | **Critique** (P0) | §15.2, origine `verif.shhdrop.app` proposée | Un sous-domaine est le **même site** : l'isolement des processus du navigateur se fait par site ; le code de Google pourrait partager le processus de la page qui détient les clés (attaques par canaux auxiliaires), et les cookies de domaine seraient communs | Recommandation d'un domaine enregistrable distinct ; à défaut, `Origin-Agent-Cluster: ?1`, aucun cookie de domaine, risque résiduel écrit. Question Q1. **Reste ouverte (Q1)** : code générique sur `SHH_VERIF_ORIGIN`, refus au démarrage d'une origine du même site ; proposition d'une organisation GitHub gratuite |
| A3 | Important (P1) | §9.4 (rév. 1) : « coupure si aucun `onProgress` depuis 15 s » | Les segments font 4 Mio : à 1 Mbit/s, un segment prend 32 s ; l'écran aurait annoncé une coupure à tort, et vitesse et temps restant n'auraient été mis à jour que tous les 4 Mio | `onBytes` par `XMLHttpRequest.upload.onprogress` (§0.1) ; coupure = 10 s sans **octet** ou `onRetry` ou `offline` |
| A4 | Important (P1) | API : `RETRIES = 5` (0,5 à 8 s) puis `Error("reseau")`, et `createShare` détruit le partage | Une coupure de plus de 15,5 s (tunnel, ascenseur) perd un envoi de 1 Go ; contredit spec §13 « reprise automatique » et rend impossible le compte à rebours demandé | Échéance de coupure de 13 min (`SERVER_STALL_MS`, après le dernier segment acquitté) avec `onRetry`, essai immédiat à `online` (§0.1, §9.4.3) |
| A5 | Important (P1) | Pause (P6) | Une pause illimitée dépasse le délai d'effacement d'un envoi bloqué (15 min, `progress_at` à la minute) et la limite de 3 h | Pause bornée à 10 min et par l'échéance de 13 min, avec reprise automatique visible ; refusée à moins de 15 min de la limite (§9.4.4) |
| A6 | Important (P1) | Envoi de 1 Go sur réseau lent | Jeton d'envoi de 3 h : à moins de 0,8 Mbit/s, 1 Go ne peut pas finir ; l'échec n'arriverait qu'au bout de 3 h | Bandeau dès que le temps restant estimé dépasse le temps disponible (§9.4.1) |
| A7 | Important (P1) | Annuler (P6) : « DELETE /api/shares/{id} avec le jeton d'envoi » proposé | Inutile : `POST destroy` avec `S_gestion` accepte déjà un partage `uploading`, et `createShare` détruit déjà le partage dans son chemin d'échec. Une nouvelle route ajouterait une surface d'attaque et un second moyen d'authentification | `AbortSignal` dans `createShare`, destruction existante envoyée en `keepalive` ; même chemin pour `pagehide` (§0.1, §9.4.5). Aucune route ajoutée |
| A8 | Important (P1) | Borne de la preuve de travail (P3, rév. 1 : délai fixe) contre difficulté adaptative jusqu'à environ 30 s (spec §22) | Une personne qui envoie plusieurs fois dans l'heure, sur téléphone, aurait été renvoyée vers Google alors que la preuve aurait abouti ; et le repli pourrait servir à contourner le doublement de difficulté | **Réglé (Q2, 5 novembre)** : plus de délai fixe ; preuve pré-calculée dès le premier élément composé ; repli seulement si la borne vraie restante dépasse 60 s (mesurée après 5 s) ou après 60 s ; le serveur compte les créations par repli dans la même fenêtre (pas de contournement des quotas ni du doublement) ; l'écran affiche la borne vraie (§9.4.2) |
| A9 | Important (P1) | P4 : « regroupé par catégorie » **et** « réordonnancement, ordre conservé dans le manifeste » | Contradiction : si l'on peut placer une vidéo entre deux photos, l'affichage par catégorie ne montre plus l'ordre réel | Ordre du manifeste = catégories dans un ordre fixe, puis ordre dans chaque catégorie ; réordonnancement à l'intérieur d'une catégorie ; même affichage chez le destinataire (§9.2.4, §9.8) |
| A10 | Important (P1) | Badge « lieu, appareil et date retirés » | Le **nom** du fichier trahit souvent la date et l'heure (IMG_20261104_235901) ou l'identité (CV_Prénom_Nom) : le badge promettait trop | Renommage retenu ; photos de l'appareil renommées « Photo n.jpg » ; badge précisé « date de prise de vue » (§9.2.1, §9.2.4) |
| A11 | Important (P1) | Toutes les routes | Déposer un fichier hors de la cible fait naviguer l'onglet vers le fichier : sur la page de contenu, ouverture consommée et contenu perdu ; pendant l'envoi, envoi abandonné | `preventDefault` de `dragover`/`drop` sur toute l'application (§9.2.2) |
| A12 | Important (P1) | « Lien prêt » | Recharger ou fermer par erreur fait perdre lien et mot de passe d'un partage qui existe et compte dans le quota | `beforeunload` jusqu'à « Terminé » ou « Supprimer » ; « Supprimer ce partage » sur place (§9.5) |
| A13 | Important (P1) | Signalement (rév. 1 : trois motifs) | L'API n'envoie que `"report"` et le serveur ne garde rien : demander un motif est un faux choix | Feuille sans motif, texte honnête, renvoi vers PHAROS pour un contenu illégal (§9.10) |
| A14 | Important (P1) | Libellé « aucun service tiers », page Confidentialité « aucun cookie » | Deviennent faux dans le cas du repli | Libellés réécrits (« calcul sur votre appareil »), section `#verification` explicite (IP vue par Google, cookies sur ses domaines, rien d'autre) (§9.4.2, §9.12) |
| A15 | Important (P1) | §0.1 (rév. 1) | API périmée : ordre des paramètres de `destroyShare`, `openShare(…, onProgress)`, `Opened.destroy`, `keepalive` déjà livrés ; repli « mot de passe gardé en mémoire » devenu inutile | §0.1 réécrit ; repli supprimé (moins de secret retenu en mémoire) ; S1, S12, S17 marqués réglés |
| A16 | Important (P1) | Cadre reCAPTCHA | La grille d'images de v2 dépasse un cadre de 304 × 78 px et serait coupée | Cadre dans une feuille, `min(100 %, 400px)` × `min(600px, 85dvh)` (§9.4.2) |
| A17 | Important (P1) | Téléphone | Le clavier virtuel couvrait le champ et la barre collée du bas ; Safari zoome sur les champs < 16 px | `visualViewport`, `interactive-widget=resizes-content`, barre dans le flux quand le clavier est ouvert, champs ≥ 16 px (§9, §4.2) |
| A18 | Moyen (P2) | Progression en octets | Le paquet chiffré a la taille du palier (34 Mo → 50 Mo) : « 50 Mo » surprend après une jauge à 34 Mo | Une ligne d'aide qui explique le masquage de la taille (§9.4.1) |
| A19 | Moyen (P2) | Arrière-plan sur téléphone | iOS suspend la page : envoi arrêté sans explication | Verrou d'écran pendant l'envoi ; message au retour ; reprise par le budget de coupure (§9.4.3) |
| A20 | Moyen (P2) | Dossiers et fichiers illisibles | Safari présente un dossier comme un fichier ; un fichier en nuage peut être illisible | Lecture d'essai du premier octet ; dossiers refusés avec message (§9.2.2, §9.2.8) |
| A21 | Moyen (P2) | « Chiffrer et envoyer », « Déverrouiller » | Double appui = deux partages (quota) ou deux déverrouillages | Désactivation synchrone et machine à états idempotente (§8, §9.4.6, §9.7) |
| A22 | Moyen (P2) | Ouverture | Compte à rebours à zéro avant déverrouillage : l'essai échouerait après une seconde d'Argon2id | Passage local à « Lien invalide » (§9.7) |
| A23 | Moyen (P2) | 5ᵉ mauvais mot de passe | Le message générique « n'existe pas » déroute quelqu'un qui vient de taper un mot de passe | « Mot de passe incorrect. Le partage a été détruit. » (§9.7) |
| A24 | Moyen (P2) | Contraste forcé (Windows) | Anneau de focus, trait de la capsule et jauge personnalisés disparaissent | Règles `forced-colors` (§3.3) |
| A25 | Moyen (P2) | P1 (toujours sombre) contre spec §3 et §19 (« clair et sombre ») | Écart avec la spec | Appliqué ; `color-scheme: dark` ; à reporter dans la spec v2.5 avec A1 |
| A26 | Moyen (P2) | Vidéo d'iPhone (HEVC) sur Android ou Firefox | Lecteur noir sans explication | Échec de décodage traité comme `none` avec message (§9.8) |
| A27 | Moyen (P2) | Limite de 10 éléments | « Dépassement visible » (P5) appliqué au nombre ferait exister des éléments inenvoyables | Nombre refusé à l'ajout avec la liste des refusés ; taille permise en dépassement pour choisir quoi retirer (§9.2.5) |
| A28 | Moyen (P2) | Écran d'envoi | Jusqu'à 9 informations et 3 actions : surcharge (charge cognitive) | Hiérarchie : pourcentage, puis une ligne (octets · vitesse · temps), puis détail en petit ; Annuler en `ghost`, Pause en `secondary` ; `PhaseList` comme repère (§9.4.1) |
| A29 | Moyen (P2) | Annuler pendant `finalize` | Annulation ambiguë : le partage est peut-être déjà actif | Annuler masqué pendant `finalize` ; « Supprimer ce partage » ensuite (§9.4.5) |
| A30 | Moyen (P2) | « Terminé » et « Supprimer ce partage » voisins | Confusion entre fermer l'écran et détruire le partage | Séparés, styles différents, confirmations différentes (§9.5) |
| A31 | Mineur (P3) | Noms côté expéditeur | Un nom contenant des caractères d'inversion (fichier téléchargé ailleurs) s'affichait tel quel | `cleanName` exporté et appliqué (§0.1, §9.2.8) |
| A32 | Mineur (P3) | Page 404 | La rév. 1 exigeait un code HTTP 404 pour les routes inconnues ; `static.go` rend 200 (spec §10) et rien ne l'exige | Code 200 conservé, page 404 de l'interface, `noindex` sur `/s/` et `/m/` (§9, §14.2) |
| A33 | Mineur (P3) | Jauge vide | « 0 o / 1 Go · 0 / 10 » est du bruit | Texte d'état vide (§9.2.5) |
| A34 | Mineur (P3) | Onglet en arrière-plan sur ordinateur | Aucun repère de progression | « 42 % · Shhdrop » dans le titre pendant l'envoi (§9.4) |
| A35 | Mineur (P3) | Bascule de langue pendant l'envoi | Libellés qui sautent, annonces doublées | Bascule désactivée pendant l'envoi (§10) |
| A36 | Mineur (P3) | Paysage sur téléphone | Capsule plein écran et barres collées qui mangent la hauteur | Règles paysage (§9) |
| A37 | Mineur (P3) | Titre d'accueil après ajout | Le Persuade repousse la liste sous le pli | Titre replié après le premier ajout (§9.1) |
| A38 | Mineur (P3) | Vocal | Enregistrement illimité : mémoire | 30 min au plus (§9.2.7) |
| A39 | Mineur (P3) | Aperçus simultanés | Plusieurs vidéos de 200 Mio téléchargées en même temps : mémoire | Un aperçu à la fois (§9.8) |
| A40 | Mineur (P3) | Collage d'un texte HTML | Mise en forme, liens ou contenu caché copiés depuis une page web | `text/plain` seulement (§9.2.3) |
| A41 | Important (P1) | Démo (P8) | Du code de démo (faux serveur qui remplace `fetch`) dans le build de production serait une porte dérobée : toute requête `/api` pourrait être détournée | Import dynamique sous `import.meta.env.MODE === "demo"`, greffon qui fait échouer le build de production, script `check-dist.mjs` en CI (§14.3) |
| A42 | Moyen (P2) | Démo : lien copié puis ouvert ailleurs | Le partage n'existe que dans la mémoire de l'onglet : un lien ouvert dans un autre onglet est « invalide » sans explication ; Pages n'a pas de repli monopage | Bandeau permanent, bouton « Ouvrir comme destinataire (démo) » sans rechargement, phrase d'explication sur « Lien invalide », `404.html` (§14.3) |
| A43 | Moyen (P2) | Démo : CSP par meta | `frame-ancestors`, `Permissions-Policy`, COOP, HSTS propre et `no-store` manquent ; l'origine `skoow.github.io` est partagée entre tous les dépôts Pages du propriétaire | Liste écrite des écarts (§14.3, page Sécurité de la démo) ; la démo ne traite aucune donnée réelle ; ne jamais servir la production depuis cette origine |
| A44 | Mineur (P3) | Démo : faux serveur infidèle | Une démo qui se comporte autrement que le serveur réel tromperait sur l'interface | Tests du faux serveur avec le vrai client et les cas d'erreur de la spec §13 (§14.3) |

Bilan : **2 critiques, 16 importants, 15 moyens, 11 mineurs** (44 constats).

### 18.3 Ce qui reste juste dans la révision 1

- Le monde « Nuit chiffrée » est propre au produit (sceller, dissoudre) et n'emprunte aucun gabarit de catégorie ; la règle « verre seulement sous ce qui défile » tient.
- Les règles de sécurité de l'interface (`safeName`, `previewKind`, `TYPE_SUR`, `{@html}` interdit, CSP, bfcache, navigateur intégré) n'avaient pas de faille : elles sont conservées.

### 18.4 Pré-vol du plan (5 novembre)

Un contrôle de cohérence du plan contre le dépôt (`.superpowers/sdd/2026-11-04-shhdrop-ecrans/preflight.md`) a relevé 43 points (P1–P43), tous adoptés le 5 novembre ; ils sont appliqués au plan. Effets sur cette spécification : défi et preuve pré-calculés, `captcha_salt`, `maxNumber`, borne de 60 s, consentement et ordre des essais (§0.1, §9.4.2, §9.4.6, §15) ; échéance unique de 13 min pour la pause et la coupure (§0.1, §9.4.3, §9.4.4) ; `frame-ancestors 'self'` sur `/pdf-frame.html` et `isEvalSupported: false` (§13, §14.2) ; `start_url` et `scope` à `"./"` (§14.1) ; règle « site différent » et `SHH_ORIGIN` (§15.2, §15.4).

---

## 19. Questions ouvertes pour le propriétaire

| # | Question | Choix par défaut appliqué |
|---|---|---|
| Q1 | Origine de vérification : domaine distinct (par exemple `shhverif.net`), organisation GitHub gratuite dédiée (`<nom>.github.io`, suffixe public, donc un site à part) ou `verif.shhdrop.app` (même site, risque résiduel écrit) ? | **Ouverte.** Code générique sur `SHH_VERIF_ORIGIN`, avec refus au démarrage d'une origine du même site que `SHH_ORIGIN` (§15.4) ; tests sur une origine distincte. Proposition à valider : une **organisation GitHub gratuite** dédiée ; le choix réel se fait à la migration (coût si faux : une valeur de configuration) |
| Q2 | Quand renvoyer vers Google : après un délai fixe, ou seulement si la borne vraie restante est trop longue (avec pré-calcul), pour ne pas y envoyer les personnes qui créent plusieurs partages dans l'heure ? | **Décidée (5 novembre).** Preuve de travail pré-calculée dès le premier élément composé (page visible seulement, au plus deux renouvellements du défi) ; repli Google seulement si le Worker est absent ou en erreur, si le serveur refuse, ou si la borne vraie restante dépasse 60 s (mesurée après 5 s) ou 60 s écoulées. Plus de délai fixe (§9.4.2, §18 A8) |
| Q3 | Amender CLAUDE.md (« aucune ressource tierce sur le site ») et la spec pour écrire l'exception reCAPTCHA isolée ? | **Décidée (5 novembre).** Le propriétaire a validé l'exception : spec v2.5 §26 et CLAUDE.md amendés ; les Tasks 15 et 16 ne sont plus bloquées (§18 A1) |
