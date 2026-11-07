# Scan de sécurité et de confidentialité de Shhdrop (main, 7536564), 2026-11-07

Scan en lecture seule. Code audité : `e1de8c6` ; HEAD est passé à `7536564` pendant le scan, mais ce commit ne touche que la documentation (`docs/superpowers/audits/2026-11-07-scan-ux-design.md`). Builds, serveur réel et tests ont tourné sur un instantané `git archive` dans `scratchpad/scan-secu/head/`, jamais dans le dépôt.

Skills appliquées : `sharp-edges`, `insecure-defaults`, `constant-time-analysis`, `golang-backend`, `supply-chain-risk-auditor`, `privacy-review`, `security-review`. La commande de diff de `security-review` a échoué, faute de `origin/HEAD`, comme le 5 novembre : sa méthode a été appliquée à la main sur le diff `d01baf9..e1de8c6`.

Références lues : CLAUDE.md, spécification v2.7 (§2, §4, §7 à §12, §18, §25 à §38), audits du 4 et du 5 novembre, registre `progress.md`.

Périmètre (ce qui a changé depuis les audits) : crypto v2 (K1), lien court et recherche par vérificateur (K2), envoi et « Lien prêt » (Tasks 17 et 18), composeur v3/v3.1, logo statique, démo GitHub Pages. L'écran d'ouverture du destinataire n'existe pas encore (Task 20) : seule la partie bibliothèque (`openShare`) est auditée de ce côté.

**Bilan : 0 critique, 0 élevé, 1 moyen, 5 faibles.** Aucun constat ne permet au serveur, à l'hébergeur ou à un observateur de lire un contenu, un nom, une clé ou un mot de passe. Le constat le plus grave touche les mots de passe saisis par la personne (le mot de passe généré par défaut n'est pas concerné).

## Couverture

| Domaine | Fait | Résultat |
|---|---|---|
| Crypto v2 (`crypto/envelope.ts`, `container.ts`, `kdf.ts`, `password.ts`, `passphrase.ts`) | lecture complète, comparaison avec §29.2, §29.3, §31 | conforme ; M1 sur la règle des mots de passe saisis |
| Client de transfert (`transfer/client.ts`, `api.ts`, `link.ts`, `prepare.ts`) | lecture complète | conforme ; F2 (base de la démo) |
| Serveur K2 (`api/handlers_share.go`, `handlers_manage.go`, `share/service.go`, `store/store.go`, `token`, `limits`, `admin.go`) | lecture complète, serveur de HEAD lancé, sondes `curl` | conforme |
| Envoi, « Lien prêt », PoW (`flows/send.svelte.ts`, `routes/SendFlow.svelte`, `Ready.svelte`, `captcha/*`, `qr/qr.ts`, `ui/clipboard.ts`) | lecture, build de production inspecté | F1 |
| Composeur (`flows/compose.svelte.ts`, `sniff.ts`, `kinds.ts`, `intake.ts`, `transfer/safety.ts`, `ui/itemView.ts`) | lecture | F4 |
| Logo statique (`public/logo.svg`, `favicon.svg`) | lecture | rien d'actif (aucun script, `foreignObject` ni lien externe) |
| Démo (`demo/*`, `app/demo-hooks.ts`, `pages.yml`) | `vite build --mode demo` puis `check-dist --demo` ; recherche du code de démo dans le build de production | F2, F5 |
| Confidentialité dans un vrai navigateur | Chromium (Playwright), build de production servi par le serveur Go de HEAD, contexte neuf | aucune requête tierce, aucun stockage, `#` et requête retirés |
| Test « le serveur ne voit rien » | `vitest run e2e/sees-nothing.test.ts` sur l'instantané | 7/7 |
| Temps constant | lecture TS et Go ; `go tool objdump` (go1.27.3, amd64, build par défaut) sur `share`, `token`, `captcha` | 0 instruction `DIV`/`IDIV` ; comparaisons sûres |
| Dépendances | `npm audit --package-lock-only --omit=dev`, registre npm, `govulncheck` v1.9.0, `go mod verify` | 0 avis ; F3 |
| Secrets et identités Git | `git log d01baf9..HEAD -p` (22 commits) | rien ; auteur = adresse anonyme, committer = `noreply@anthropic.com` |

