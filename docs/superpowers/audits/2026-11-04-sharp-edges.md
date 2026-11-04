# Audit « sharp edges » de Shhdrop (main, 7f6debc), 2026-11-04

Méthode : skill sharp-edges (Trail of Bits). Lecture seule du dépôt. Reproductions dans une copie : `scratchpad/audit/srv/**/zz_audit*_test.go` et `scratchpad/audit/web/src/zz_audit.test.ts`. Aucun Critique ni Élevé trouvé.

## Moyen

**M1. Tous les secrets du client ont le même type `Uint8Array` : envoyer K_lien au serveur compile.** `web/src/transfer/api.ts:183,194,248` (`meta`, `unlock`, `status`) ; `link.ts:6` (`secret`).
Reproduction : `api.meta(ctx, p.id, parseLink(link).secret)` passe `tsc` sans erreur. L'en-tête X-Shh-Access envoyé vaut alors `b64u(K_lien)` (vérifié : `true`). `unlock(c, id, kPreuve, kAcces)` compile aussi.
Impact : le développeur du Plan 2 prendra naturellement `secret` comme « le secret à envoyer ». Le serveur reçoit alors K_lien, ce que CLAUDE.md interdit. Avec la base, il ne reste qu'à casser le mot de passe hors ligne (§7.2).
Correction : utiliser des types marqués (`KLien`, `KAcces`, `KPreuve`, `SGestion`, du type `Uint8Array & {readonly __k: "…"}`), produits seulement par `deriveAccess`, `deriveContent` et `parseLink` (`ParsedLink` en union discriminée `{kind:"s", kLien}` / `{kind:"m", sGestion}`). Ne pas exposer `api.ts` hors de `transfer/`.

**M2. Les commandes d'administration réussissent en silence sur un mauvais `SHH_DATA_DIR`.** `cmd/shhdrop/admin.go:41,75,119-124`.
Reproduction : `freeze` sur un dossier mal orthographié renvoie le code 0 et « créations suspendues », et le vrai fichier `frozen` n'existe pas. `wipe --yes` renvoie 0 et « tout est effacé » (MkdirAll et store.Open créent une base vide). `destroy` répond « introuvable ».
Impact : en cas d'incident ou de signalement légal, l'exploitant croit le service gelé ou vidé alors que les données restent en place et que les créations continuent.
Correction : en mode admin, ne rien créer. Exiger un `DataDir` absolu existant qui contient `shares.db`, et ouvrir la base avec `mode=rw` (sans création). Afficher le chemin absolu et le nombre de partages touchés.

**M3. `SHH_LISTEN` accepte une adresse publique sans proxy.** `internal/config/config.go:33`.
Reproduction : `SHH_LISTEN=0.0.0.0:8080` (ou `:8080`) avec `SHH_BEHIND_PROXY` absent : aucune erreur.
Impact : le service est joignable en HTTP clair. K_accès, K_preuve et S_gestion circulent sans TLS (HSTS ne protège pas une première visite en http direct). La spec §8 dit « écoute uniquement en local ».
Correction : refuser une adresse non locale sauf si `SHH_BEHIND_PROXY=1` et qu'un `SHH_TRUSTED_PROXY` (CIDR) est donné. Ce point est à traiter avec le problème Docker du Plan 3.

**M4. Nom et type MIME du manifeste rendus bruts ; `collectToBlob` prend le type MIME en paramètre.** `crypto/container.ts:300-317` ; `transfer/client.ts:301`.
Reproduction : nom `"../../facture‮fdp.exe\u0000"` et MIME `"text/html"` scellés, puis ouverts : `openStream` les rend tels quels.
Impact : la voie facile, `collectToBlob(open, i, item.mime)`, crée un Blob `text/html` sur l'origine de Shhdrop, et le nom garde l'inversion de sens d'écriture et les chemins. La spec §(Réception) exige une liste blanche, `application/octet-stream` et un nom nettoyé, mais rien dans l'API ne l'impose.
Correction : `collectToBlob` doit toujours utiliser `application/octet-stream` (retirer le paramètre). `Opened` doit exposer `safeName(i)` (sans bidi, contrôles ni chemins, longueur bornée) et `previewKind(i)` (énumération sur liste blanche), avec des tests.

