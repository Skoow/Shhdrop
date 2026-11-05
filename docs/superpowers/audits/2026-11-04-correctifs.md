# Correctifs de l'audit « sharp edges » (branche plan-1c-durcissement), 2026-11-04

Audit de référence : `2026-11-04-sharp-edges.md` (M1–M4, F1–F11), plus S1, demandé par le plan de l'interface.
Méthode : pour chaque point, un test qui reproduit le problème a d'abord échoué (ROUGE), puis le correctif l'a fait passer (VERT). Pour les fonctions qui n'existaient pas encore (`NewService`, `newKLien`…), la phase rouge est un échec de compilation. Dans ce cas, le scénario de l'audit a aussi été rejoué contre l'ancien code avec une cale temporaire (fichier `zz_*` supprimé ensuite).

Commits : `24493ef` (F2, F3, F4, F8, F10), `485c752` (M3, F5, F6, F7), `87f3970` (M2, F11), `c86d6bc` (M1, M4, F1, F9), `52e7fa8` (S1), puis ce rapport et la spécification v2.4 (§8, §10, §12, §15.3, §18, §25).

## Vérification finale

| Commande | Résultat |
|---|---|
| `make test` (go vet, go test, `GOARCH=386 go build`, vitest src, e2e) | code 0 ; Go : 10 paquets `ok` ; web : 10 fichiers, **140 tests** passés ; e2e : 4 fichiers, **24 tests** passés, dont « le serveur ne voit rien » |
| `cd web && npx tsc --noEmit` | aucune erreur |
| `cd server && go vet ./... && GOARCH=386 go build ./...` | aucune erreur |
| `govulncheck ./...` (compilé avec go1.27.3) | `No vulnerabilities found.` |
| `npm audit` | `found 0 vulnerabilities` |

## Moyens