Non évaluable ici : `gh repo view` (GraphQL refusé dans cette session) ; la règle de protection de l'environnement `github-pages` (réglage du dépôt, invisible depuis le code) ; Caddyfile, `deploy.sh` et image Docker, qui n'existent pas encore (Plan 3).

---

## Critique

Aucun.

## Élevé

Aucun.

---

## Moyen

### M1. Un mot de passe saisi de 10 caractères passe la règle même s'il tombe au premier essai (`aaaaaaaaaa`, `azertyuiop`, `motdepasse`)

- **Endroit** : `web/src/crypto/passphrase.ts:41-47` (`checkPassword`) ; `web/src/crypto/blocklist.ts` (généré par `web/scripts/gen-lists.mjs`) ; spec §31 (« 10 caractères au moins et absent de la liste noire ») et §27.2 (le code du coffre suit la même règle).
- **Problème** : la seule défense en plus de la longueur est une liste noire exacte. Cette liste vient de SecLists `10k-most-common.txt` (anglais) : **sur 10 001 entrées, seules 51 font 10 caractères ou plus**. Au seuil de 10 caractères, elle ne bloque donc presque rien. Les suites, les répétitions, les rangées de clavier AZERTY et les mots français courants passent tous. Or le modèle de menaces (§2) compte sur le mot de passe contre deux adversaires :
  - le détenteur du lien seul (sauvegarde de messagerie volée), qui a 5 essais en ligne : `azertyuiop` ou `motdepasse` font partie des premiers qu'il tentera sur un public français ;
  - le voleur du lien et de la base, qui essaie hors ligne : ces mots de passe sont dans tout dictionnaire de cassage, et Argon2id n'y change rien.

  Le mot de passe généré par défaut (2^59) n'est pas concerné. Le risque ne vise que la personne qui choisit « Choisir le mien ». La règle actuelle lui donne pourtant une fausse assurance, puisque l'interface valide son choix.
- **Preuve** : le code accepte tout mot de passe d'au moins 10 points de code absent de `BLOCKLIST` (`passphrase.ts:44-46`). Comptage de la liste : `total 10001, len>=10 51` (les 51 sont des mots comme `1234567890`, `qwertyuiop`, `basketball`). Recherche exacte dans la liste : `aaaaaaaaaa`, `0000000000`, `1111111111`, `azertyuiop`, `motdepasse`, `abcdefghij`, `azerty1234` et `password12` sont absents, donc acceptés. `1234567890` et `qwertyuiop` sont présents, donc refusés. Le commentaire de `checkPassword` (`passphrase.ts:37-39`) parle encore de 8 et 12 caractères : il est périmé.
- **Correction** (sans dépendance nouvelle) :
  1. Règles locales dans `checkPassword` : refuser un mot de passe qui a moins de 5 caractères distincts, ou dont plus de la moitié est une répétition (`aaaa`, `abab`), une suite (`abcd`, `6789`) ou une rangée de clavier (AZERTY, QWERTY, QWERTZ).
  2. Liste noire régénérée par `gen-lists.mjs` : une source plus grande (par exemple SecLists `100k-most-used-passwords-NCSC` ou `xato-net-10-million-passwords-1000000`), **filtrée aux entrées de 10 caractères ou plus**, et une liste française. La licence de chaque source est à vérifier avant de l'adopter. Taille à mesurer, contre le budget JS de la Task P.
  3. Comparer en minuscules et sans accents (`NFD`, puis retrait des marques), pour que `MotDePasse1` et `motdépasse` soient reconnus.
  4. Tests : les mots ci-dessus refusés ; un mot de passe généré toujours accepté ; même règle pour le code du coffre.
  5. Spec §31 : remplacer « absent de la liste noire » par la règle complète. C'est un choix validé qui change : à faire valider par le propriétaire.

---

## Faible