## Faible

**F1. Le client prend l'origine dans le lien.** `client.ts:76,227,329`.
Reproduction : `fetchMeta("https://evil.example:8443/s/…")` et un lien avec `user:pw@` envoient K_accès à evil.example. `shareLink("http://srv.test/")` donne `http://srv.test//s/…`.
Atténuation : la CSP `connect-src 'self'` bloque cet envoi dans le navigateur, mais pas en Node ni dans la future appli (§16).
Correction : passer l'origine attendue en paramètre et refuser si `link.origin` diffère ou si le lien contient un nom d'utilisateur. Valider l'origine dans `shareLink` et `createShare` (https, sans chemin).

**F2. Go `encoding/json` ignore la casse des clés et accepte les doublons.** `api/api.go:254`.
Reproduction : `{"proof":"<faux>","PROOF":"<juste>"}` donne 200 (déverrouillé), `{"pRoOf":…}` aussi, et `{"bucket":1,"Bucket":16000000}` donne 16000000. Aucune exploitation possible aujourd'hui (aucun intermédiaire ne lit le JSON), mais `DisallowUnknownFields` laisse croire à une vérification stricte.
Correction : avant le décodage, parcourir les jetons et refuser les doublons et les clés qui ne correspondent pas exactement, ou utiliser `encoding/json/v2` dès qu'il est stable.

**F3. Le base64 de Go ignore `\r` et `\n` même en mode `Strict()`.** `share/service.go:84`, `api/api.go:220`.
Reproduction : `validID` vaut `true` sur 23 caractères ou plus contenant des `\n`, et un `proof` JSON contenant `\n` est accepté (200). Aucun effet ici (`blob.validID` est strict, la recherche en base échoue), mais l'encodage n'est pas canonique.
Correction : vérifier la longueur exacte en caractères (22 ou 43) avant de décoder.

**F4. `match(nil, …)` hache l'entrée vide.** `share/service.go:78`, `Destroy`.
Reproduction : `match(nil, SHA-256(""))` vaut `true`. Un créateur qui stocke `access_v` = `proof_v` = SHA-256("") rend son partage destructible par `{"manage":<n'importe quoi>}`. L'impact se limite à son propre partage, mais l'API métier accepte `nil`.
Correction : `match` renvoie faux si `len(x) != 32`. `Validate` refuse un vérificateur égal à SHA-256("").

**F5. `SHH_DATA_DIR` : chemin relatif accepté, et droits d'un dossier existant forcés à 0700.** `config.go:30`, `main.go:84-90`.
Reproduction : un dossier en 0755 passe en 0700. Avec `SHH_DATA_DIR=/var` ou `$HOME`, cela casse le système, et `Reconcile` efface les fichiers de `blobs/` qui ont un nom valide.
Correction : chemin absolu obligatoire, et refus d'un dossier non vide qui n'a ni `shares.db` ni `blobs/`.

**F6. `SHH_STORAGE_MAX` n'a pas de plafond réel.** `config.go:36`.
Reproduction : `9223372036854775807` et `+5` sont acceptés. Si `fallocate` n'est pas pris en charge, les fichiers sont creux (`reserve_linux.go:19`) : le disque peut se remplir en plein envoi et SQLite échoue.
Correction : au démarrage, appeler `statfs` et exiger StorageMax ≤ espace libre + espace utilisé − marge. Refuser le repli « fichier creux » en production.

**F7. `SHH_STATIC_DIR` n'est pas vérifié ; `FileServerFS` liste les dossiers et sert les fichiers cachés.** `main.go:150`.
Reproduction : `GET /assets/` renvoie une liste HTML et `GET /.env` renvoie 200. Un dossier inexistant est accepté sans erreur.
Correction : au démarrage, vérifier que le dossier et `index.html` existent. Envelopper le système de fichiers pour refuser les dossiers sans index et les noms qui commencent par « . ».

**F8. La compilation 32 bits échoue.** `token/token.go:57`.
Reproduction : `GOARCH=386 go build` donne « math.MaxUint32 overflows int ». C'est un échec fermé. Les autres calculs tiennent dans un int32 (au plus 1 074 003 968).
Correction : `uint64(openN) > math.MaxUint32`.

