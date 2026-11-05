# Audit de sécurité de Shhdrop (main, d01baf9), 2026-11-05

Audit en lecture seule de tout le dépôt au commit `d01baf98540e2f88bcbdfb63ce72851951049101` (HEAD). Le dossier de travail contenait des modifications en cours d'autres agents (`web/src/crypto/*`, `web/src/transfer/*`, `web/src/flows/`…) : elles ne sont **pas** auditées. L'audit porte sur un instantané de HEAD (`git archive`) dans le dossier de travail de l'audit.

Skills appliquées : `sharp-edges`, `insecure-defaults`, `constant-time-analysis`, `golang-backend`, `supply-chain-risk-auditor`, `security-review` (sa commande de diff a échoué faute de `origin/HEAD` : sa méthode a été appliquée à la main sur tout le code de HEAD).

Référence : spécification v2.6 (§2, §7 à §10, §18, §25 à §34), registre des points connus ou reportés (`.superpowers/sdd/2026-11-04-shhdrop-ecrans/progress.md`), audit du 4 novembre (`2026-11-04-sharp-edges.md`, `2026-11-04-correctifs.md`).

**Bilan : 0 critique, 1 élevé, 2 moyens, 3 faibles.** Aucun constat ne touche la confidentialité du contenu, des noms, des clés ou des mots de passe. Les trois constats les plus graves portent sur la disponibilité et la chaîne d'approvisionnement.

## Couverture