### F1. Le QR est chargé par `import()` dynamique en production, hors SRI et sans contrôle de `check-dist`

- **Endroit** : `web/src/routes/Ready.svelte:203` et `:259` (`{#await import("../ui/QrCode.svelte")}`), `web/src/ui/QrCode.svelte:3` (« Chargé par import() dynamique ») ; `web/scripts/check-dist.mjs` (aucune règle sur `import(`) ; spec §28.3 et lentille C6 de §28.8.
- **Problème** : la spec §28.3 fixe la règle « **aucun `import()` dynamique dans le build de production** (le QR est importé statiquement ; contrôle par `check-dist.mjs`) ». La raison : SRI ne couvre pas les morceaux chargés par `import()`. Le code fait l'inverse, et le contrôle annoncé n'existe pas. Aujourd'hui l'impact est nul, car SRI n'est pas encore en place (voir « zéro confiance »). Le jour où il le sera, le morceau du QR, qui reçoit `K_lien`, sera le seul code de la page à échapper à l'empreinte de `index.html`. Effet de bord : la requête du morceau dit au serveur, en direct, que l'expéditeur vient d'afficher le QR.
- **Preuve** : build de production de HEAD → `dist/assets/QrCode-DnN-k1bq.js` (10,78 Ko, 4,15 Ko gz) ; `grep -o 'import([^)]*)' dist/assets/index-*.js` → ``import(`./QrCode-DnN-k1bq.js`)`` (2 fois) ; `node scripts/check-dist.mjs` → « conforme ».
- **Correction** : import statique de `QrCode.svelte` dans `Ready.svelte` (environ 4 Ko gz de plus dans le JS principal). Ajouter à `check-dist.mjs` (build de production, pas la démo) un refus de tout `import(` dans `dist/assets/*.js`, avec test. Corriger le commentaire de `QrCode.svelte`.

### F2. Dans la démo, « Supprimer ce partage » échoue toujours et affiche une erreur réseau

- **Endroit** : `web/src/routes/Ready.svelte:129` (`destroyShare(result.manage, location.origin)`) ; `web/src/transfer/client.ts:131-135` (`parseFor` appelle `parseLink(link)` avec la base « / » par défaut) ; `web/src/transfer/link.ts:99`.
- **Problème** : `createShare` rend des liens qui portent la base (`https://skoow.github.io/Shhdrop/#m…`, `client.ts:420-421`). `destroyShare`, `fetchMeta`, `openShare` et `shareStatus` n'acceptent au contraire que la racine. Dans la démo, `parseLink` rejette donc le lien de gestion : le chemin `/Shhdrop/` n'est pas `/`. Il lève `lien_invalide`, que `Ready.svelte:131` traduit en « erreur réseau ». La démo fait croire que la suppression a échoué pour une raison de réseau. C'est une erreur d'exactitude, et c'est aussi un piège d'API : deux fonctions du même module n'ont pas la même idée d'un lien valide. La production n'est pas touchée (base « / »). Aucun test e2e ne supprime dans la démo : `ready.spec.ts:93` tourne sur le serveur réel.
- **Preuve** : lecture des trois endroits. `new URL("https://skoow.github.io/Shhdrop/#m…").pathname` vaut `/Shhdrop/`, qui n'est ni `/` ni `//`, donc `invalid()` en `link.ts:99`.
- **Correction** : un paramètre `base` (par défaut « / ») pour `parseFor` et les quatre fonctions, passé par `Ready.svelte` (`import.meta.env.BASE_URL`). On peut aussi normaliser le lien à la racine, comme `app/link.ts:readLink`. Ajouter un test e2e « Supprimer » sur la démo.

### F3. Nouvelle dépendance de production `uqr`, sans attestation de provenance, sur la page qui manipule `K_lien`

