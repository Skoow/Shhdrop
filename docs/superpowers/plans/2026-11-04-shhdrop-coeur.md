# Shhdrop — Plan 1 : le cœur (crypto du navigateur + serveur)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une bibliothèque TypeScript de chiffrement et de transfert + un serveur Go qui, ensemble, permettent de créer, envoyer, déverrouiller, télécharger et détruire un partage de bout en bout, avec la preuve automatique que le serveur ne voit jamais rien en clair.

**Architecture:** `web/src/crypto` et `web/src/transfer` forment une bibliothèque sans interface graphique, exécutable dans le navigateur et dans Node 22 (WebCrypto global, `fetch`). Le serveur Go (`server/`) applique les règles d'un partage sur SQLite et sur des fichiers à taille réservée. Un test d'intégration Node lance le vrai binaire du serveur et joue tous les parcours. Les écrans (Plan 2) et le déploiement (Plan 3) viendront s'appuyer sur ces interfaces.

**Tech Stack:** Go 1.24, `modernc.org/sqlite`, `github.com/altcha-org/altcha-lib-go` · TypeScript 5, Vite 6, Vitest 2, `libsodium-wrappers-sumo` 0.7.15 · Node 22.

**Spec:** `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (v2.2 : lire les sections 0, 7, 8, 9, 21 et 22 avant toute tâche).

## Global Constraints

- Aucune crypto maison : AES-256-GCM, HKDF-SHA-256, HMAC-SHA-256, SHA-256 via WebCrypto ; Argon2id via libsodium (`crypto_pwhash`, `ALG_ARGON2ID13`) ; côté Go, `crypto/hmac`, `crypto/sha256`, `crypto/subtle`, `crypto/rand` uniquement.
- Argon2id : `opslimit = 3`, `memlimit = 67108864` (64 Mio), sortie 32 octets, sel 16 octets. Le navigateur refuse `ops < 3` ou `mem < 67108864`.
- Mot de passe normalisé **NFC** avant Argon2id (spec §21).
- Encodage des clés, identifiants et jetons : base64url sans remplissage.
- Constantes du paquet : morceau clair 65 536 o ; tag 16 o ; morceau chiffré 65 552 o ; en-tête 48 o ; 64 morceaux par segment ; paliers en morceaux `[1, 16, 80, 160, 400, 800, 1600]`.
- Durées : `ttl_hours ∈ {1, 6, 12, 24}` ; `max_opens ∈ [1, 10]` ; `expires_at` arrondi au quart d'heure supérieur au `finalize` ; jeton d'envoi 1 h ; jeton de téléchargement `min(1 h, expires_at)`.
- Limites : 10 créations / jour par clé IP (IPv4, ou /64 en IPv6) ; 30 / jour par /48 ; 300 Mio / jour par clé IP ; 60 requêtes / minute par clé IP sur `/api/*` ; 5 mots de passe faux → destruction.
- Le serveur ne journalise jamais d'IP, de jeton, de clé ni de corps de requête. Aucune IP n'est écrite sur disque.
- Secrets dans les en-têtes ou le corps, jamais dans l'URL.
- Commits : `git -c user.email=190851638+Skoow@users.noreply.github.com -c user.name=Skoow commit …`, poussés sur `origin main` à la fin de chaque tâche.

## Review Focus

1. **Deux appareils, deux claviers** : un mot de passe accentué (« Café-Été ») tapé en NFC d'un côté et en NFD de l'autre doit déverrouiller (test en Task 2).
2. **Requêtes en parallèle** : 20 `unlock` faux simultanés ne doivent jamais dépasser 5 essais ; 20 `unlock` justes simultanés sur `max_opens = 3` n'en accordent que 3 (test en Task 6).
3. **Envoi hors cadre** : segment d'indice trop grand, de taille inexacte, envoyé après `finalize` ou avec un jeton d'un autre partage → refusé, et aucun octet écrit hors de la réservation (test en Task 5 et Task 8).
4. **IP usurpée** : `X-Forwarded-For` et `X-Shh-Client-IP` envoyés par un client distant ne changent pas la clé de limite (test en Task 7).
5. **Après destruction** : plus aucun octet du paquet dans le dossier de données, ni dans le fichier de base, ni dans le WAL (test en Task 10).

---

## Structure des fichiers

```
Makefile                                # make test (tout), make test-go, make test-web, make test-e2e
.github/workflows/ci.yml                # CI : go vet + test, npm ci + test, e2e
server/go.mod                           # module github.com/skoow/shhdrop/server
server/cmd/shhdrop/main.go              # démarrage (serve) + admin (freeze, unfreeze, wipe, destroy)
server/internal/config/config.go        # Config (env), valeurs par défaut
server/internal/store/store.go          # ouverture SQLite, schéma, PRAGMA
server/internal/share/service.go        # règles d'un partage (machine à états, SQL atomique)
server/internal/blob/blob.go            # fichiers : réserver, écrire segment, lire, effacer, réconcilier
server/internal/token/token.go          # jetons signés (envoi, téléchargement)
server/internal/limits/limits.go        # quotas journaliers + limite de débit + clé IP
server/internal/captcha/captcha.go      # défis ALTCHA adaptatifs, usage unique
server/internal/api/api.go              # routes HTTP, erreurs uniformes
server/internal/api/headers.go          # en-têtes de sécurité
server/internal/api/clientip.go         # IP de confiance
server/internal/janitor/janitor.go      # nettoyage chaque minute, réconciliation
web/package.json · web/tsconfig.json · web/vitest.config.ts
web/src/crypto/encoding.ts              # base64url, utf8, concat
web/src/crypto/kdf.ts                   # dérivation des clés
web/src/crypto/passphrase.ts            # phrase de passe 4 mots, validation des mots de passe
web/src/crypto/wordlist-eff.ts          # liste EFF (généré)
web/src/crypto/blocklist.ts             # 10 000 mots de passe courants (généré)
web/src/crypto/container.ts             # paquet chiffré (manifeste, bourrage, morceaux, segments)
web/src/transfer/api.ts                 # appels HTTP typés
web/src/transfer/client.ts              # createShare / openShare / destroyShare / shareStatus
web/src/transfer/link.ts                # formats des liens
web/e2e/flows.test.ts                   # intégration contre le vrai serveur
web/e2e/sees-nothing.test.ts            # « le serveur ne voit rien »
web/scripts/gen-lists.mjs               # génère wordlist-eff.ts et blocklist.ts
```

---

### Task 1 : Squelette du dépôt et CI

**Files:**
- Create: `Makefile`, `.github/workflows/ci.yml`, `.gitignore`, `server/go.mod`, `server/cmd/shhdrop/main.go`, `web/package.json`, `web/tsconfig.json`, `web/vitest.config.ts`, `web/src/crypto/encoding.ts`, `web/src/crypto/encoding.test.ts`, `server/internal/config/config.go`, `server/internal/config/config_test.go`

**Interfaces:**
- Produces:
  - `encoding.ts` : `b64u(bytes: Uint8Array): string`, `unb64u(s: string): Uint8Array` (lève `Error("base64url invalide")`), `utf8(s: string): Uint8Array`, `concat(...parts: Uint8Array[]): Uint8Array`.
  - `config.Config{ DataDir string; Listen string; StorageMaxBytes int64; Now func() time.Time }` et `config.FromEnv() (Config, error)` : `SHH_DATA_DIR` (obligatoire), `SHH_LISTEN` (défaut `127.0.0.1:8080`), `SHH_STORAGE_MAX` (défaut `21474836480`).

- [ ] **Step 1 : Tests qui échouent.** `encoding.test.ts` : aller-retour `b64u/unb64u` sur `[]`, `[0]`, 32 octets aléatoires ; `b64u` ne contient jamais `+ / =` ; `unb64u("a+b")` lève. `config_test.go` : `FromEnv` sans `SHH_DATA_DIR` renvoie une erreur ; avec, applique les défauts ci-dessus.
- [ ] **Step 2 : Lancer.** `cd web && npm test` et `cd server && go test ./...` → ÉCHEC (fonctions absentes).
- [ ] **Step 3 : Implémenter.** `web/package.json` : `"type":"module"`, devDependencies `typescript@5.6.3`, `vite@6.0.3`, `vitest@2.1.8`, `@types/node@22`, dependency `libsodium-wrappers-sumo@0.7.15` ; scripts `test` = `vitest run src`, `test:e2e` = `vitest run e2e`. `tsconfig` strict, `"lib": ["ES2022","DOM"]`. `main.go` : sous-commande `serve` (placeholder qui lit `FromEnv`) et `admin`. CI : jobs `go` (`go vet ./... && go test -race ./...`), `web` (`npm ci && npm test`), `e2e` (dépend des deux, `make test-e2e`). `.gitignore` : `node_modules/`, `dist/`, `server/shhdrop`, `*.db*`, `/tmp-data/`.
- [ ] **Step 4 : Lancer.** Les deux commandes → SUCCÈS.
- [ ] **Step 5 : Commit** « chore: squelette du dépôt, CI » et push.

---

### Task 2 : Dérivation des clés (`kdf.ts`)

**Files:**
- Create: `web/src/crypto/kdf.ts`, `web/src/crypto/kdf.test.ts`

**Interfaces:**
- Consumes: `encoding.ts`.
- Produces:
  ```ts
  export const KDF_MIN = { ops: 3, mem: 67108864 } as const;
  export type KdfParams = { ops: number; mem: number };
  export type AccessKeys = { kAcces: Uint8Array; vAcces: Uint8Array };          // 32 o chacun
  export type ContentKeys = { kContenu: CryptoKey; kPreuve: Uint8Array; vPreuve: Uint8Array; engagement: Uint8Array };
  export function randomBytes(n: number): Uint8Array;
  export async function deriveAccess(kLien: Uint8Array): Promise<AccessKeys>;
  export async function deriveContent(kLien: Uint8Array, password: string, salt: Uint8Array, params: KdfParams): Promise<ContentKeys>;
  export async function sha256(b: Uint8Array): Promise<Uint8Array>;
  export async function hkdf(ikm: Uint8Array, info: string, len?: number): Promise<Uint8Array>; // sel vide, SHA-256
  ```
- Valeurs : infos HKDF `"shhdrop/v1/acces"`, `"shhdrop/v1/maitre"`, `"shhdrop/v1/contenu"`, `"shhdrop/v1/preuve"` ; `engagement = HMAC-SHA-256(kContenu brut, utf8("shhdrop/v1/engagement"))` ; `vX = SHA-256(kX)`. `kContenu` est importé en `CryptoKey` AES-GCM non extractible après le calcul de l'engagement.

- [ ] **Step 1 : Tests qui échouent.**
  - `hkdf` reproduit le cas de test 3 de la RFC 5869 (IKM = 22 × `0x0b`, sel vide, info vide, L = 42) : OKM = `8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8`.
  - `deriveContent` refuse `{ops:2, mem:67108864}` et `{ops:3, mem:33554432}` avec `Error("paramètres KDF trop faibles")`.
  - Mêmes entrées → mêmes `vPreuve` et `engagement` ; un caractère de mot de passe différent → `vPreuve` différent.
  - **NFC** : `"Café-Été"` et `"Café-Été"` → même `vPreuve`.
  - `deriveAccess` : `vAcces = sha256(kAcces)` et ne dépend que de `kLien`.
- [ ] **Step 2 : Lancer** `npm test -- kdf` → ÉCHEC.
- [ ] **Step 3 : Implémenter.** Argon2id : `await sodium.ready; sodium.crypto_pwhash(32, password.normalize("NFC"), salt, params.ops, params.mem, sodium.crypto_pwhash_ALG_ARGON2ID13)`. `kMaitre = hkdf(concat(kLien, kMdp), "shhdrop/v1/maitre")`. Mettre `kMdp` et `kMaitre` à zéro (`fill(0)`) après usage.
- [ ] **Step 4 : Lancer** → SUCCÈS (Argon2id 64 Mio : test autorisé jusqu'à 30 s).
- [ ] **Step 5 : Commit** « feat(crypto): dérivation des clés » et push.

---

### Task 3 : Phrase de passe et validation (`passphrase.ts`)

**Files:**
- Create: `web/scripts/gen-lists.mjs`, `web/src/crypto/wordlist-eff.ts`, `web/src/crypto/blocklist.ts`, `web/src/crypto/passphrase.ts`, `web/src/crypto/passphrase.test.ts`, `THIRD_PARTY_LICENSES.md`

**Interfaces:**
- Produces:
  ```ts
  export function generatePassphrase(words?: number): string;            // défaut 4, « mot-mot-mot-mot », minuscules
  export function uniformIndex(max: number, rand?: (n: number) => Uint8Array): number; // tirage sans biais par rejet
  export type PwCheck = { ok: true } | { ok: false; reason: "trop_court" | "trop_courant" };
  export function checkPassword(pw: string): PwCheck;                    // 12 caractères NFC minimum, absent de la liste noire (comparaison en minuscules)
  ```
- Sources : EFF large wordlist (`https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt`, 7 776 mots, CC-BY 3.0) ; liste noire = `10k-most-common.txt` de SecLists (MIT). `gen-lists.mjs` télécharge, vérifie le nombre de lignes (7 776 / 10 000) et l'empreinte SHA-256 inscrite dans le script, puis écrit les deux fichiers `.ts`. Les fichiers générés sont commités.

- [ ] **Step 1 : Tests qui échouent.**
  - `WORDS.length === 7776`, tous en `[a-z-]`.
  - `generatePassphrase()` correspond à `/^[a-z-]+(-[a-z-]+){3}$/` et ses 4 mots appartiennent à `WORDS`.
  - `uniformIndex(7776, fakeRand)` rejette les tirages ≥ `floor(2^32 / 7776) * 7776` : avec un générateur qui renvoie d'abord `0xFFFFFFFF` puis `0x00000005`, le résultat est `5`.
  - `checkPassword("court")` → `trop_court` ; `checkPassword("password1234")` → `trop_courant` (présent dans la liste) ; `checkPassword(generatePassphrase())` → `ok`.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** (aléa : `crypto.getRandomValues` sur un `Uint32Array`).
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(crypto): phrase de passe EFF et liste noire » et push.

---

### Task 4 : Paquet chiffré (`container.ts`)

**Files:**
- Create: `web/src/crypto/container.ts`, `web/src/crypto/container.test.ts`

**Interfaces:**
- Consumes: `kdf.ts` (`ContentKeys`).
- Produces:
  ```ts
  export const CHUNK = 65536, TAG = 16, CHUNK_CT = 65552, HEADER = 48, SEG_CHUNKS = 64;
  export const BUCKETS = [1, 16, 80, 160, 400, 800, 1600] as const;
  export type Item = { kind: "text" | "file"; name: string; mime: string; data: Uint8Array };
  export type ManifestEntry = { kind: "text" | "file"; name: string; mime: string; size: number; offset: number; text?: string };
  export type Manifest = { v: 1; items: ManifestEntry[] };
  export function bucketFor(plainLen: number): number;                   // nb de morceaux ; lève Error("trop_gros") au-delà de 1600
  export function segmentCount(bucket: number): number;                  // ceil(bucket / 64)
  export function segmentSize(bucket: number, n: number): number;        // (n===0 ? 48 : 0) + morceaux_du_segment * 65552
  export async function seal(items: Item[], keys: ContentKeys): Promise<{ bucket: number; segments: Uint8Array[] }>;
  export async function open(segments: Uint8Array[], keys: ContentKeys): Promise<{ manifest: Manifest; item(i: number): Uint8Array }>;
  ```
- Format (spec §7.3) :
  - en-tête = `"SHH1"` + octet de version `0x01` + 11 octets nuls + `engagement` (32 o) ;
  - données authentifiées de chaque morceau = l'en-tête complet ;
  - nonce = indice du morceau en big-endian sur 11 octets + `0x01` pour le dernier morceau, `0x00` sinon ;
  - clair = `u32be(len(manifeste))` + manifeste JSON UTF-8 (≤ 65 536 o, sinon `Error("manifeste_trop_gros")`) + données des éléments + zéros jusqu'à `bucket × 65536`.
  - Les textes ≤ 10 000 caractères vont dans `ManifestEntry.text` (`size = 0`), sans données ; au-delà, `Error("texte_trop_long")`.
  - `seal` refuse `items.length === 0` (`"vide"`) et `> 10` (`"trop_d_elements"`).

- [ ] **Step 1 : Tests qui échouent.**
  - `bucketFor(1)` = 1, `bucketFor(65537)` = 16, `bucketFor(100 * 1048576)` = 1600, `bucketFor(100 * 1048576 + 1)` lève.
  - `segmentSize(1600, 0)` = 48 + 64 × 65552 ; `segmentSize(16, 0)` = 48 + 16 × 65552 ; somme des segments = 48 + bucket × 65552.
  - Aller-retour avec un texte, une image de 200 Kio et un fichier de 3 Mio : manifeste et octets identiques.
  - Un octet modifié dans le morceau 3, deux morceaux échangés, le dernier segment tronqué, l'en-tête modifié ou un mauvais `engagement` → `open` lève `Error("paquet_corrompu")`.
  - Le paquet ne contient ni le nom `"secret-nom.pdf"` ni le texte `"MOT-REPERE-123"` en clair (recherche d'octets).
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter.** `crypto.subtle.encrypt({name:"AES-GCM", iv, additionalData: header, tagLength:128}, kContenu, morceau)` ; `open` vérifie l'engagement avant de déchiffrer.
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(crypto): paquet chiffré STREAM » et push.

---

### Task 5 : Serveur — base et fichiers (`store`, `blob`)

**Files:**
- Create: `server/internal/store/store.go`, `server/internal/store/store_test.go`, `server/internal/blob/blob.go`, `server/internal/blob/blob_test.go`

**Interfaces:**
- Produces:
  - `store.Open(path string) (*sql.DB, error)` : driver `modernc.org/sqlite`, `PRAGMA journal_mode=WAL; secure_delete=ON; busy_timeout=5000; foreign_keys=ON`, `db.SetMaxOpenConns(1)`, crée la table.
  - `store.Checkpoint(db *sql.DB) error` → `PRAGMA wal_checkpoint(TRUNCATE)`.
  - Schéma :
    ```sql
    CREATE TABLE IF NOT EXISTS shares(
      id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('uploading','ready','draining')),
      bucket INTEGER NOT NULL, ttl_hours INTEGER NOT NULL, max_opens INTEGER NOT NULL,
      opens_left INTEGER NOT NULL, opens_issued INTEGER NOT NULL DEFAULT 0, done_mask INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0, segments_mask BLOB NOT NULL,
      salt BLOB NOT NULL, kdf_ops INTEGER NOT NULL, kdf_mem INTEGER NOT NULL,
      access_v BLOB NOT NULL, proof_v BLOB NOT NULL, manage_v BLOB NOT NULL,
      upload_deadline INTEGER, expires_at INTEGER, purge_at INTEGER);
    ```
  - `blob.Store{Dir string}` ; `Reserve(id string, size int64) error` (crée un fichier de `size` octets via `Truncate`, mode 0600, puis `Chtimes(0,0)`) ; `WriteAt(id string, off int64, p []byte) error` (refuse si `off+len(p)` > taille du fichier, puis `Chtimes(0,0)`) ; `ReadAt(id string, off int64, n int) ([]byte, error)` ; `Delete(id string) error` ; `List() ([]string, error)` ; `UsedBytes() (int64, error)`.

- [ ] **Step 1 : Tests qui échouent.**
  - La base ouverte a `secure_delete = 1` et `journal_mode = wal`.
  - Après l'insertion puis la suppression d'une ligne contenant `"OCTETS-REPERE"` et `Checkpoint`, le motif n'est présent ni dans `shares.db` ni dans `shares.db-wal`.
  - `Reserve` → taille exacte, date de modification = epoch 0 ; `WriteAt` hors réservation → erreur et fichier inchangé ; `Delete` → fichier absent.
- [ ] **Step 2 : Lancer** `go test ./internal/store ./internal/blob` → ÉCHEC.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(server): base SQLite à effacement sûr, fichiers réservés » et push.

---

### Task 6 : Serveur — règles d'un partage (`share`)

**Files:**
- Create: `server/internal/share/service.go`, `server/internal/share/service_test.go`

**Interfaces:**
- Consumes: `store`, `blob`, `config.Config.Now`.
- Produces:
  ```go
  var ErrNotFound, ErrBadSegment, ErrIncomplete, ErrFull, ErrFrozen = …            // erreurs sentinelles
  type CreateReq struct{ Bucket, TTLHours, MaxOpens, KdfOps, KdfMem int; Salt, AccessV, ProofV, ManageV []byte }
  type Service struct{ DB *sql.DB; Blobs *blob.Store; Now func() time.Time; StorageMax int64; FrozenFile string }
  func (s *Service) Create(r CreateReq) (id string, segments int, err error)        // valide les champs, réserve 48+bucket*65552, upload_deadline = now+1h
  func (s *Service) PutSegment(id string, n int, body []byte) error                 // état uploading, n < segmentCount, len == segmentSize
  func (s *Service) Finalize(id string) (expiresIn time.Duration, err error)        // tous les segments reçus ; expires_at = ceil15(now + ttl)
  func (s *Service) Meta(id string, kAcces []byte) (Meta, error)                     // Meta{ExpiresIn time.Duration; Salt []byte; KdfOps, KdfMem, Bucket, Segments int}
  func (s *Service) Unlock(id string, kAcces, kPreuve []byte) (openN int, err error) // erreur *BadPassword{AttemptsLeft int} si faux
  func (s *Service) ReadSegment(id string, n int) ([]byte, error)                    // état ready|draining, non expiré
  func (s *Service) Done(id string, openN int) error                                 // idempotent via done_mask
  func (s *Service) Destroy(id string, kAcces, kPreuve, sGestion []byte) error       // une des deux preuves
  func (s *Service) Status(id string, sGestion []byte) (Status, error)              // Status{OpensUsed, MaxOpens int; ExpiresIn time.Duration; State string}
  func (s *Service) DestroyAdmin(id string) error
  func (s *Service) Sweep() (removed int, err error)                                 // expirés, envois abandonnés, draining terminés
  ```
- Règles :
  - toutes les vérifications de secret passent par `subtle.ConstantTimeCompare(sha256(x), stocké)` ; une mauvaise `kAcces` → `ErrNotFound`, sans compter d'essai ;
  - `Unlock` faux : `UPDATE … SET failed_attempts=failed_attempts+1 WHERE id=? AND failed_attempts<5 RETURNING failed_attempts` ; à 5 → destruction ;
  - `Unlock` juste : `UPDATE … SET opens_left=opens_left-1, opens_issued=opens_issued+1, state=CASE WHEN opens_left-1=0 THEN 'draining' ELSE state END, purge_at=CASE WHEN opens_left-1=0 THEN min(?, expires_at) ELSE purge_at END WHERE id=? AND state='ready' AND opens_left>0 AND expires_at>? RETURNING opens_issued`, avec `purge_at = now + 1 h` ;
  - suppression en état `draining` quand `popcount(done_mask) == opens_issued`, ou à `purge_at` ;
  - suppression : fichier d'abord, ligne ensuite ;
  - `Create` refuse si `UsedBytes() + taille > StorageMax` (`ErrFull`) ou si `FrozenFile` existe (`ErrFrozen`).

- [ ] **Step 1 : Tests qui échouent** (horloge simulée).
  - Parcours complet : création → 25 segments (palier 1600) → finalize → meta → unlock → lecture → done → `opens_left = 0` → la ligne et le fichier disparaissent.
  - `Finalize` à 10 h 02 avec `ttl = 1` → `expires_at = 11 h 15`.
  - Segment `n = segmentCount` → `ErrBadSegment` ; taille exacte − 1 → `ErrBadSegment` ; après finalize → `ErrNotFound`.
  - Mauvaise `kAcces` sur Meta et Unlock → `ErrNotFound`, `failed_attempts` inchangé.
  - **20 unlock faux en parallèle** (`-race`) : le compteur ne dépasse pas 5 et le partage est détruit.
  - **20 unlock justes en parallèle** sur `max_opens = 3` : exactement 3 réussites.
  - `Done` appelé deux fois pour la même ouverture ne décompte qu'une fois.
  - Lecture après `expires_at` → `ErrNotFound`.
  - `Destroy` avec `sGestion` faux → `ErrNotFound` ; avec le bon → supprimé.
  - `Create` au-delà de `StorageMax` → `ErrFull`.
- [ ] **Step 2 : Lancer** `go test -race ./internal/share` → ÉCHEC.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(server): règles des partages, SQL atomique » et push.

---

### Task 7 : Serveur — jetons, limites, IP de confiance, anti-robot

**Files:**
- Create: `server/internal/token/token.go` (+ `_test`), `server/internal/limits/limits.go` (+ `_test`), `server/internal/api/clientip.go` (+ `_test`), `server/internal/captcha/captcha.go` (+ `_test`)

**Interfaces:**
- Produces:
  - `token.New(key []byte, now func() time.Time) *Signer` ; `(*Signer).Issue(kind byte, id string, openN int, exp time.Time) string` ; `(*Signer).Check(tok string, kind byte, id string) (openN int, err error)`. Format : `b64u(kind|id|openN|expUnix)` + `"."` + `b64u(HMAC-SHA-256)`. La clé (32 o) est générée au démarrage, en mémoire.
  - `limits.Key(ip netip.Addr) (k64, k48 string)` : IPv4 → l'adresse ; IPv6 → préfixes /64 et /48. Les clés sont des HMAC-SHA-256 avec un secret quotidien tournant (`limits.New(now func() time.Time)`).
  - `(*Limiter).AllowCreate(ip netip.Addr, bytes int64) (ok bool, retryAfter time.Duration)` : 10/jour par k64, 30/jour par k48, 300 Mio/jour par k64. `(*Limiter).AllowRequest(ip netip.Addr) bool` : 60/minute par k64. Tout est en mémoire et remis à zéro chaque jour.
  - `api.ClientIP(r *http.Request) netip.Addr` : si `r.RemoteAddr` est en boucle locale, lit `X-Shh-Client-IP` (posé par Caddy) ; sinon `RemoteAddr`. `X-Forwarded-For` est toujours ignoré.
  - `captcha.New(hmacKey []byte, now func() time.Time) *Captcha` ; `(*Captcha).Challenge(ip netip.Addr) (altcha.Challenge, error)` : difficulté `maxNumber = 50000 × 2^(créations de cette clé IP dans l'heure)`, plafonnée à `50000 × 2^5` ; expiration 2 min ; sel lié à la clé IP. `(*Captcha).Verify(payload string, ip netip.Addr, honeypot string, shownAt time.Time) error` : usage unique (sel consommé en mémoire), refus si `honeypot != ""` ou `now − shownAt < 3 s`. `(*Captcha).RecordCreate(ip netip.Addr)`.
  - **Avant d'implémenter**, vérifier que `github.com/altcha-org/altcha-lib-go` et le paquet npm `altcha` existent et exposent la création et la vérification de défis. Sinon, implémenter le protocole ALTCHA documenté (SHA-256 de `sel + nombre`, signature HMAC du défi) avec `crypto/sha256` et `crypto/hmac`, et signaler l'écart.

- [ ] **Step 1 : Tests qui échouent.**
  - Jeton : valide → `openN` correct ; expiré, autre `id`, autre type ou signature modifiée → erreur.
  - Limites : 11ᵉ création du même /64 → refus avec `retryAfter > 0` ; deux IPv6 du même /64 partagent le compteur ; 31ᵉ création d'un même /48 (sur 31 /64 différents) → refus ; 300 Mio puis 1 octet → refus ; remise à zéro le lendemain (horloge simulée).
  - IP : requête distante avec `X-Forwarded-For: 1.2.3.4` et `X-Shh-Client-IP: 1.2.3.4` → IP = `RemoteAddr` ; requête locale avec `X-Shh-Client-IP` → cette IP.
  - Captcha : défi résolu (nombre trouvé par force brute dans le test) → `Verify` OK une fois, puis erreur au deuxième usage ; `honeypot` rempli → erreur ; envoi en moins de 3 s → erreur ; difficulté qui double après chaque `RecordCreate`, plafonnée.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer** `go test -race ./internal/token ./internal/limits ./internal/api ./internal/captcha` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(server): jetons signés, limites, IP de confiance, ALTCHA adaptatif » et push.

---

### Task 8 : Serveur — API HTTP et en-têtes de sécurité

**Files:**
- Create: `server/internal/api/api.go`, `server/internal/api/headers.go`, `server/internal/api/api_test.go`
- Modify: `server/cmd/shhdrop/main.go` (sous-commande `serve`)

**Interfaces:**
- Consumes: `share.Service`, `token.Signer`, `limits.Limiter`, `captcha.Captcha`, `ClientIP`.
- Produces : `api.New(svc *share.Service, sig *token.Signer, lim *limits.Limiter, cap *captcha.Captcha, static http.Handler) http.Handler`, avec ces routes :

  | Route | Entrée | Sortie |
  |---|---|---|
  | `GET /api/captcha` | — | défi ALTCHA JSON + `shown_at` signé |
  | `POST /api/shares` | JSON `{bucket, ttl_hours, max_opens, salt, kdf:{ops,mem}, access_v, proof_v, manage_v, altcha, hp, shown_at}` | 201 `{id, upload_token, segments}` |
  | `PUT /api/shares/{id}/segments/{n}` | `Authorization: Bearer <upload>`, octets bruts | 204 |
  | `POST /api/shares/{id}/finalize` | Bearer upload | 200 `{expires_in_s}` |
  | `GET /api/shares/{id}/meta` | `X-Shh-Access` | 200 `{expires_in_s, salt, kdf, bucket, segments}` |
  | `POST /api/shares/{id}/unlock` | `X-Shh-Access`, JSON `{proof}` | 200 `{download_token, segments}` · 403 `{error:"bad_password", attempts_left}` |
  | `GET /api/shares/{id}/segments/{n}` | Bearer download | 200 octets |
  | `POST /api/shares/{id}/done` | Bearer download | 204 |
  | `POST /api/shares/{id}/destroy` | JSON `{proof?, manage?, reason?}` (+ `X-Shh-Access` avec `proof`) | 204 |
  | `GET /api/shares/{id}/status` | `X-Shh-Manage` | 200 `{opens_used, max_opens, expires_in_s, state}` |

- Erreurs : un seul corps 404 `{"error":"not_found"}` pour inexistant, expiré, détruit ou mauvaise clé ; 429 `{"error":"limit","retry_after_s"}` ; 507 `{"error":"full"}` ; 503 `{"error":"frozen"}` ; 400 `{"error":"bad_request"}`.
- Corps plafonnés à la taille exacte attendue (`http.MaxBytesReader`) ; `http.Server{ReadHeaderTimeout: 10s, ReadTimeout: 120s, WriteTimeout: 120s, IdleTimeout: 60s}`.
- `headers.go` : sur toutes les réponses, CSP, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, COOP et CORP exactement comme la spec §10 (sans Trusted Types à ce stade) ; `/api/*` en `Cache-Control: no-store` ; HTML en `no-store`.
- Aucun journal d'accès ; un `panic` est rattrapé et renvoie 500 sans détail.

- [ ] **Step 1 : Tests qui échouent** (`httptest`).
  - Parcours HTTP complet avec un petit client Go de test (segments générés au hasard).
  - Les 404 des quatre cas ont un corps identique.
  - Les en-têtes de sécurité sont présents sur `/`, `/api/captcha` et une 404.
  - Un PUT de taille + 1 → 400, et le fichier est inchangé.
  - Un jeton d'envoi d'un partage A refusé sur B.
  - 61 requêtes en une minute → 429.
  - Création sans défi, avec défi réutilisé ou avec piège rempli → 400 ; serveur gelé → 503.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter** (`http.ServeMux` de Go 1.22+, motifs `{id}` et `{n}`).
- [ ] **Step 4 : Lancer** `go test -race ./...` → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(server): API HTTP et en-têtes de sécurité » et push.

---

### Task 9 : Serveur — nettoyage, réconciliation, administration

**Files:**
- Create: `server/internal/janitor/janitor.go` (+ `_test`)
- Modify: `server/cmd/shhdrop/main.go`

**Interfaces:**
- Produces :
  - `janitor.Run(ctx context.Context, svc *share.Service, db *sql.DB, every time.Duration)` : toutes les 60 s, `svc.Sweep()` puis `store.Checkpoint`.
  - `janitor.Reconcile(svc *share.Service) error` au démarrage : fichiers sans ligne → effacés ; lignes sans fichier → supprimées.
  - CLI :
    - `shhdrop serve` ;
    - `shhdrop admin freeze|unfreeze` (fichier `<DataDir>/frozen`) ;
    - `shhdrop admin destroy <id ou lien https://…/s/<id>#…>` ;
    - `shhdrop admin wipe --yes` (efface tous les partages et vide le WAL).

- [ ] **Step 1 : Tests qui échouent.**
  - Après `Sweep` à `expires_at + 1 s`, la ligne et le fichier ont disparu.
  - Un envoi non finalisé est effacé après `upload_deadline`.
  - `Reconcile` efface un fichier orphelin et une ligne orpheline.
  - `admin destroy` accepte un lien complet et n'en garde que l'identifiant.
  - `wipe` sans `--yes` refuse.
- [ ] **Step 2 : Lancer** → ÉCHEC.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer** → SUCCÈS.
- [ ] **Step 5 : Commit** « feat(server): nettoyage, réconciliation, commandes admin » et push.

---

### Task 10 : Client de transfert et tests d'intégration

**Files:**
- Create: `web/src/transfer/link.ts`, `web/src/transfer/api.ts`, `web/src/transfer/client.ts`, `web/src/transfer/link.test.ts`, `web/e2e/server.ts` (lance le binaire), `web/e2e/flows.test.ts`, `web/e2e/sees-nothing.test.ts`
- Modify: `Makefile` (`test-e2e` : `cd server && go build -o shhdrop ./cmd/shhdrop && cd ../web && npm run test:e2e`)

**Interfaces:**
- Consumes : `kdf.ts`, `container.ts`, `passphrase.ts`, l'API de la Task 8.
- Produces :
  ```ts
  // link.ts
  export function shareLink(origin: string, id: string, kLien: Uint8Array): string;     // `${origin}/s/${id}#${b64u(kLien)}`
  export function manageLink(origin: string, id: string, sGestion: Uint8Array): string;  // `${origin}/m/${id}#${b64u(sGestion)}`
  export function parseLink(url: string): { kind: "s" | "m"; id: string; secret: Uint8Array };
  // client.ts
  export type CreateOpts = { ttlHours: 1 | 6 | 12 | 24; maxOpens: number; password: string; solveCaptcha: (c: unknown) => Promise<string>; onProgress?: (done: number, total: number) => void };
  export async function createShare(origin: string, items: Item[], o: CreateOpts): Promise<{ link: string; manage: string; expiresInS: number }>;
  export async function fetchMeta(link: string): Promise<{ expiresInS: number }>;
  export async function openShare(link: string, password: string, onProgress?: (d: number, t: number) => void): Promise<{ manifest: Manifest; item(i: number): Uint8Array; done(): Promise<void> }>;
  // erreur BadPasswordError{attemptsLeft} ; NotFoundError pour tout le reste
  export async function destroyShare(link: string, opts: { password?: string }): Promise<void>; // lien de partage + mot de passe, ou lien de gestion
  export async function shareStatus(manage: string): Promise<{ opensUsed: number; maxOpens: number; expiresInS: number; state: string }>;
  ```
- Chaque segment est réessayé 5 fois avec une attente exponentielle (0,5 s → 8 s).
- `e2e/server.ts` démarre `server/shhdrop serve` avec un dossier temporaire et un port libre (`SHH_LISTEN=127.0.0.1:0`, port lu sur stdout), et capture stdout/stderr.

- [ ] **Step 1 : Tests qui échouent.**
  - `link.test.ts` : aller-retour `shareLink` → `parseLink`.
  - `flows.test.ts` :
    - création puis ouverture d'un partage (texte, image de 300 Kio, fichier de 5 Mio) → contenu identique ;
    - mauvais mot de passe ×5 → `BadPasswordError` avec `attemptsLeft` 4, 3, 2, 1, puis `NotFoundError` ;
    - `maxOpens = 2` : deux ouvertures réussies, la troisième → `NotFoundError` ;
    - deux `openShare` **simultanés** sur `maxOpens = 2` → les deux réussissent ;
    - destruction par le lien de gestion → `NotFoundError` ensuite ;
    - `shareStatus` affiche `opensUsed` correct ;
    - réseau coupé (serveur stoppé 2 s pendant l'envoi, puis relancé) → l'envoi reprend.
  - `sees-nothing.test.ts` : partage avec le texte `"MOT-REPERE-7f3a"`, un fichier nommé `"nom-repere-91c2.pdf"`, le mot de passe `"mdp-repere-44b8-zzzz"`, puis ouverture. On cherche ensuite, en octets et en base64url :
    - `kLien` et `kAcces` ;
    - le texte, le nom et le mot de passe ;

    dans les endroits suivants :
    1. tous les fichiers du dossier de données (y compris `-wal` et `-shm`) ;
    2. stdout/stderr du serveur ;
    3. toutes les requêtes émises (URL, en-têtes, corps, capturés via un `fetch` enveloppé) — `kAcces` y est autorisé, `kLien` jamais ;
    4. la mémoire du processus serveur via `/proc/<pid>/mem` (Linux ; ignoré avec un message explicite ailleurs).

    **Aucune occurrence**, sauf `kAcces` dans les en-têtes `X-Shh-Access`. Après destruction, aucun octet d'un segment n'apparaît dans le dossier de données.
- [ ] **Step 2 : Lancer** `make test-e2e` → ÉCHEC.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer** `make test` (Go + web + e2e) → SUCCÈS.
- [ ] **Step 5 : Commit** « feat: client de transfert, tests d'intégration, test « le serveur ne voit rien » » et push.

---

## Suite (plans séparés, écrits après la livraison du Plan 1)

- **Plan 2 — Écrans** : Svelte + PWA ; parcours expéditeur et destinataire ; widget ALTCHA servi localement ; lecteurs (image, audio, vidéo, texte, PDF isolé) ; vocal et photo ; retrait des métadonnées ; noms de fichiers sûrs ; NFC, bfcache, `translate="no"`, autocomplétion ; i18n fr/en ; accessibilité ; Playwright (Chromium et WebKit).
- **Plan 3 — Mise en ligne** : Docker (image minimale, non administrateur, lecture seule), Caddy (`X-Shh-Client-IP`, journaux désactivés), volume LUKS2 et `unlock.sh`, swap et core dumps désactivés, `deploy.sh` avec retour arrière, alertes, durcissement SSH et pare-feu, `security.txt`, pages légales.
