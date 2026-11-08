# Audit de sécurité de la chaîne de chiffrement — 8 novembre 2026

Audit **en lecture seule** de `/home/user/shhdrop` (HEAD `7ff9df1`, avec le fichier `web/src/transfer/draft.ts` en cours d'écriture par un autre agent). Aucun fichier du dépôt n'a été modifié.

Demande du propriétaire : vérifier si le chiffrement est optimal en local, en transit et au stockage, et relever toute faiblesse, erreur, bogue ou idée plus sûre, sur toutes les options de l'app.

Méthode : lecture ciblée du code et de la spécification (§29, §31, §36, §41.4, §41.14), avec les grilles `sharp-edges`, `constant-time-analysis`, `insecure-defaults`, `privacy-review` et `golang-backend`. Les constats des audits du 4, du 5 et du 7 novembre ne sont pas répétés. Ceux qui sont encore ouverts sont rappelés en fin de rapport.

**Limite de cet audit** : aucun test n'a été lancé, aucun navigateur ni serveur n'a été démarré, et `go tool objdump` n'a pas été relancé. Chaque constat dit s'il est **vérifié dans le code** (V) ou **supposé** (S), c'est-à-dire fondé sur le comportement connu des navigateurs et à prouver par un test.

Rien de ce qui suit ne permet de dire que l'application est « 100 % sécurisée ».

---

## Tableau des constats (triés par gravité)

| # | Gravité | V/S | Endroit | Problème | Scénario d'attaque concret | Correction proposée |
|---|---|---|---|---|---|---|
| H1 | **Haute** (disponibilité) | V | `server/internal/api/handlers_share.go:116` (`BeginUpload(ip, req.ID, 0)`), `:450-468` (`grow`) ; `server/internal/share/draft.go:27-75` | Avec l'envoi dès l'ajout (§41.14), rien n'est réservé au quota à la création. `Grow` réserve ensuite le disque (`Resize` → `fallocate`) jusqu'au plus grand palier (2 Gio) **sans débit au quota par connexion ni par /48**. Seul le plafond global `StorageMax` est contrôlé. La réservation H-3 de la spec (« par paliers ») ne protège donc que contre un grossissement d'un coup, pas contre l'abus. | Un attaquant crée 2 brouillons par adresse IPv4 (6 par /48), avec une preuve de travail par création. Il appelle `grow` jusqu'à 32 769 morceaux, puis `keep` toutes les 4 min. Il obtient 4 Gio de disque réservé par adresse pendant 6 h, sans envoyer un seul segment. Avec quelques dizaines d'adresses ou de /48, `StorageMax` est atteint et toute création répond `ErrFull` pour tout le monde. | Débiter la réservation au quota à chaque `grow`, par exemple `lim.Reserve(id, ContentBytes(new) − ContentBytes(old))`, refusé avec 429 au-delà des octets du jour. La rendre à `AbandonUpload` et la porter au palier final à `finalize`. Ajouter un plafond de **réservation en cours** par connexion (par exemple 2 Gio, tous brouillons confondus). Ajouter un test Go : grow sans segment, au-delà du quota → 429. |
| M1 | Moyenne (disponibilité, amplification) | V | `draft.go:131-160` (`finalizeDraft` remplit d'aléa **tous** les segments manquants) ; `limits.go:246-259` (`Settle` « sans refus ») ; `handlers_share.go:262` | Un brouillon peut être finalisé au plus grand palier sans avoir envoyé une seule donnée. Le serveur écrit alors 2 Gio de `crypto/rand` sur le disque contre environ 65 Kio reçus (en-tête et manifeste). `Settle` débite après coup sans jamais refuser, et `BeginUpload` (avec 0 octet) laisse passer tant que le compteur n'a pas **dépassé** 6 Gio. | Par adresse et par jour : create → grow → finalize, recommencé environ 4 à 5 fois, soit 8 à 10 Gio écrits par le serveur, gardés jusqu'à 24 h, pour une bande passante montante presque nulle. Combiné à H1, cela sature le disque et use le SSD. | Avant le remplissage, vérifier le quota avec **refus** (`Charge(id, ContentBytes(b))` → 429 sans rien écrire). Borner l'aléa écrit par le serveur : par exemple, refuser si les octets reçus sont inférieurs à la moitié des données utiles du palier final, puisque le bourrage légitime est au plus d'environ la moitié d'un palier, plus les trous des éléments retirés. Ajouter un test : finalize à 32 769 morceaux sans segment → 429. |
| M2 | Moyenne (confidentialité au repos, promesse inexacte) | S (comportement documenté de Chromium et Firefox) ; V pour le contenu stocké | `web/src/session/open-grant.ts:1-6, 26-31` ; spec §41.4 « propre à l'onglet et disparaît à sa fermeture » | `sessionStorage["shh.og"]` contient `K_lien` en clair et l'octroi. Les navigateurs **écrivent `sessionStorage` sur le disque** pour la restauration de session : Chrome dans le dossier « Session Storage » du profil, Firefox dans `sessionstore.jsonlz4`. Ils le **restaurent** aussi après « Rouvrir l'onglet fermé » ou après une panne. L'entrée ne disparaît donc pas à la fermeture et dépasse la page. | Sur un ordinateur partagé, le destinataire ferme l'onglet. La personne suivante fait Ctrl+Maj+T dans les 30 min : l'écran « reopen » apparaît avec le lien déjà connu. Le mot de passe reste exigé, et le contrôle `last` (`receive.svelte.ts:164`) borne la fenêtre à 30 min. Autre cas : un examen légal du profil retrouve `K_lien` sur le disque. L'impact cryptographique est faible (il faut encore le mot de passe de 2^65 et `E`), mais c'est une clé écrite sur disque, contraire à « aucun stockage ». | (1) Dire honnêtement, sur la page Sécurité et dans §41.4, que l'entrée peut être écrite sur le disque par la restauration de session. (2) Réduire la fenêtre de `last` pour la reprise après fermeture : par exemple, poser `last` à chaque `pagehide` et refuser la reprise si plus de 2 min se sont écoulées depuis. Un rechargement prend moins de 2 min, une réouverture plus tardive non. (3) Ajouter un test Playwright avec un contexte persistant : fermer l'onglet, rouvrir, et lire le profil pour constater le comportement réel. |
| M3 | Moyenne (confidentialité, promesse à vérifier) | S | `web/src/app/link.ts:37-45` (`scrubAddressBar` → `history.replaceState`) ; spec §5.3 (« pour qu'elle ne reste pas dans l'historique synchronisé ») | `replaceState` remplace l'entrée de l'**historique de session** de l'onglet. Il n'est pas établi qu'il retire l'URL `/#K_lien` déjà écrite dans l'**historique global** du navigateur (base History de Chrome, `places.sqlite` de Firefox) au moment de la navigation, ni qu'elle échappe à la synchronisation (Chrome Sync, Firefox Sync). | Le destinataire clique le lien. L'URL avec `#K_lien` est enregistrée dans l'historique, synchronisé vers un compte Google ou Mozilla. Quiconque lit cet historique (appareil volé, compte compromis, autre membre du foyer) a le lien. Le mot de passe protège encore le contenu, mais §5.3 promet plus que ce qui est prouvé. | Le prouver par un test Playwright en contexte persistant : visiter `/#<repère>`, puis lire la base `History` et `places.sqlite` pour y chercher le repère. Si le repère y est, corriger §5.3 et la page Sécurité (« le lien peut rester dans l'historique du navigateur ; le mot de passe reste nécessaire »). Une parade partielle existe : le lien et le mot de passe vont toujours par deux canaux (déjà le cas). |
| M4 | Moyenne (exactitude, promesse « retiré du serveur ») | V (fichier en cours d'écriture) | `web/src/transfer/draft.ts:307` (`api.erase(...).catch(() => undefined)`) ; `draft.go:85-87` (`claimFinalize` → `ErrBusy`) | L'échec d'`erase` est avalé en silence, puis la place est rendue (`holds.delete`) et réutilisée. Or `Erase`, `Grow` et `Finalize` s'excluent par `claimFinalize`. Deux retraits rapides, ou un retrait pendant un `grow`, donnent donc un 503 `busy` probable, et le segment n'est pas effacé. La confidentialité tient (`k_i` est mise à zéro : effacement cryptographique), mais la promesse « la croix supprime l'élément du serveur instantanément » ne l'est pas, et l'interface affiche pourtant l'effacement. | L'utilisateur retire deux fichiers coup sur coup. Le second `erase` répond 503 et le chiffré reste sur le disque jusqu'à `finalize` ou l'abandon. Un disque saisi entre-temps contient ce chiffré, indéchiffrable mais présent. | Réessayer `erase` comme les autres étapes (`withBudget` avec reprise sur 503 et sur coupure). Ne rendre la place qu'après un succès. Sur un échec définitif, l'afficher (« effacement en attente ») et réessayer avant `finalize`. Côté serveur, on peut aussi faire attendre `Erase` et `Grow` sur un verrou plutôt que répondre `busy`. |
| F1 | Faible | V | `server/internal/share/service.go:653-697` (`UnlockGrant`) et `grant.go:112-160` (`reopen`) | La limite de 5 essais n'est pas atomique : la comparaison de `K_preuve` a lieu **avant** l'incrément de `failed_attempts`. N requêtes `unlock` parallèles, avec N `K_preuve` différentes, sont toutes comparées. Le succès éventuel passe tant que l'`UPDATE` de succès arrive avant le 5ᵉ échec. | Seules les limites de débit (60 requêtes par minute, créneaux) bornent N. Contre un mot de passe généré de 2^65 avec un Argon2id par essai, c'est sans effet pratique. Mais la règle « 5 essais puis destruction » (§29.7) est fausse en concurrence. | Réserver l'essai **avant** de comparer : `UPDATE … SET failed_attempts=failed_attempts+1 WHERE id=? AND failed_attempts<5 RETURNING …`, puis rembourser en cas de succès (`failed_attempts-1`). Ou bien un verrou en mémoire par `id` autour de la comparaison. Ajouter un test Go : 20 unlock parallèles faux → exactement 5 comptés et destruction. |
| F2 | Faible | V | `web/src/ui/clipboard.ts:21-29`, `web/src/routes/Ready.svelte:106` | (a) `clearClipboard` écrit `""` même si la personne a copié autre chose entre-temps : on efface ses données. (b) Les historiques de presse-papiers (Win+V, Gboard, Samsung, presse-papiers universel d'Apple) gardent le mot de passe et le lien copiés, et le Web ne peut pas les marquer « sensibles ». | Sur Android, Gboard garde le mot de passe copié pendant une heure, et le lien aussi s'il a été copié. Quiconque prend le téléphone déverrouillé les retrouve. | (a) Ne vider que juste après une copie récente, par exemple moins de 60 s, sans lire le presse-papiers. (b) Le dire à l'écran : « votre clavier peut garder une copie : préférez Partager ». Préférer le partage natif (déjà offert, lien et mot de passe séparés). |
| F3 | Faible | V | `server/internal/api/headers.go:17` | `Permissions-Policy` ne refuse explicitement que `geolocation`. Les fonctions puissantes non utilisées gardent leur valeur par défaut (`self`) : `display-capture`, `clipboard-read`, `usb`, `serial`, `hid`, `bluetooth`, `payment`, `screen-wake-lock`, `browsing-topics`, entre autres. `camera` et `microphone` sont `self` sur **toutes** les routes, y compris celle du destinataire qui détient `K_lien`. | En cas de script injecté (XSS, dépendance piégée) sur la page des clés : capture d'écran ou lecture du presse-papiers après une seule invite. | Ajouter `display-capture=(), clipboard-read=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), browsing-topics=(), interest-cohort=()`. Garder `screen-wake-lock=(self)` si `wakelock.ts` en a besoin. La séparation par route est impossible avec une application monopage : la garder en idée (voir I3). |
| F4 | Faible | V | `web/src/crypto/kdf.ts:7` (`KDF_MAX = { ops: 10, mem: 268435456 }`) | Le navigateur accepte du serveur jusqu'à 256 Mio et 10 passes pour l'ouverture. Aucun partage n'est créé ainsi (`KDF_CREATE` vaut 64 Mio et 3 passes). | Un serveur compromis, ou une ligne de base modifiée, fait planter l'onglet sur un téléphone de 2 Go (déni de service local). Aucune fuite. | Ramener `KDF_MAX` à ce qui a été créé, soit `{ops: 3, mem: 64 Mio}`, tant qu'aucun autre réglage n'existe. |
| F5 | Faible | V | `web/src/demo/persist.ts:1-20` | La démo garde dans IndexedDB, pendant 27 h, les empreintes, le sel, `E`, les segments chiffrés et les octrois. Son origine, `skoow.github.io`, est **partagée par tous les sites GitHub Pages du compte**. | Un autre projet Pages du même compte, ou une dépendance piégée d'un autre projet, lit ce stockage. Avec le lien (historique, M3), il peut attaquer hors ligne, mais un mot de passe de 2^65 sous Argon2id rend l'attaque irréaliste. | Le dire sur la bannière de la démo (« ne mettez rien de réel »). Ou publier la démo sur une origine à elle (sous-domaine dédié). |
| F6 | Faible (documentation) | V | `web/src/crypto/password.ts` (11 caractères, 63 symboles, 2^65,23) contre spec §31 (dernière mise à jour : 10 caractères, 68 symboles, 2^60,15) | Le commit `7ff9df1` a changé la règle validée sans que §31 soit mis à jour. La spec, qui fait référence, dit le contraire du code. `isGeneratedPassword` exige désormais 11 caractères à la création. | Aucune attaque : risque d'erreur au prochain changement, ou d'une page Sécurité qui annonce le mauvais chiffre. | Ajouter à §31 une « Mise à jour (8 novembre) » : alphabet de 63 symboles, 11 caractères, nombre exact et preuve (`password.test.ts`). |
| F7 | Faible | V | `web/src/media/strip-capture.ts:14-25` | Un format inattendu rend le Blob **inchangé** (`stripped: false`). L'audit n'a pas vérifié si l'interface le signale. Pour Safari (MP4 avec `udta` différent) ou une future version de Chromium, la date de création et le nom du navigateur pourraient partir tels quels. | La date de création d'un vocal ou d'une vidéo révèle l'heure de l'enregistrement au destinataire. | Vérifier que l'interface affiche « métadonnées non nettoyées » quand `stripped` est faux, et ajouter des fixtures Safari et Firefox aux tests. |
| I1 | Idée (important pour §41.14, en cours) | V | `web/src/transfer/draft.ts` | Points à garder pendant l'implémentation, vérifiés comme corrects aujourd'hui : un segment n'est chiffré qu'une fois (`produced`, `elements.ts:85-86`) et le même `data` est renvoyé à chaque essai ; `k_i` est neuve à chaque `elementSealer` ; `k_i` est mise à zéro au retrait (`draft.ts:305`) ; destruction en `keepalive` à l'abandon. À ajouter : (1) M4 ; (2) un test qui retire un élément et vérifie que sa `k` n'apparaît pas dans le manifeste déchiffré ; (3) un test qui vérifie que `prepare()` (nettoyage, Task 9) passe **avant** `segmentsFor` et `place` (c'est le cas à la ligne 255), pour qu'aucun original avec EXIF ne parte. | — | — |
| I2 | Idée | — | CSP (`headers.go:10-12`) | Trusted Types : `require-trusted-types-for 'script'; trusted-types svelte` (Svelte 5 crée ses gabarits par `innerHTML` : une politique nommée suffit). Les sinks DOM sont alors fermés à tout script injecté. À tester d'abord avec l'en-tête `Content-Security-Policy-Report-Only` dans un test Playwright, qui lit les violations sur la console. | — | — |
| I3 | Idée | — | En-têtes | `Cross-Origin-Embedder-Policy: require-corp`, avec la COOP `same-origin` déjà en place, donne `crossOriginIsolated` : un processus isolé, ce qui protège mieux contre les lectures de type Spectre de la mémoire qui contient `K_lien` et `R`. Attention au cadre PDF (CORP `cross-origin` déjà posée sur ses fichiers). | — | — |
| I4 | Idée | — | Crypto | Engagement : il est déjà correct pour `R` (HMAC vérifié par `crypto.subtle.verify`), donc pour le manifeste et les `k_i` qu'il contient. Si l'on veut supprimer toute hypothèse sur AES-GCM non engageant pour `E`, on peut ajouter `HMAC(K_env_mac, E)`, mais ce n'est pas nécessaire aujourd'hui : l'en-tête, qui engage `R`, est dans les données authentifiées de `E`. Post-quantique : le contenu est symétrique (256 bits) et suffit ; seul le TLS hybride reste à faire (Plan 3, déjà noté). | — | — |
| I5 | Idée | — | Option « voir seulement » | C'est un réglage d'interface, impossible à imposer : le clair est dans le navigateur du destinataire, qui peut faire une capture d'écran ou lire la mémoire. Vérifier que l'écran et la page Sécurité le disent. | — | — |

---

## Vérifié dans le code, sans problème

**Crypto (`web/src/crypto/`)**
- `envelope.ts` est conforme à §29.2 :
  - les étiquettes HKDF sont distinctes : `contenu`, `engagement`, `id`, `maitre`, `enveloppe`, `preuve`, et `enveloppe-ad` distinct de l'info de `K_env` ;
  - `K_maître` = HKDF(`K_lien` ‖ `K_mdp`), deux entrées de longueur fixe ;
  - les clés AES ne sont pas extractibles ;
  - `ikm`, `K_maître` et `K_env` bruts sont mis à zéro ;
  - `E` reçoit un nonce aléatoire de 12 octets à chaque appel, et ses données authentifiées valent « enveloppe-ad » ‖ `id` ‖ en-tête ;
  - erreur unique `paquet_corrompu` (pas d'oracle) ;
  - engagement vérifié par `crypto.subtle.verify`.
- HKDF avec sel vide : acceptable, l'entrée est uniforme (32 octets aléatoires).
- `kdf.ts` : Argon2id de libsodium, 64 Mio, 3 passes, 1 fil, NFC ; minimum imposé au navigateur ; sortie copiée puis mise à zéro. `passwordKeyForCreate` refuse tout mot de passe non généré.
- `password.ts` : rejet sous 252 = 4 × 63 (pas de biais), quatre familles, `crypto.getRandomValues`, tampon remis à zéro.
- `elements.ts` (§41.14) :
  - une clé par élément, HKDF(`k_i`, « element ») ;
  - nonce = indice absolu du morceau (11 octets) ‖ drapeau ; segment produit une seule fois ;
  - morceau du manifeste avec drapeau « dernier », sous `K_contenu`, AD = en-tête ;
  - `usedKeys` empêche de chiffrer deux manifestes sous la même `K_contenu`.
- Lecture (`container.ts:354-470`) :
  - en-tête comparé sans sortie anticipée ;
  - palier canonique recalculé (un serveur ne peut pas en annoncer un autre) ;
  - taille de chaque segment contrôlée ;
  - entrée `k` de 43 caractères ;
  - déplacer un segment, ou l'échanger avec un autre élément ou un autre partage, fait échouer le déchiffrement (nonce de position, clé par élément).

**Temps constant**
- Go :
  - `match` compare SHA-256 par `subtle.ConstantTimeCompare` ;
  - jetons et octrois sont vérifiés par `hmac.Equal` ;
  - `got != id` compare un identifiant interne signé, qui n'est pas secret ;
  - la recherche par `V_accès` porte sur une empreinte que l'attaquant calcule lui-même (§29.8).
- TypeScript : les comparaisons d'en-tête sont faites par accumulation XOR, sur des données publiques. Je n'ai pas trouvé de `===` sur un secret dans les fichiers lus.

**Serveur**
- `token.go` : alphabet filtré avant décodage, type, longueur et expiration contrôlés, clé tirée au démarrage.
- `grant.go` : étiquette propre (`shhdrop-open-grant-v1`), clé distincte (`grantKey`), MAC sur `id` ‖ n ‖ exp, `n` borné ; octroi invalide → 409 sans essai ; mot de passe faux avec octroi → un essai.
- `blob.go` : `0o700` et `0o600` ; `O_EXCL` à la création ; `O_NOATIME` en lecture ; dates remises à l'epoch ; `Erase` fait un trou (PUNCH_HOLE) ou écrit des zéros, puis `fsync` ; finalisation qui remplit d'aléa **tous** les segments manquants (trous compris) puis met le masque « tous reçus ». Aucune frontière d'élément ne reste en base après `finalize`.
- `store.go` : `secure_delete(ON)`, WAL replié et tronqué par le concierge, `temp_store(MEMORY)`.
- `api.go`, `api.ts` : `credentials: "omit"`, `redirect: "error"`, aucun en-tête CORS, en-têtes propres (`X-Shh-*`) qui imposent un pré-vol entre origines. Aucun `console.*` dans `web/src` hors tests.

**En transit**
- CSP stricte (`script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`) ;
- `Referrer-Policy: no-referrer`, HSTS avec `preload`, COOP et CORP `same-origin` ;
- `Cache-Control: no-store` partout ;
- lien avec le secret dans le `#`, retiré de la barre d'adresse ;
- QR et partage natif : le lien seul, jamais avec le mot de passe (`Ready.svelte:91, 102`).

---

## Supposé, à prouver

- M2 et M3 dépendent du comportement des navigateurs (restauration de session, base d'historique) : à mesurer avec Playwright en contexte persistant, sur Chromium et Firefox.
- H1 et M1 sont établis par la lecture du code ; leur mesure (disque réservé ou écrit pour un client qui n'envoie rien) reste à faire par un test Go.

---

## Déjà connus, toujours ouverts (rappel, sans nouvelle preuve)

- Code vérifiable (§28) : ni SRI, ni build reproductible, ni manifeste signé, ni service worker d'épinglage. C'est toujours la priorité n° 1 du zéro confiance.
- `frame-src 'self'` au lieu de `'none'` tant que le cadre PDF n'existe pas ; `worker-src` implicite.
- TLS hybride X25519MLKEM768 et Caddyfile (Plan 3), avec le remplacement de `X-Shh-Client-IP`.
- `ctime` et date de naissance des fichiers (spec §18.6), connus et assumés.
- Pendant la composition, le serveur voit l'heure, l'ordre et les tailles à 4 Mio près, et la taille d'un élément retiré (§41.14, limite acceptée).