- **Endroit** : `web/package.json` (`"uqr": "0.1.3"`), `web/src/qr/qr.ts`.
- **Mesures** (registre npm, 7 novembre) : 0.1.3 publiée le 2026-04-03, après 0.1.2 du 2023-08-16 (deux ans et demi sans version) ; 2 mainteneurs publieurs (`pi0`, `antfu`) ; signature du registre présente ; **`dist.attestations` absent** (aucune provenance SLSA) ; aucune dépendance ; aucun script d'installation ; entrée du verrou avec `integrity` sha512 ; adoptée le 2026-11-07, après le délai de carence de 7 jours ; `npm audit` : 0 avis ; licence MIT notée dans `THIRD_PARTY_LICENSES.md:29`.
- **Problème** : le code tourne sur la page qui détient les clés et reçoit le lien en clair. Une version piégée publiée depuis un des deux comptes passerait la carence de 7 jours si personne ne relit son diff. Le risque est faible : aucune dépendance, publication rare, 2 mainteneurs connus. Mais la fonction est simple et le code tient en quelques centaines de lignes.
- **Correction** : recopier `uqr` dans `web/src/qr/vendor/` (MIT, mention gardée) et retirer la dépendance, ce qui retire un compte de la chaîne. À défaut, `npm diff --diff=uqr@0.1.3 --diff=uqr@<nouvelle>` obligatoire à chaque mise à jour, noté dans §28.

### F4. La liste des extensions dangereuses oublie des types de fichiers parmi les plus utilisés par les maliciels actuels

- **Endroit** : `web/src/transfer/safety.ts:291` (`RISKY`), qu'utilisent le composeur (`flows/compose.svelte.ts:228`) et `Opened.isRiskyFile` ; spec §12 (liste fermée).
- **Problème** : la liste a `.iso` mais pas `.img`, `.vhd` et `.vhdx`. Ce sont aussi des images disque qui contournent la marque « provenant d'Internet » (Mark-of-the-Web) de Windows, et qui servent pour la même raison. Manquent aussi : `.one` (OneNote), `.chm`, `.mht`/`.mhtml`, `.xhtml`, `.svg` (ouvert localement dans un navigateur, son script s'exécute), `.jse`, `.vbe`, `.wsh`, `.msp`, `.scf`, `.appref-ms`, `.application`, `.xll`, `.docm`/`.xlsm`/`.pptm` (macros), `.ps1xml`/`.psm1`, `.inf`. Le destinataire n'a donc aucun avertissement pour ces fichiers. L'expéditeur non plus : la reconnaissance par contenu (`sniff.ts`) ne connaît que `MZ`, ELF, Mach-O et ISO.
- **Preuve** : `isRiskyName("facture.img")`, `("x.one")` et `("x.vhdx")` rendent `false` : l'extension n'est pas dans `RISKY`.
- **Correction** : ajouter ces extensions à `RISKY` et à §12, avec un test par extension. Les choix de §12 sont validés : le changement est signalé ici, au propriétaire de trancher.

### F5. `workflow_dispatch` publie la démo sans CI verte

- **Endroit** : `.github/workflows/pages.yml:11-12` et `:21` (`if: github.event_name == 'workflow_dispatch' || …`).
- **Problème** : le commentaire du workflow et CLAUDE.md posent la règle « jamais de publication sans CI verte ». Un lancement manuel publie pourtant `github.sha` de la branche choisie sans aucun test. Le registre montre que c'est devenu l'usage (« démo republiée à la main », Task 8 et d958cb0). La démo ne détient aucun secret réel, d'où la gravité faible. Mais c'est du code public, servi sous le nom du projet, qui fait tourner la vraie crypto.
- **Correction** : pour `workflow_dispatch`, exiger que le dernier passage `ci` du même SHA soit `success` avant le build (`gh api repos/{owner}/{repo}/commits/$SHA/check-runs` avec `permissions: checks: read`, en refusant au moindre doute). Ou bien relancer les tests dans le job. Limiter aussi l'environnement `github-pages` à la branche `main` (réglage du dépôt, à vérifier par le propriétaire).

---

## Déjà connus, toujours ouverts (rappel sans nouvelle preuve)