### M1 — secrets confondus
- **Changement** : `web/src/crypto/types.ts` définit `KLien`, `KAcces`, `KPreuve` et `SGestion`, de type `Uint8Array<ArrayBuffer> & { readonly __brand: "…" }`. Seuls `newKLien()`, `newSGestion()`, `deriveAccess`, `deriveContent`/`deriveContentForCreate` et `parseLink` les produisent. `ParsedLink` devient `{kind:"s"; origin; id; kLien} | {kind:"m"; origin; id; sGestion}`. `api.meta`/`unlock`/`status`/`destroy` prennent les types marqués. `web/src/index.ts` est l'interface publique, sans `api.ts` ni les dérivations. `npm test` lance maintenant `tsc --noEmit && vitest run src`.
- **Tests** : `src/transfer/types.test.ts` contient 13 lignes `@ts-expect-error` (K_lien vers meta, scénario de l'audit ; tableau brut ; unlock aux arguments inversés ; K_lien vers status ; S_gestion vers shareLink…). Un test d'exécution vérifie que X-Shh-Access vaut `b64u(K_accès)` et jamais `b64u(K_lien)`. `src/index.test.ts` vérifie la liste exacte des exports.
- **Preuve que le garde-fou fonctionne** : en changeant `meta(…, kAcces: KAcces)` en `Uint8Array`, `tsc` échoue :
  `src/transfer/types.test.ts(29,7): error TS2578: Unused '@ts-expect-error' directive.` (puis le fichier a été restauré).

### M2 — admin sur un mauvais dossier
- **Changement** : `runAdmin` exige un `SHH_DATA_DIR` absolu qui contient `shares.db`. La base est ouverte avec `store.OpenExisting` (`mode=rw`, table `shares` vérifiée) et rien n'est jamais créé. La commande affiche le chemin absolu et le nombre de partages touchés (`créations suspendues (/… ; 2 partages en place)`, `1 partage détruit (/…)`, `N partages effacés`), et sort en 1 en cas d'échec. `freeze` ne fait plus de `MkdirAll`.
- **Tests** : `TestAdminRefusesWrongDataDir` (dossier mal orthographié, vide ou relatif × freeze/unfreeze/destroy/wipe), `TestStoreOpenExistingDoesNotCreate`, `TestAdminReportsPathAndCount`.
- **ROUGE** (ancien code) : `…/typo [freeze] : code 0, "créations suspendues\n"`.
- **VERT** : `go test ./cmd/shhdrop -run 'TestAdmin|TestStoreOpenExisting' -v` → 8 `--- PASS`. Essai manuel : `SHH_DATA_DIR=/tmp/nexiste-pas shhdrop admin freeze` → `erreur: SHH_DATA_DIR /tmp/nexiste-pas ne contient pas shares.db : mauvais dossier ? (rien n'a été fait)`, `code=1`, dossier non créé.

### M3 — écoute publique sans proxy
- **Changement** : `config` refuse un `SHH_LISTEN` hors boucle locale (`127.0.0.0/8`, `::1`, `localhost`), sauf si `SHH_BEHIND_PROXY=1` et `SHH_TRUSTED_PROXY` sont donnés. `SHH_TRUSTED_PROXY` est une liste de CIDR canoniques, jamais `/0`, et exige `SHH_BEHIND_PROXY=1`. Le port doit être numérique et ≤ 65535. `api.ClientIP(r, proxies)` ne croit X-Shh-Client-IP que de la boucle locale ou de ces réseaux ; derrière le proxy, tout autre pair reçoit 500.
- **Tests** : `TestListenLoopbackOnly`, `TestTrustedProxy`, `TestClientIPTrustedProxies`, `TestBehindTrustedProxy`.
- **ROUGE** : `"0.0.0.0:8080" accepté sans proxy`. **VERT** : tous `--- PASS`.

### M4 — nom et type MIME bruts
- **Changement** : `web/src/transfer/safety.ts` (`safeName`, `previewKindOf`, `isRiskyName`). `Opened.safeName(i)`, `previewKind(i)` et `isRiskyFile(i)` lèvent `element_inexistant` pour un indice invalide. `collectToBlob(open, i, foldBytes?)` produit toujours `application/octet-stream` (le paramètre `mime` est retiré).
- **Tests** : `src/transfer/safety.test.ts` (8 tests : cas de l'audit, chaque caractère bidi, C0/C1, séparateurs, points, NFC, 120 points de code avec extension, repli « fichier », liste blanche, 200 Mio, extensions dangereuses). `client.test.ts` scelle le cas de l'audit puis l'ouvre : `"../../facture‮fdp.exe\u0000"` en `text/html` → `safeName` = `facturefdp.exe`, `previewKind` = `none`, `isRiskyFile` = `true`, Blob en `application/octet-stream`.
- **ROUGE** : `Cannot find module './safety'` ; `o.safeName is not a function`. **VERT** : `npm test` passe.

## Faibles

| Point | Changement | Test(s) | ROUGE → VERT |
|---|---|---|---|
| **F1** origine prise dans le lien | `checkOrigin` : `https://hôte[:port]` exact (http seulement en boucle locale), sans chemin, requête, fragment ni identifiants. Appelé par `createShare`, `shareLink` et `manageLink`. `fetchMeta(link, expectedOrigin, net?)`, `openShare(link, pw, expectedOrigin, onProgress?, net?)`, `destroyShare(link, expectedOrigin, opts?)` et `shareStatus(manage, expectedOrigin, net?)` refusent une autre origine ou `user:pw@` avec `lien_invalide`, sans envoyer aucune requête. `parseLink` refuse les identifiants dans l'URL | `link.test.ts` « origine (audit F1) », `client.test.ts` « origine attendue » (evil.example:8443, user:pw@, http://srv.test/) | 6 tests × (vitest) → passés |
| **F2** clés JSON | `readJSON` lit le corps (≤ 4 Kio), puis `strictKeys` parcourt les jetons : nom exact (balise `json`), sans doublon, objets imbriqués compris ; refus en 400 avant `Decode` | `TestJSONStrictKeys` : `{"proof":faux,"PROOF":juste}`, doublon exact, `pRoOf`, `Proof`, `{"bucket":1,"Bucket":16}`, `OPS`, doublon de `manage` | `reçu 200 {"download_token"…}` → PASS |
| **F3** `\r` `\n` en base64 | `share.DecodeB64(s, n)` : longueur exacte (22/43), alphabet base64url, puis décodage strict. Utilisé par `validID` et `api.secret`. Les jetons refusent tout caractère hors base64url et « . » | `TestValidIDCanonical`, `TestSecretsRejectNewlines`, `TestTokenRejectsNewline` | `reçu 200` ; `"ZAJpZ\nAAAA…" accepté` → PASS |
| **F4** `match(nil)` | `match` refuse `len(x) != 32` ; `Validate` refuse un vérificateur égal à SHA-256("") | `TestMatchRequires32Bytes`, `TestValidateRefusesEmptyHashVerifier` (scénario de l'audit inséré à la main : `Destroy(id, nil, nil, nil)` → introuvable) | échec de compilation (DecodeB64/NewService absents) → PASS |
| **F5** `SHH_DATA_DIR` | chemin absolu, nettoyé, sans `? # %` (URI SQLite). `serve` : un dossier non vide sans `shares.db` **et** `blobs/` est refusé, sans chmod. Dossier neuf ou vide : accepté. `SHH_STATIC_DIR` absolu | `TestDataDirAbsolute`, `TestServeRefusesForeignDataDir` (dossier 0755 avec `notes.txt` : droits et contenu intacts) | `SHH_DATA_DIR="data" accepté` ; `serve a démarré au lieu de refuser` → PASS |
| **F6** plafond de stockage | `SHH_STORAGE_MAX` en chiffres seuls (`+5` refusé). Au démarrage, `statfs` (variable `diskFree`, injectable) : `max ≤ libre + réservé − 1 Gio`. Avec `SHH_BEHIND_PROXY=1` : `blob.Store.NoSparse`, sonde `CheckAllocate` au démarrage, et `Reserve` → `ErrNoAllocate` → `ErrFull` (507) | `TestStorageMaxCanonical`, `TestServeStorageMaxFitsDisk` (3 Gio libres : 2 Gio + 1 refusé, 2 Gio accepté ; < 1 Gio refusé), `TestReserveNoSparse` | `"+5" accepté` ; `serve a démarré` → PASS |
| **F7** site statique | `staticHandler` : `os.OpenRoot` (aucun lien symbolique ne sort), `index.html` exigé, segments en « . » → 404, dossier sans index → 404, GET/HEAD seulement (405 sinon), repli monopage vers `index.html` pour un chemin inconnu sans extension, mêmes en-têtes de sécurité | `TestServeStaticDir` : `/.env`, `/.git/config`, `/assets/../.env`, `/assets/`, lien symbolique vers `/etc/passwd`, `/assets/absent.js` → 404 ; `/`, `/s/<id>`, `/m/<id>` → index.html avec CSP, no-store, nosniff | `serve a démarré au lieu de refuser` → PASS |
| **F8** 32 bits | `uint64(openN) > math.MaxUint32` ; `make test-go` lance aussi `GOARCH=386 go build ./...` | `GOARCH=386 go build ./...` | `math.MaxUint32 (untyped int constant 4294967295) overflows int` → OK |
| **F9** phrases courtes, mot de passe vide | `generatePassphrase`/`Words` : n ≥ 4 (`PASSPHRASE_MIN_WORDS`), sinon RangeError. `deriveContentForCreate(kLien, pw, salt)` impose `checkPassword` et `KDF_CREATE` ; `createShare` l'utilise. `deriveContent` refuse `""` (`mot_de_passe_vide`) | `passphrase.test.ts` (0, 1, 2, 3, 3.5, NaN), `kdf.test.ts` (vide, trop court, trop courant ; même K_preuve que `deriveContent(KDF_MIN)`) | 3 × → passés |
| **F10** valeurs zéro | `share.NewService(share.Config)` exige DB, Blobs.Dir, Now, `StorageMax > 0` et un `FrozenFile` absolu. Utilisé par serve, admin et tous les tests. `Frozen()` sur un `FrozenFile` vide rend vrai (échec fermé) | `TestNewService` (8 configurations refusées, valeur zéro gelée) | compilation → PASS |
| **F11** lien dans argv | `admin destroy -` lit une seule ligne (≤ 4 Kio) sur l'entrée standard. Un argument contenant `#` affiche un avertissement (« … dans l'historique du shell … ») ; la sortie ne reprend jamais le secret ni l'identifiant | `TestAdminDestroyStdin` (stdin, avertissement, `id#clé` introuvable + avertissement, entrées vides, multiples ou trop longues → code 2) | compilation (signature) → PASS |

## S1 — signalement après la dernière ouverture
- **Problème** : `destroyShare` relit `meta`, qui répond 404 en `draining`. Avec `maxOpens=1`, le destinataire ne pouvait donc plus signaler le partage.
- **Changement** : `Opened.destroy(reason?: "report")` réutilise K_accès et K_preuve gardés dans la fermeture d'`openShare`. Il appelle `POST /destroy` sans `meta`. `wipe()` met ces clés à zéro (`destroy` lève alors `cles_effacees`). Elles sont aussi mises à zéro dès que l'ouverture échoue. `api.destroy` accepte `reason`. `done` part avec `keepalive: true`. Côté serveur, rien n'a changé : `Destroy` accepte déjà `draining` (`state<>'uploading' AND expires_at>?`).
- **Tests** : `TestDestroyWhileDraining` (share), `TestDestroyAfterLastOpen` (api, avec `reason`), `client.test.ts` « Opened.destroy et done en keepalive » (meta → 404 après unlock, destroy sans meta, corps `{proof, reason}`, `keepalive` vrai, erreur après wipe). e2e `flows.test.ts` « S1 » : vrai serveur, `maxOpens=1`, état `draining`, `destroyShare` → NotFoundError, `o.destroy("report")` réussit, puis `shareStatus` → NotFoundError.
- **ROUGE** : `TypeError: o.destroy is not a function`. **VERT** : unitaire et e2e passés. Les tests serveur sont des tests de non-régression : ils passaient déjà.

## Points signalés (à décider)
1. **Moyen, exploitation** : `SHH_STORAGE_MAX` vaut 100 Gio par défaut, il faut donc au moins 101 Gio de disque libre, sinon le serveur refuse de démarrer. C'est voulu (F6), mais à prévoir pour l'hébergement (§15.1). Le serveur de test e2e fixe 4 Gio.
2. **Faible, confidentialité** : à cause de S1, K_accès et K_preuve restent en mémoire jusqu'à `wipe()`. Ils ne permettent pas de déchiffrer. Le point est ajouté aux limites assumées (§18.10).
3. **Faible, exactitude** : `Opened.manifest` expose encore le nom et le type bruts (le texte et les tailles y sont nécessaires). Le commentaire interdit de les afficher. L'interface du Plan 2 doit utiliser `safeName`, `previewKind` et `isRiskyFile`. Un test d'interface pourrait le vérifier.
4. **Faible, exploitation** : `blob.ErrNoAllocate` est traduit en `ErrFull` (507), ce qui ne distingue pas un disque plein d'un système de fichiers incompatible. La sonde de démarrage empêche ce cas en production. Il n'existe pas de test unitaire de cette traduction : le crochet `fallocate` n'est accessible que dans `blob`.
5. **Choix d'interprétation** : un dossier de données non vide doit contenir **à la fois** `shares.db` et `blobs/`. Le repli monopage ne s'applique qu'aux chemins sans extension. `safeName` retire aussi U+061C (marque arabe) et les points et espaces finaux. Liste MIME stricte : `audio/x-wav`, `image/heif` et les autres variantes donnent `none`.

## Points mineurs restants après relecture (traités par la tâche M, avant le Plan 2)

| # | Point | Fait | Test qui le couvre |
|---|---|---|---|
| 1 | `lost+found` ignoré dans le contrôle « dossier vide » de `SHH_DATA_DIR` (seulement si c'est un dossier ; un fichier de ce nom ou un autre contenu reste refusé) | fait | `TestServeIgnoresLostAndFound` (cmd/shhdrop) |
| 2 | `openShare` / `destroyShare` (lien de partage) : mot de passe vide refusé avant toute requête et toute dérivation, `mot_de_passe_requis` (le lien est jugé avant ; lien de gestion non concerné) | fait | `client.test.ts` « mot de passe vide : refusé avant toute requête », « destroyShare : mot de passe vide refusé… » |
| 3 | `SHH_TRUSTED_PROXY` : IPv4-dans-IPv6 refusé ; réseaux privés (RFC 1918, boucle locale, `fc00::/7`) ou préfixe ≥ /8 (IPv4), ≥ /32 (IPv6) | fait | `TestTrustedProxyShape` (config) |
| 4 | `safeName` : largeur nulle (U+200B–U+200D, U+2060) et étiquettes (U+E0000–U+E007F) retirées avant la normalisation ; coupe par graphème (`Intl.Segmenter`), 120 points de code au plus | fait | `safety.test.ts` « retire les caractères de largeur nulle… », « coupe par graphème… » |
| 5 | Fichiers à risque : `.msix .appx .reg .wsf .cpl .pif .url .command .desktop` ajoutés | fait | `safety.test.ts` « extensions exécutables ou interprétées » |
| 6 | Espace disque : `Frsize` quand il est non nul (Linux ; macOS n'a que `Bsize`) | fait | `TestAvailBytes` (cmd/shhdrop) |
| 7 | « Le serveur ne voit rien » parcourt aussi `Opened.destroy("report")` (second partage, requêtes, disque, mémoire, sorties) | fait | e2e `sees-nothing.test.ts` (liste des requêtes, `kLien`/`kAcces`/`id` du second partage) |
| 8 | Conversion `ErrNoAllocate` → `ErrFull` (et aucune conversion des autres erreurs) | fait | `TestCreateNoAllocateIsFull` (share ; crochet `reserveBlob`) |
| 9 | 404 uniforme pour `/api` et `/api/…` sans tenir compte de la casse (`/API/x`, `/Api`, `/api` : plus de repli SPA ni de 307) | fait | `TestAPIPrefixCaseInsensitive404` (api) |
| 10 | Fichiers de sonde `.sonde-<chiffres>` supprimés au démarrage (fichiers ordinaires de `blobs/` seulement) | fait | `TestRemoveProbes` (blob), `TestServeRemovesLeftoverProbes` (cmd/shhdrop) |
| 11 | Il faut au moins `SHH_STORAGE_MAX` + 1 Gio libres pour démarrer | fait (spécification §15.1) | documentation |
