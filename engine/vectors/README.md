# Vecteurs de test communs (v2)

`v2.json` est la référence octet pour octet du chiffrement de Shhdrop (spécification du moteur Rust, §9). Il a été produit par l'ancien moteur TypeScript (`web/src/crypto`, `web/src/transfer/link.ts`) avant sa suppression. Le moteur Rust (`cargo test`), son build WebAssembly (vitest) et les futures apps doivent redonner chaque sortie à partir des seules entrées du fichier, sans JavaScript.

## Régénérer

```sh
cd web && GEN_VECTORS=1 npx vitest run src/engine/vectors.test.ts
```

Sans `GEN_VECTORS`, ce même test refait tous les vecteurs avec l'ancien moteur et exige le fichier au caractère près. Il échoue si le fichier manque ou n'est plus à jour. Deux lancements du générateur donnent le même fichier. Une fois l'ancien moteur supprimé (Task 11), ce fichier ne se régénère plus : il devient une référence figée.

## Conventions

- Octets en hexadécimal minuscule (`"00ff…"`). Le base64url sans bourrage n'apparaît que là où le format est lui-même du texte (liens, `k` dans `manifest_json` et `opened.manifest`, cas de `encoding`) et pour les gros blocs chiffrés (champs `b64u` des pièces, `share.tail`).
- **Règle anti-détecteur de secrets** : aucune autre chaîne base64url courte (40 à 100 caractères) qui code des octets. Le base64url d'un en-tête de 48 octets fait 64 caractères avec 10 « A » après le 11e : c'est la forme d'un jeton Dropbox, et GitHub refuse alors le push. Ces champs sont donc en hex (suffixe `_hex` dans `finalize_body`). Avant chaque commit du fichier, vérifier qu'aucune chaîne bornée ne correspond à `[A-Za-z0-9_-]{11}AAAAAAAAAA[A-Za-z0-9_-]{43}`.
- Erreur attendue : `{ "error": "<message exact>" }` à la place du résultat.
- JSON à clés triées, indentation de 2 espaces, LF final.
- **Aléa** : pour chaque cas, `crypto.getRandomValues` est remplacé par un flux SHA-256 en mode compteur (bloc i = SHA-256(UTF-8(`shhdrop/vecteurs/v2/` + étiquette) ‖ i sur 4 octets gros-boutistes)). `random` liste, dans l'ordre, les octets reçus par chaque appel : il suffit de les rejouer. Le flux n'est utile que pour régénérer.
- Entrées fixes non aléatoires : `seq` (octets 0, 1, 2, … à partir d'une valeur) ou SHA-256 d'une étiquette. Elles sont écrites en clair dans chaque cas.
- NFC des mots de passe (`argon2id`) : la version d'Unicode est celle de la crate `unicode-normalization` épinglée dans `engine/Cargo.lock` (JavaScript : celle du navigateur). Changer cette version, c'est vérifier que ces vecteurs passent toujours.
- Gros clairs : `{"xorshift32": {"seed": s, "len": n}}`. x ^= x << 13, x ^= x >>> 17, x ^= x << 5 sur 32 bits, état initial `s`. Chaque nouvel état donne 4 octets petit-boutistes, et le dernier groupe est tronqué à `n`. `plain_sha256` permet de vérifier le résultat.

## Sections

| Clé | Contenu |
|---|---|
| `constants` | Constantes du format (CHUNK, paliers, bornes, KDF, alphabet du mot de passe, AD). |
| `hkdf` | HKDF-SHA-256 à sel vide pour chaque étiquette, plus la RFC 5869 A.3. |
| `sha256` | Empreintes. |
| `argon2id` | `passwordKey` / `passwordKeyForCreate` (64 Mio, 3 passes), NFC (formes composée et décomposée : même clé) et refus (messages exacts). |
| `access` | K_accès, V_accès, id, K_maître, K_env, K_preuve, V_preuve, à partir de K_lien et K_mdp ; refus de taille. K_env et K_maître sont recalculés par HKDF (la clé WebCrypto n'est pas extractible) et vérifiés contre elle par le générateur. |
| `content` | K_contenu, engagement et `probe` = AES-GCM(K_contenu, nonce(0, faux), en-tête, `probe_plain`) ; refus de `contentKeysChecked`. |
| `envelope` | `seal` (nonce dans `random`) et `open` (succès et altérations → `paquet_corrompu`). |
| `header` | `header(engagement)`, `readHeader(seg0)`. |
| `nonce` | `nonce(index, last)`, jusqu'à 2^53 − 1. |
| `password` | `generatePassword` (octets de chaque tirage de 22 octets, rejet ≥ 252, nouveaux tirages complets) et `isGeneratedPassword`. |
| `encoding` | `b64u`, `unb64u`. |
| `link` | `shareLink`, `manageLink`, `checkOrigin`, `parseLink` (dont normalisations WHATWG : majuscules, `:443`, IDN, espaces, `\`, `%2e`), `shareLinkWithPassword`, `splitPassword`. |
| `sizing` | `bucketFor` (chaque frontière de palier ± 1), `segmentCount`, `segmentSize`, `segmentsFor`, `chunksFor`, `footprintFor`, `isSmall`, `reservationFor` (0 à 513), `segmentsNeeded`. |
| `element` | `elementSealer(taille, premier morceau)` : graine `k` tirée et plages (`pieces`), ou refus. |
| `manifest` | `sealFinal` : palier, en-tête, `manifest_json` (texte exact), `tail_sha256` (morceau du manifeste chiffré) ; manifeste de 65 532 octets pile et un de plus ; refus. |
| `share` | Partage complet (voir ci-dessous). |

## Écarts propres à JavaScript

- `shareLinkWithPassword` sur une adresse illisible (`"pas une url"`) : le vecteur garde l'erreur `Invalid URL` levée par `new URL` ; le moteur Rust rend `lien_invalide`, comme pour tout autre lien refusé.
- `parseLink("https://été.example/#…", "/")` : `new URL` convertit l'hôte non ASCII en Punycode (`https://xn--t-9fab.example`) ; le moteur Rust refuse tout hôte non ASCII (`lien_invalide`), faute des tables Unicode UTS 46. Ce refus est sans conséquence, parce que l'appelant compare toujours l'origine rendue à la sienne, qui est ASCII. Une étiquette déjà en `xn--…` est gardée telle quelle.
- `shareLink` et `manageLink` rendent un résultat ou une erreur (`Result`) en Rust, avec les mêmes messages que les vecteurs (`origine_invalide`, `base_invalide`), là où JavaScript levait une exception.
- `argon2id`, cas « passes non entières » (`ops: 2.5`) : JavaScript le refusait (`paramètres KDF invalides`) ; en Rust, `ops` et `mem` sont des `u32`, et un paramètre non entier, négatif, `NaN` ou infini ne peut pas être écrit. Le cas est sans objet ; le test vérifie seulement que le vecteur attend bien ce refus. La couche TypeScript (Task 5 et suivantes) devra refuser elle-même ces valeurs avant de les passer au moteur, avec le même message.
- `access` et `content`, refus de taille (K_lien ou K_mdp de 31 ou 33 octets, graine de 31 ou 33 octets) : en Rust, `KLien`, `KMdp` et `Seed` font 32 octets par type ; le refus a lieu à leur construction depuis des octets de taille libre (`from_slice`), avec le même message (`clé ou sel de taille invalide`, `graine invalide`). Les octets refusés sont écrits dans le cas (`fn`, `k_lien`, `k_mdp` pour `access` ; `r` pour `content`).
- `access`, K_maître et K_env : le moteur ne les rend pas (K_env n'existe que comme poignée du fournisseur). Le test vérifie la chaîne HKDF du vecteur (K_lien ‖ K_mdp → K_maître → K_env), puis que la clé rendue par `access_keys` (tenue par le fournisseur) chiffre comme K_env du vecteur importée (même sonde AES-GCM). Même méthode pour K_contenu (`content`).
- `content.probe` : l'en-tête et `nonce(0, faux)` (12 octets nuls) sont écrits dans le test, en attendant `format` (Task 6).
- `splitPassword` et `shareLinkWithPassword` ne lisent que des adresses `http:` ou `https:` en Rust ; JavaScript acceptait tout schéma lisible par `new URL`. Pour un autre schéma, Rust rend le lien inchangé sans mot de passe, ou `lien_invalide`. C'est sans risque : les liens de Shhdrop sont toujours en `http(s)` (`checkOrigin` l'impose), et ce cas finit toujours par un refus.

## `share`

Il contient une note de 10 octets (`Allo été`, morceau 0), un petit fichier de 100 000 octets (morceaux 1 et 2, dans le segment 0 partagé) et un fichier de 9 Mio (segments 1 à 3 ; sa dernière pièce n'occupe que 16 des 64 morceaux du segment 3), avec les droits `enregistrer`. Le palier est 400 (7 segments). Les segments 4 et 5 ne contiennent rien, et le morceau du manifeste est le dernier du segment 6.

Les étapes tirent l'aléa dans l'ordre de `transfer/draft.ts` (`random` : `k_lien`, `s_gestion`, `k0`–`k2`, `password`, `r`, `salt`, `envelope_nonce`). Le vecteur donne aussi les dérivés (K_accès, V_accès, K_mdp, id, K_preuve, V_preuve, K_contenu, engagement), le lien, le lien de gestion, le lien du QR code, l'enveloppe E, l'en-tête, le morceau du manifeste `tail` (en entier) avec `manifest_json`, et `finalize_body`, le corps de finalisation : le serveur reçoit les mêmes octets en base64url, sous le nom sans `_hex` ; son champ `tail` est `share.tail`, dont seule l'empreinte est répétée ici.

Pièces chiffrées (`items[].pieces`) : `seg`, `from`, `chunks`, `len` et `sha256` pour chacune. Celles du segment 0 sont **en entier** (`b64u`, avec les 48 octets nuls réservés à l'en-tête quand la pièce commence au morceau 0). Celles des segments 1 à 3 (≈ 9 Mio) ne donnent que `first64` et `last64` : on les retrouve en rechiffrant le clair (xorshift32) sous `k`, puis on compare l'empreinte.

Fichier du serveur : `segments[n].size`. Pour assembler, on part de zéros, on pose chaque pièce (segment 0 : à 0 si elle commence au morceau 0, sinon à 48 + from × 65 552 ; autres segments : à from × 65 552), puis l'en-tête aux octets 0 à 47 du segment 0 et `tail` dans les 65 552 derniers octets du dernier segment. `sha256_zero_filled` est l'empreinte de chaque segment ainsi assemblé. Les morceaux non écrits sont remplis d'aléa par le vrai serveur et ne sont jamais lus. `opened` donne ce que `openStream` lit après l'ouverture complète (lien → Argon2id → enveloppe → engagement) : le manifeste et l'empreinte de chaque élément.