- **SVG en aperçu** (audit du 5 nov., F2) : `transfer/safety.ts:265`, `"image/svg+xml": "image"` est toujours là. À corriger **avant** la Task 21 (visionneuses), qui le rendra exploitable.
- **Signalements non comptés** (5 nov., F1 ; §36 S21) et **motif libre** de 64 caractères accepté par `POST /api/shares/destroy` (`handlers_share.go:354-363` ; §36 S14) : Task M2.
- **`X-Shh-Client-IP`** dépend d'un Caddyfile qui n'existe pas (5 nov., F3) : Plan 3.
- **`@lucide/svelte`** (5 nov., M2, point 3) : toujours en production, mainteneur publieur unique, une version par jour (1.68.0, 1.69.0, 1.70.0 du 4 au 6 nov.). Seul le délai de carence de 7 jours a été appliqué.
- **`pagehide` pendant l'envoi** (S4 du registre) : si la page se ferme pendant qu'un segment se chiffre (`await sealed.segment(n)`, `client.ts:386`, qu'on ne peut pas interrompre), la destruction en `keepalive` peut ne jamais partir. Le serveur efface l'envoi en 5 à 20 minutes, et `R` disparaît avec la page (effacement cryptographique).
- `actions/checkout` sans `persist-credentials: false`, cache npm dans `pages.yml`, Node `"22"` non épinglé : Task 8 (m3 à m5) et §28.1.

---

## Ce qui manque encore pour le zéro confiance (par priorité)

1. **Code vérifiable (§28), le point qui commande tous les autres.** Le chiffrement de bout en bout ne vaut que ce que vaut le JavaScript servi, et rien de §28 n'est encore en place. Sur le build de HEAD :
   - pas de `.node-version` ; aucun job `repro` ; pas de `release.json` signé par cosign ;
   - aucun attribut `integrity` dans `dist/index.html` ;
   - ni `verify-site.mjs` ni page `/verifier`.

   Ordre proposé : (a) Node épinglé et build reproductible prouvé en CI ; (b) SRI, après avoir retiré l'`import()` du QR (F1) ; (c) manifeste signé et vérificateur en ligne de commande ; (d) surveillance horaire de la production. Sans (a), aucune empreinte publiée n'a de sens.
2. **Minimisation du serveur, Task M2 (§36).** Ce qui reste écrit en base ou déductible :
   - `progress_at` à la minute, `upload_deadline` et `purge_at` en base (S5, S12) ;
   - `ttl_hours` gardé après `finalize`, donc heure de création à 15 minutes près (S11, `service.go:413-416`) ;
   - `fill_from` qui donne la taille à 4 Mio près même en envoi au clic (S4) ;
   - motif libre (S14), compteur de signalements absent (S21) ;
   - pas encore de test Go de la liste blanche des en-têtes lus (S2) ni de nettoyage des envois `uploading` et `draining` au démarrage.

   Côté client, à prévoir avant la Task 20 : lecture monotone (S9) et pré-lecture à calendrier fixe (S10).
3. **TLS post-quantique et pile du Plan 3.** Le Caddyfile est à écrire. Il doit contenir :
   - `curves x25519mlkem768 x25519` et le test bloquant `CurveID == X25519MLKEM768` (§30) ;
   - le remplacement de `X-Shh-Client-IP` (F3 du 5 nov.) et le retrait des en-têtes du navigateur (S2) ;
   - les journaux vers `discard`, le pilote Docker `none`, swap et vidages mémoire coupés (S1).

   Q-PQ1 (refuser les connexions sans échange hybride) reste à trancher avant toute ouverture au public.
4. **Mots de passe saisis** (M1) : la seule protection du contenu contre qui a le lien, quand la personne n'utilise pas le mot de passe généré.
5. **Service worker d'épinglage (§28.6, Q-C1 acceptée), avec le plan d'incident** (`sw.js` qui se désinscrit, `Clear-Site-Data: "cache"`). C'est le seul moyen pour un client déjà installé de remarquer un changement de code.
6. **Surface de code sur la page des clés.** Recopier `uqr` (F3) et les icônes de Lucide (M2 du 5 nov.). Relire le diff de libsodium à chaque version (pas de provenance). Activer `require-trusted-types-for 'script'` si Svelte et libsodium le permettent (§10, jamais testé). Mettre `frame-src 'none'` tant que le cadre PDF n'existe pas, et `worker-src 'self'` explicite.
7. **Défense hors navigateur.** Application native qui embarque l'interface (§16, la défense la plus forte contre un serveur piégé). Suivi de la norme WAICT. Revue de la crypto v2 par un tiers avant l'ouverture au public. Migration de Sigstore vers une signature post-quantique dès qu'elle existera (§28.2).
8. **Adresse IP** : la masquer au serveur n'est possible qu'avec un service onion (§3 « plus tard ») ; à prévoir si le public visé l'exige.

---

## Vérifié, sans problème

**Crypto v2 (K1)**
- WebCrypto (HKDF-SHA-256, HMAC-SHA-256, SHA-256, AES-256-GCM) et libsodium (Argon2id13) seulement. Étiquettes `shhdrop/v2/…` conformes à §29.2. Préfixe des données authentifiées de `E` (`enveloppe-ad`) distinct de l'info HKDF de `K_env`.
- `R`, `K_lien`, `S_gestion` et le sel sont tirés par `crypto.getRandomValues`. `R` est mise à zéro juste après l'enveloppe (`client.ts:339`). À l'ouverture, `R` est effacée après le contrôle de l'engagement (`client.ts:585`). `K_contenu` et `K_env` sont non extractibles.
- `E` : nonce aléatoire de 12 octets. Les données authentifiées (`id` ‖ en-tête) empêchent d'échanger `E` ou le paquet entre deux partages. Toute erreur donne une seule `paquet_corrompu`. L'engagement est vérifié par `crypto.subtle.verify`.
- Paquet SHH2 : en-tête vérifié sur 16 octets puis 48. Nonces STREAM avec drapeau « dernier ». Manifeste lu dans le dernier morceau, borné (`MANIFEST_MAX`, 10 éléments, positions dans les données). Palier canonique recalculé. Droits absents ou mal formés → `voir`. Garde `usedKeys` et chaque segment produit une seule fois.
- Mot de passe généré : 10 caractères tirés sur `b & 63` (64 symboles, sans biais), les 4 familles exigées ; `isGeneratedPassword` ne garde que les 16 derniers.
- Argon2id borné des deux côtés (3 à 10 passes, 64 à 256 Mio), imposé à `KDF_CREATE` à la création ; mot de passe vide refusé avant toute requête.

**Lien court et serveur (K2)**
- Lien `#<43>` et `#m<43>` : décodage strict (longueur, alphabet, bits de bourrage). Origine attendue imposée, identifiants dans l'URL refusés. `id` du client jamais envoyé (test « ne voit rien »).
- Toute route qui désigne un partage prouve un secret : jeton signé, `K_accès` ou `S_gestion`. Recherche par SHA-256 du secret, sur index unique. `K_preuve` comparée par `subtle.ConstantTimeCompare`. Vérificateur égal à SHA-256("") refusé. `id` interne de 128 bits tiré par `crypto/rand`.
- Création sur un vérificateur déjà pris : même 400 qu'une requête invalide, comptée au quota ; seul qui a le secret peut la provoquer.
- Routes de gestion : corps vide exigé (`MaxBytesReader(0)`), en-tête présent une seule fois.
- Sondes sur le serveur réel : `meta`, `manage/status` et `destroy` avec des secrets faux répondent toutes `404 {"error":"not_found"}`.
- `admin destroy -` : lien lu sur l'entrée standard, seule `K_accès` gardée et effacée après usage, rien n'est affiché.
- Essais de mot de passe : pas d'avantage à les envoyer en parallèle. Chaque échec est compté par une requête SQL conditionnelle, et un essai juste exige `failed_attempts < 5` au moment de l'`UPDATE`.
- Jetons : HMAC vérifié par `hmac.Equal` avant toute lecture, alphabet contrôlé, type, longueur et expiration vérifiés.
- `govulncheck` : aucune vulnérabilité ; `go mod verify` : tous les modules vérifiés ; 0 `DIV`/`IDIV` dans `share`, `token` et `captcha`.

**Envoi, « Lien prêt », PoW**
- Clés neuves à chaque essai, y compris après un échec de l'anti-robot. Un partage créé puis abandonné est détruit en `keepalive`. Les secrets ne vivent que dans `result` et sont oubliés à Terminé ou Supprimer.
- Aucun secret dans la console, le titre (`Sealing.svelte` n'y met que le pourcentage), l'URL ou un stockage. « Partager » n'envoie que le lien, jamais le mot de passe. Le QR n'est montré qu'à la demande, avec l'avertissement « Le QR contient la clé ».
- Presse-papiers : écriture seulement, jamais de lecture. « Vider » n'agit que si la page y a copié quelque chose, et le texte dit honnêtement ce qu'il ne fait pas (historique du clavier, presse-papiers partagé). La dictée est locale (aucune synthèse vocale).
- PoW dans un Worker de notre origine : défi validé (`maxNumber` ≤ 10 000 000, sel ≤ 200 caractères), SHA-256 de WebCrypto, arrêt sur annulation et à `pagehide`.
- Page restaurée du cache « page précédente » : rechargée (`App.svelte:24`).

**Composeur**
- Lecture d'essai bornée à 32 774 octets. Exécutables (MZ, ELF, Mach-O) et ISO marqués « à risque » même sous une fausse extension (`mismatch`).
- Vignettes limitées à JPEG, PNG, WebP, GIF et AVIF, jamais SVG ni fichier à risque. URL `blob:` révoquées au chargement.
- Collage en `text/plain` seulement, jamais `text/html`. Dossiers refusés. Noms passés par `safeName` avant le manifeste.
- Aucun `{@html}`, `innerHTML`, `eval`, `Function`, stockage navigateur, service worker, cookie, `Math.random` ni `console.*` dans `src/` hors tests.

**Logo et site**
- `logo.svg` et `favicon.svg` : chemins seulement, aucun script ni ressource externe.
- En-têtes du serveur réel (`curl -I /`) : CSP de §10, HSTS, `nosniff`, `no-referrer`, Permissions-Policy, COOP, CORP, `no-store`.
- Bundle de production : aucune URL tierce chargée (seulement des liens `svelte.dev/e/…` dans des messages d'erreur, le dépôt et `shhdrop.app`). Aucun code de démo (`__SHH_DEMO__` et `createFakeServer` absents). `check-dist` conforme.
- Navigateur réel (Chromium, contexte neuf, `/?fbclid=x#<43>`) : 19 requêtes, **0 vers une autre origine**, URL finale `/` (fragment et requête retirés), `localStorage`, `sessionStorage`, IndexedDB, service workers et cookies vides, console vide.

**Démo**
- `check-dist --demo` conforme : CSP en `meta`, `connect-src 'none'`, `no-referrer`, `noindex`. Faux serveur limité aux URL `/api/*` de l'origine. Coffre désactivé. `openAsRecipient` n'accepte qu'un lien de l'onglet, et le `#` est retiré aussitôt.

**Dépendances et dépôt**
- `npm audit --omit=dev` : 0 avis sur 24 paquets de production.
- Délai de carence de 7 jours en place pour npm, gomod et github-actions.
- Aucun secret ni fichier sensible dans les 22 commits depuis l'audit. Binaire `server/shhdrop` et `dist*` ignorés par Git.

## Reproductions et fichiers de travail

Hors dépôt, dans `/tmp/claude-0/-home-user/b97dc3e7-f107-54ba-8c5b-d4198f88d7ff/scratchpad/scan-secu/` :
- `head/` : instantané de `e1de8c6` (builds de production et de démo, `e2e/sees-nothing.test.ts` 7/7) ;
- `shhdrop`, `data/` : serveur de HEAD lancé sur `127.0.0.1:18931` pour les sondes `curl` (arrêté après le scan) ;
- `scripts/privacy.mjs` : contrôle de confidentialité dans Chromium (`node scripts/privacy.mjs`, serveur lancé) ;
- `ct.bin` : binaire désassemblé pour le contrôle de temps constant.