**F9. Les phrases de passe courtes et le mot de passe vide passent.** `passphrase.ts:24-31`, `kdf.ts:57`.
Reproduction : `generatePassphrase(2)` (environ 26 bits) donne 12 caractères et `checkPassword` répond `ok`. `deriveContent("")` réussit, car seul `createShare` vérifie le mot de passe.
Correction : n ≥ 4 obligatoire (ou constante non réglable). Vérifier le mot de passe dans une fonction de dérivation réservée à la création.

**F10. Les valeurs zéro de `share.Service` sont dangereuses.** `service.go:63`.
`FrozenFile` vide désactive le gel sans rien dire (échec ouvert). `StorageMax` à 0 refuse toutes les créations.
Correction : un constructeur `NewService` qui valide ces champs.

**F11. `admin destroy <lien>` met K_lien dans argv.** Spec §7.6 et §15.3, `admin.go:58`.
Le lien entier atterrit dans l'historique du shell et dans `/proc/<pid>/cmdline`. Après une destruction réussie, la clé ne sert plus à rien. Elle reste en revanche utilisable si la commande échoue (voir M2 : « introuvable »).
Correction : lire le lien sur l'entrée standard (`-`), et documenter qu'il faut retirer la partie après `#`.

## Vérifié, sans problème
- `SHH_BEHIND_PROXY` : seuls "", "0" et "1" sont acceptés ; "true" et " 1" sont refusés. `SHH_STORAGE_MAX` à 0 ou négatif est refusé.
- Valeur par défaut `SHH_BEHIND_PROXY=0` : si Caddy n'envoie pas l'en-tête, tous les visiteurs partagent la limite de l'adresse locale (reproduit : 61 visiteurs, un 429). Échec du côté sûr pour la confidentialité ; le passer à 1 par défaut en production serait préférable.
- Jetons : type vérifié, id lié, longueur bornée, base64 strict, `hmac.Equal`, expiration ; aucune confusion de type de jeton possible (u/d/c, id de 22 ou 32 caractères).
- Comparaisons de secrets : `subtle.ConstantTimeCompare`, `hmac.Equal`, en-tête comparé par OU exclusif en TS. Pas de comparaison à temps variable.
- ttl {1,6,12,24}, max_opens 1–10, palier sur liste, kdf 3–10 et 64–256 Mio côté serveur ; nombres JSON non entiers refusés.
- `checkKdfParams` : NaN, chaînes, 0 et valeurs hors plafond refusés ; null lève une TypeError (échec fermé).
- `unb64u` (TS) refuse les bits de bourrage non nuls et les longueurs %4==1 ; les longueurs sont vérifiées par les appelants.
- `segNum` canonique ; `n` vérifié avant `SegmentSize` ; bits `openN` bornés de 1 à 10.
- NFC appliqué dans `deriveContent` ; `checkPassword` en NFC.
- ALTCHA : algorithme imposé, sel au format strict, usage unique, niveau, liaison à la connexion.
- Un serveur malveillant ne peut pas changer le palier, la taille des segments, le sel (16 octets) ni les paramètres KDF sous le minimum.
- `unlock` et `destroy` ne sont jamais rejoués ; `redirect: "error"`, `credentials: "omit"`.
- Gel : toute erreur de `stat` gèle (échec fermé).
- Absent (hors sharp edges) : le motif de signalement n'est pas compté en mémoire (spec §7.6).

## Liste de contrôle
- ✔ Valeurs zéro, vides et nulles testées (config, KDF, ids, secrets nil, Service)
- ✘ Valeurs par défaut sûres : SHH_BEHIND_PROXY=0, FrozenFile vide (F10)
- ✔ Choix d'algorithme : aucun choix laissé à l'appelant (ALTCHA forcé, AES-GCM et Argon2id fixes)
- ✘ Confusion de types entre secrets (M1)
- ✔ Trois adversaires considérés (le mauvais acteur : M3, F2, F4 ; le pressé : M4, F9 ; le confus : M1, M2)
- ✔ Les chemins d'erreur ne contournent pas la sécurité (sauf F4, limité au créateur)
- ✘ Validation de la configuration incomplète (M3, F5–F7)
- ✘ Paramètres des constructeurs non validés (F10)