| Domaine | Fait | Résultat |
|---|---|---|
| Crypto client (`crypto/kdf.ts`, `container.ts`, `passphrase.ts`, `encoding.ts`) | lecture complète, comparaison avec §7 | conforme (v1 à HEAD ; la v2 de §29 n'est pas encore dans HEAD) |
| Jetons (`internal/token`) | lecture, désassemblage | conforme |
| Gestionnaires d'API (`internal/api`, `internal/share`) | lecture complète, 2 reproductions | E1, M1 |
| Limites (`internal/limits`, `internal/captcha`) | lecture, reproduction | M1 (aggravation par /64) |
| CSP et en-têtes | lecture, serveur réel de HEAD lancé, `curl -I` | conforme à §10 |
| Site statique (`cmd/shhdrop/static.go`) | serveur réel, chemins hostiles | conforme |
| Démo | build `--mode demo`, `check-dist --demo`, lecture de `src/demo/` | conforme |
| Hygiène des liens (`app/link.ts`, `App.svelte`, `transfer/link.ts`) | lecture | conforme |
| Workflows GitHub | lecture, empreintes des actions résolues par `git ls-remote` | conforme, sauf points déjà connus |
| Dépendances npm | `npm audit --package-lock-only` (119 paquets + outil svelte-check), lockfile, registre | S1 ; 2 avis « low » en dev |
| Dépendances Go | `govulncheck` v1.9.0 (go1.27.3), `go mod verify`, `go list -m all` | aucune vulnérabilité, modules vérifiés |
| Secrets dans le dépôt | `git log --all -p` (82 commits) sur motifs de clés, fichiers sensibles, adresses e-mail | rien |
| Temps constant | lecture du source Go et TS, `go tool objdump` (amd64, build par défaut) sur `share`, `token`, `captcha` | aucune division, comparaisons sûres |

Non évaluable ici : `gh api` refusé (jeton de session invalide pour l'API) ; lecture publique des exécutions CI et `git ls-remote` utilisés à la place. Caddyfile, `deploy.sh` et image Docker n'existent pas encore (Plan 3) : non audités.

---

## Critique

Aucun.

---

## Élevé

### E1. Un seul client peut épuiser la mémoire du serveur avec des téléchargements de segments qu'il ne lit pas

- **Endroit** : `server/internal/blob/blob.go:172` (`buf := make([]byte, n)`), `server/internal/share/service.go:404`, `server/internal/api/handlers_share.go:259-267` ; `server/cmd/shhdrop/main.go:155-166` (aucune borne de connexions, `WriteTimeout` de 300 s) ; `server/internal/limits/limits.go:354-364` (600 segments par minute et par /64).
- **Problème** : chaque `GET /segments/{n}` charge le segment entier en mémoire (jusqu'à 48 + 64 × 65 552 = 4 195 376 octets), puis l'écrit. Si le client ne lit pas, `w.Write` bloque et le tampon reste vivant jusqu'au `WriteTimeout` (300 s). Rien ne borne le nombre de requêtes simultanées : seule la limite de débit (600 par minute et par /64) s'applique. Un attaquant crée son propre partage (une preuve de travail au niveau 0), le déverrouille, puis ouvre des connexions lentes. Caddy ne protège pas : il relaie en flux et se bloque lui aussi quand le client ne lit pas.
- **Preuve** (reproduction, `scratchpad/audit-secu/server/internal/api/audit_mem_test.go`, serveur `net/http` réglé comme en production) : 200 GET non lus d'un segment de palier 80 → **+805 Mio** de tas en usage (environ 4 Mio par connexion). Pour une seule adresse IPv4 : 600 par minute × 5 min de `WriteTimeout` = 3 000 connexions, soit environ **12 Gio**. Un /48 IPv6 (offert gratuitement par des fournisseurs de tunnels) multiplie la limite par 65 536 /64. Conséquence : arrêt du processus par manque de mémoire, redémarrage du conteneur, perte du secret des jetons (§7.7) : tous les envois et téléchargements en cours échouent.
- **Correction** :
  1. Servir le segment en flux depuis le fichier, sans tampon complet : `io.Copy(w, io.NewSectionReader(f, off, n))` avec `Content-Length` (même chose pour `PUT` : écrire au fil de la lecture dans la zone réservée, avec un tampon fixe de 64 Kio, au lieu de `io.ReadAll`).
  2. Borner la concurrence : un sémaphore global sur les requêtes de segments (par exemple 64) et une limite de requêtes simultanées par /64 et par /48 (par exemple 8 et 32), avec 429 au-delà.
  3. Échéance d'écriture par requête avec `http.ResponseController.SetWriteDeadline` (un segment de 4 Mio à 14 Ko/s tient en 300 s, mais les routes JSON n'ont besoin que de quelques secondes ; même chose pour `SetReadDeadline` sur les corps de 4 Kio).
  4. Test : N connexions lentes ne font pas croître le tas au-delà d'une borne fixe.

---

## Moyen

### M1. Un jeton de téléchargement relit le partage sans limite de volume pendant 3 h ; la limite de débit ne compte que le /64

- **Endroit** : `server/internal/share/service.go:389-409` (`ReadSegment` ne compte rien), `server/internal/api/api.go:104-109` et `server/internal/limits/limits.go:340-364` (clé = /64 seulement).
- **Problème** : tant que `done` n'est pas appelé, une ouverture relit n'importe quel segment autant de fois qu'elle veut, jusqu'à l'expiration du jeton (3 h). La seule borne est 600 segments par minute et par /64. La spec §15.1 rappelle que le trafic sortant est payant et limité ; §29.6 prévoit déjà un budget (2 × le palier) pour la pré-lecture, mais rien pour les ouvertures. La limite de débit générale (60 par minute) et celle des segments ne regardent que le /64, alors que §11 dit « par connexion, par /64 et par /48 ».
- **Preuve** (reproduction, `scratchpad/audit-secu/server/internal/api/audit_repro_test.go`) : un seul jeton, 3 minutes, 4 /64 d'un même /48 → **7 200 lectures acceptées** du même segment, soit **28,1 Gio** au palier de 1 Gio. Au rythme d'un seul /64 : 2,4 Gio par minute, environ 144 Gio par heure, à partir d'un partage créé par l'attaquant lui-même (10 par jour autorisés).
- **Correction** : budget d'octets par ouverture, en mémoire (comme §29.6) : au plus 2 × la taille du palier par `(id, openN)`, puis 429 ; ajouter une clé /48 aux limites de débit (par exemple 10 × la limite du /64) ; consigner la règle dans §4 et §24, et l'ajouter aux tests de `limits`.

### M2. Les dépendances de production sont adoptées dès leur publication, sans délai de carence ni revue

- **Endroit** : `.github/dependabot.yml` (aucune option `cooldown`) ; règle de spec §24 (« toujours la dernière version stable ») ; `web/package.json` (`@lucide/svelte`, `libsodium-wrappers-sumo`, `svelte`).
- **Problème** : le code de production tourne sur la page qui détient les clés. Un paquet piégé publié aujourd'hui et adopté demain vole les clés de tous les visiteurs (§2, attaquant du code du site). La plupart des publications malveillantes sur npm sont repérées et retirées en quelques jours : les adopter en moins de 24 h supprime cette marge.
- **Preuve** (mesures, registre npm, 2026-11-05) :
  - `@lucide/svelte` : un seul mainteneur publieur (`ericfennis`), une version par jour (1.66.0 le 31 oct., 1.67.0 le 3 nov., 1.68.0 le 4 nov. à 06:13 UTC, 1.69.0 le 5 nov.). La 1.68.0 est entrée dans le dépôt le 5 nov. à 06:51 UTC (commit 70a3b53), **24 h 38 après sa publication**. Elle est dans le bundle de production (`src/ui/Icon.ts`, 57 imports).
  - `libsodium-wrappers-sumo` et `libsodium-sumo` 0.8.4 (Argon2id du mot de passe) : un seul mainteneur publieur (`jedisct1`), signature du registre présente, **aucune attestation de provenance** (`dist.attestations` absent).
  - `svelte` 5.57.3 : 3 mainteneurs, provenance SLSA présente.
  - Installation : 119 paquets dans le lockfile, tous depuis `registry.npmjs.org` avec `integrity` ; un seul script d'installation (`fsevents`, dépendance facultative macOS), et la CI installe avec `--ignore-scripts`.
- **Correction** :
  1. Dependabot : `cooldown: { default-days: 7 }` pour npm, gomod et github-actions (et `semver-major-days: 14`).
  2. Corriger §24 : « dernière version stable publiée depuis au moins 7 jours, sauf correctif de sécurité » (choix validé modifié : signalé ici, à faire valider par le propriétaire).
  3. Retirer `@lucide/svelte` : copier les ~40 SVG utilisés dans le dépôt (licence ISC à reproduire), ce qui supprime une dépendance de production à mainteneur unique et à publication quotidienne.
  4. Pour `libsodium`, relire le diff (`npm diff --diff=libsodium-wrappers-sumo@0.8.4 --diff=<nouvelle>`) à chaque mise à jour, et noter dans §28 que ce paquet n'a pas de provenance.

---

## Faible

### F1. Le signalement n'est compté nulle part : l'alerte « signalements qui s'accumulent » ne peut pas fonctionner

- **Endroit** : `server/internal/api/handlers_share.go:288` (`Reason string // motif de signalement : non conservé`) ; aucun compteur dans `server/` (`grep -ri report` ne trouve que ce champ).
- **Problème** : la spec §7.6 dit « le motif compté en mémoire (compteur agrégé, pour les alertes) » et §15.2 prévoit un e-mail « si les signalements s'accumulent ». Le serveur lit le motif et le jette. Un service utilisé pour diffuser des malwares ne déclenche donc aucune alerte, alors que §11 cite le risque de blocage du domaine entier par Safe Browsing.
- **Preuve** : citation ci-dessus ; `Destroy` (`service.go:432`) ne reçoit pas le motif.
- **Correction** : compteur atomique en mémoire (`reports_total`, sans identifiant, sans IP, remis à zéro chaque jour), exposé seulement sur `/healthz` en boucle locale, ou écrit en ligne fixe sans donnée (« signalements : N ») pour le script horaire de §15.2 ; refuser un `reason` autre que `"report"` ; test.

### F2. SVG sur la liste blanche des aperçus : une image déchiffrée peut s'exécuter sur l'origine de Shhdrop si elle est ouverte dans un onglet

- **Endroit** : `web/src/transfer/safety.ts:69` (`"image/svg+xml": "image"`, commentaire « dans `<img>` uniquement : aucun script ne s'y exécute »).
- **Problème** : c'est vrai dans `<img>`, mais un aperçu se fait par une URL `blob:` de l'origine du site. « Ouvrir l'image dans un nouvel onglet » (clic droit, appui long) charge ce `blob:` comme document SVG, avec l'origine `https://shhdrop.app`. La seule protection restante est l'héritage de la CSP par les documents `blob:`, inégal selon les navigateurs et les versions. Avec le coffre (§27) et l'historique (§33), un script sur l'origine pourrait utiliser les clés non extractibles gardées dans IndexedDB. Aucun écran d'aperçu n'existe encore à HEAD : le constat est préventif.
- **Preuve** : citation ; le SVG vient de l'expéditeur, donc d'une source hostile (spec §12).
- **Correction** : retirer `image/svg+xml` de `PREVIEW` (téléchargement seulement, en `application/octet-stream`), ou le rasteriser dans le cadre PDF isolé (sandbox sans `allow-same-origin`). Test : `previewKindOf({mime: "image/svg+xml"})` → `"none"`.

### F3. La confiance dans `X-Shh-Client-IP` repose entièrement sur un Caddyfile qui n'existe pas encore

- **Endroit** : `server/internal/api/clientip.go:43-47` ; Caddyfile absent du dépôt (Plan 3).
- **Problème** : le serveur croit l'en-tête dès que le pair est la boucle locale ou un proxy de confiance. Caddy transmet par défaut les en-têtes du client : s'il ne **remplace** pas `X-Shh-Client-IP`, n'importe quel client choisit son adresse, ce qui annule les quotas, les limites de débit et la difficulté anti-robot. Le code se défend contre deux valeurs (`len(h) == 1`), pas contre une seule valeur venue du client.
- **Preuve** : citation ; §8 suppose « l'en-tête posé par Caddy » sans exiger de test côté Caddy.
- **Correction** : au Plan 3, `reverse_proxy { header_up X-Shh-Client-IP {client_ip} }` (remplacement, jamais `+`), `trusted_proxies` vide ; test d'intégration bloquant : une requête qui envoie `X-Shh-Client-IP: 1.2.3.4` à Caddy arrive au serveur avec l'adresse réelle du client.

---

## Déjà connus, non re-signalés (aucune preuve nouvelle)

- `actions/checkout` sans `persist-credentials: false` (Task 8, m3) : toujours vrai dans `ci.yml` et `pages.yml` ; jeton en lecture seule, impact limité.
- Cache npm dans `pages.yml` (m4) et `cancel-in-progress` sur le déploiement Pages (m5).
- Navigateurs Playwright téléchargés en CI (Task 1, M6).
- XHR qui suit les redirections (Task 0, m1).
- Node `"22"` non épinglé et absence de build reproductible : prévus par §28.1 (tâches R/V), pas encore réalisés.
- `@sveltejs/vite-plugin-svelte` → `deepmerge` (GHSA-gcqx-w48m-w2h4, « low ») : outil de build, aucune entrée d'attaquant ; aucun correctif publié.

---

## Vérifié, sans problème

**Crypto (HEAD = format v1)**
- WebCrypto (HKDF-SHA-256, SHA-256, HMAC, AES-256-GCM) et libsodium (Argon2id13) seulement ; étiquettes `shhdrop/v1/…` conformes à §7.1.
- Paramètres Argon2id bornés des deux côtés (`checkKdfParams` : minimum 3 passes et 64 Mio, maximum 10 et 256 Mio, entiers) ; création forcée à `KDF_CREATE` ; mot de passe NFC ; mot de passe vide refusé.
- Nonces STREAM (indice sur 11 octets + drapeau « dernier »), en-tête en données authentifiées, garde `usedKeys` contre la réutilisation d'une clé, refus de rechiffrer un segment issu d'un `File`.
- Ouverture : en-tête et engagement vérifiés avant tout déchiffrement, taille exacte de chaque segment, palier canonique recalculé depuis le manifeste authentifié, manifeste borné (64 Kio, 10 éléments, types vérifiés), une seule erreur `paquet_corrompu`.
- Tampons sensibles mis à zéro (`kMdp`, `ikm`, `kMaitre`, `kContenuBrut`, morceaux clairs).
- Tirages : `crypto.getRandomValues` (client), `crypto/rand` (serveur) ; tirage uniforme par rejet pour la phrase de passe.

**Jetons et temps constant**
- Jeton = HMAC-SHA-256 sur type ‖ longueur ‖ id ‖ n° d'ouverture ‖ expiration ; clé de 32 octets tirée à chaque démarrage ; alphabet et longueur vérifiés avant décodage ; `hmac.Equal` ; type, id et expiration revérifiés.
- Vérificateurs comparés par `subtle.ConstantTimeCompare` sur SHA-256 de longueur fixe ; `Destroy` fait les trois comparaisons sans court-circuit ; vérificateur égal à SHA-256("") refusé.
- `go tool objdump` (go1.27.3, amd64, build par défaut) sur `share`, `token`, `captcha` : **0** instruction `DIV`/`IDIV`. Recherches de motifs : aucune comparaison `==` ou `bytes.Equal` sur un secret, aucun `math/rand`, aucun `Math.random`. Encodage base64url par table indexée sur le secret (client et serveur) : faux positif (aucune mesure de temps possible à distance à cette échelle).

**API et logique**
- JSON strict (clés exactes, sans doublon ni casse différente, champs inconnus refusés, 4 Kio) ; secrets en en-tête ou corps, jamais dans l'URL ; longueurs exactes.
- Erreurs uniformes (`not_found`) pour inexistant, expiré, détruit, mauvaise clé d'accès ; 5ᵉ mot de passe faux → destruction et 404 ; panique → 500 sans détail.
- Chaque vérification suivie d'une action est une requête SQL conditionnelle ; masque de segments en comparaison-échange ; `Finalize` et le nettoyage sous `uploadMu`.
- `done` idempotent (`done_mask`), n° d'ouverture pris dans le jeton seulement ; jeton de téléchargement plafonné à `expires_at`.
- Requêtes SQL paramétrées partout ; `sweepCond` n'insère que des constantes du code.

**Limites et anti-robot**
- Quotas journaliers par /64 et /48 en mémoire, clés HMAC du secret du jour ; aucune IP écrite sur disque ; `ErrorLog` de `net/http` jeté.
- ALTCHA : sel au format strict (délimiteur « & », GO-2025-4239), défi lié à la connexion, usage unique, niveau minimal, `shown_at` signé et lié au défi.

**En-têtes et site statique** (serveur de HEAD lancé, `curl`)
- CSP, `Referrer-Policy`, `nosniff`, `Permissions-Policy`, COOP, CORP, HSTS, `Cache-Control: no-store` présents sur toutes les réponses, 404 comprises ; `X-Robots-Tag: noindex` sous `/s/` et `/m/`.
- `/.env`, `/.git/config` → 404 ; `/x.js` → 404 ; `/assets` (dossier sans index) → 404 ; `/s/<id>.x` → `index.html` ; `/API/shares`, `/api` → 404 JSON (jamais le repli monopage) ; `POST /` → 405 ; `/healthz` avec `X-Shh-Client-IP` → 404.
- `os.Root` : aucun lien symbolique ne sort du dossier ; segments cachés et `..` refusés avant `path.Clean`.
- Bundle de production : aucune URL tierce chargée (seules des chaînes `https://svelte.dev/e/…` dans des messages d'erreur, un lien vers le dépôt et `https://shhdrop.app/`) ; aucun `{@html}`, `innerHTML`, stockage navigateur, service worker ni `postMessage` hors tests.

**Démo**
- `npm run build:demo` puis `check-dist --demo` : conforme (CSP en `meta` en tête de `<head>`, `connect-src 'none'`, `no-referrer`, `noindex`, `404.html` identique). Build de production : `check-dist` conforme, garde `demoGuard` active.
- Faux serveur limité aux URL `/api/*` de l'origine ; aucun stockage navigateur.

**Hygiène des liens**
- Fragment lu une fois au démarrage de la route puis retiré (`replaceState` avec un chemin nu), y compris sur 404 et `hashchange` ; requête ignorée ; origine attendue imposée et liens avec identifiants refusés (`parseFor`, `checkOrigin`) ; `credentials: "omit"` et `redirect: "error"` sur `fetch` ; `robots.txt` exclut `/s/` et `/m/`.

**Workflows GitHub**
- Toutes les actions épinglées par empreinte, et chaque empreinte correspond bien à son étiquette (`git ls-remote` : checkout v7.0.1, setup-go v7.0.0, setup-node v7.1.0, upload-artifact v7.0.2, upload-pages-artifact v5.0.0, deploy-pages v5.0.1).
- `permissions: contents: read` par défaut ; `pages: write` et `id-token: write` dans le seul job `deploy`.
- `workflow_run` : publication seulement si `conclusion == 'success'` et `event == 'push'` sur `main` ; `head_sha` passé en `with: ref`, jamais interpolé dans un `run:` (aucune injection de script) ; aucun champ contrôlable (`head_branch`, titre de commit) utilisé.
- `npm ci --ignore-scripts` partout ; `govulncheck` épinglé (v1.9.0) et vert en CI (`GOTOOLCHAIN: local`).
- Nouveau commit d01baf9 (`paths-ignore`, `concurrency`) : une exécution annulée conclut `cancelled` et ne déclenche pas Pages.

**Dépendances et secrets**
- `govulncheck` : aucune vulnérabilité ; `go mod verify` : tous les modules vérifiés.
- `npm audit` : 0 avis en production ; 2 « low » en dev (ci-dessus) ; outil svelte-check : 0.
- Historique (82 commits) : aucune clé, aucun jeton, aucun fichier `.env`/`.pem`/`.db` suivi ; auteurs = adresse anonyme GitHub, `noreply@anthropic.com` (committer) et Dependabot ; aucune adresse e-mail personnelle.

## Reproductions

Fichiers hors dépôt, dans `/tmp/claude-0/-home-user/b97dc3e7-f107-54ba-8c5b-d4198f88d7ff/scratchpad/audit-secu/` :
- `server/internal/api/audit_mem_test.go` (E1) : `GOTOOLCHAIN=go1.27.3 go test ./internal/api -run TestAuditSlowReaderMemory -v`.
- `server/internal/api/audit_repro_test.go` (M1) : `go test ./internal/api -run TestAuditReplayEgress -v`.
- `head/` : instantané de HEAD utilisé pour les builds et le serveur réel.
