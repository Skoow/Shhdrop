# Moteur Rust, sous-projet 1 : chiffrement et format des partages

Date : 10 novembre 2026 · Statut : à valider par le propriétaire
Spécification de référence : `2026-11-03-shhdrop-design.md` (D42-20 : moteur commun en Rust pour le site et les futures apps).

## 1. Objectif

Remplacer le chiffrement et le format des partages du site, écrits aujourd'hui en TypeScript (`web/src/crypto/`, `web/src/transfer/link.ts`), par un moteur écrit en Rust, compilé en WebAssembly pour le site. Le même moteur servira tel quel aux apps iOS et Android (plus tard, Flutter par flutter_rust_bridge).

Décisions du propriétaire (10 novembre) :
- le moteur est écrit maintenant, pour ne pas faire le travail deux fois ;
- trois sous-projets, mis en ligne chacun seul : (1) chiffrement et format, (3) nettoyage des fichiers, (2) envoi et réception ; celui-ci est le premier ;
- **approche A** : le moteur décide de tout, l'opération AES-GCM elle-même est fournie par la plateforme (WebCrypto sur le site, pour la vitesse ; RustCrypto dans les apps) ;
- le serveur Go ne change pas ; l'interface Svelte ne change pas.

## 2. Critères de réussite

1. Le site se comporte exactement comme avant : les tests existants (vitest, e2e, Playwright, « le serveur ne voit rien ») passent **sans changer leurs attentes**.
2. Compatibilité dans les deux sens : un partage créé par l'ancien moteur TypeScript s'ouvre avec le moteur Rust, et l'inverse, prouvé par des vecteurs de test octet pour octet.
3. Vitesse : chiffrement et déchiffrement au moins aussi rapides qu'aujourd'hui (mesure de la revue : 277 Mio/s en envoi, 542 Mio/s en lecture, Chromium, CPU ×1). Argon2id au plus 1,5 fois plus lent qu'aujourd'hui (≈ 0,25 s).
4. Le code TypeScript remplacé est supprimé (pas deux moteurs en parallèle).

## 3. Périmètre

**Passe en Rust**

| Module actuel | Contenu |
|---|---|
| `crypto/kdf.ts` | HKDF-SHA-256, SHA-256, dérivation de K_accès et V_accès, Argon2id (bornes KDF_MIN = KDF_MAX = 3 passes, 64 Mio), K_mdp pour créer et pour ouvrir |
| `crypto/envelope.ts` | graine R, K_contenu, engagement, id du partage, K_env, K_preuve, V_preuve, enveloppe E (scellement, ouverture) |
| `crypto/container.ts` (sauf `sealStream`) | constantes du format, paliers, tailles de segment, en-tête, nonces, manifeste (lecture, validation, droits), ouverture en flux (vérifications, déchiffrement, cache d'un segment) |
| `crypto/elements.ts` | tailles, emprises, places, réservations, clé par élément, chiffrement d'un élément par plages, manifeste final |
| `crypto/password.ts` | mot de passe généré (11 caractères, 63 symboles, 3 spéciaux) et sa vérification |
| `crypto/encoding.ts` | base64url, UTF-8 (côté Rust : bibliothèques standard) |
| `transfer/link.ts` | lien de partage et de gestion : écriture, lecture, vérification de forme, mot de passe dans le « # » (QR) |

**Reste en TypeScript (lien avec le navigateur)**
- lecture des `Blob` choisis et transmission des octets au moteur ;
- AES-GCM par WebCrypto (fournisseur, §5) et nombres aléatoires par `crypto.getRandomValues` ;
- chargement vérifié du moteur (§7) ;
- tout `web/src/transfer/` hors `link.ts`, `web/src/media/`, `web/src/viewers/` (sous-projets 2 et 3).

**Supprimé sans être porté (code mort, revue du 10 novembre)**
- `crypto/passphrase.ts`, `crypto/wordlist-eff.ts` (aucun appelant hors tests) ;
- `sealStream` et la lecture de l'ancien format (entrées sans `k`) : aucun partage de cet ancien format ne peut encore exister (24 h de vie au plus, plus 2 h de grâce).

**Hors périmètre** : apps, interface Svelte, serveur, envoi et réception (sous-projet 2), nettoyage (sous-projet 3), `web/src/vault/` (gardé, non utilisé).

## 4. Organisation

```
engine/                      espace de travail Cargo (Cargo.lock commité, rust-toolchain.toml épinglé)
  core/                      crate shhdrop-core : aucune dépendance au navigateur ni au système
  wasm/                      crate shhdrop-wasm : liaison WebAssembly (wasm-bindgen), fournisseur WebCrypto
  vectors/                   vecteurs de test communs (JSON), lus par Rust et par TypeScript
web/src/engine/              couche TypeScript fine : chargement du moteur, fournisseur, mêmes signatures qu'avant
```

`shhdrop-core` n'utilise ni `std::fs`, ni le réseau, ni l'horloge : tout ce qui vient du monde extérieur passe par le fournisseur. Une crate `shhdrop-ffi` (Flutter) viendra avec les apps, pas maintenant.

## 5. Fournisseur de la plateforme

Le moteur ne fait lui-même ni AES ni tirage aléatoire. Il appelle un fournisseur, une interface que chaque plateforme implémente :

| Fonction | Site (TypeScript) | Apps (plus tard) |
|---|---|---|
| `random(n) → octets` | `crypto.getRandomValues` | générateur du système (crate `getrandom`) |
| `aes_import(clé 32 octets) → poignée` | `importKey("raw", …, "AES-GCM", false)` : clé non extractible | RustCrypto `aes-gcm` |
| `aes_seal(poignée, nonce, ad, clair) → chiffré` | `crypto.subtle.encrypt` | RustCrypto |
| `aes_open(poignée, nonce, ad, chiffré) → clair ou échec` | `crypto.subtle.decrypt` | RustCrypto |
| `aes_drop(poignée)` | oublie la clé | met la clé à zéro |

- Les fonctions AES sont **asynchrones** (WebCrypto l'est) ; le moteur les appelle en parallèle pour les 64 morceaux d'une plage, comme aujourd'hui.
- Une poignée est un entier opaque. Côté site, la table des `CryptoKey` vit dans la couche TypeScript ; aucune clé AES ne retourne en clair vers JavaScript.
- Le moteur dérive les clés (HKDF), les passe une seule fois à `aes_import`, puis met ses octets à zéro.
- Un échec de `aes_open` devient l'erreur unique « paquet corrompu » (pas d'oracle).

HKDF-SHA-256, SHA-256, HMAC-SHA-256 et Argon2id sont faits **dans le moteur**, partout, avec les crates RustCrypto `hkdf`, `sha2`, `hmac`, `argon2`. Le fournisseur natif (tests Rust aujourd'hui, apps plus tard) utilise `aes-gcm` (RustCrypto) ; il n'entre pas dans le `.wasm` du site. Les comparaisons de secrets passent par la crate `subtle` (temps constant). Si Argon2id en Rust dépasse 1,5 fois la durée actuelle (critère 3), le plan le mesure d'abord ; à défaut, on garde temporairement libsodium pour ce seul calcul, et le propriétaire est prévenu.

## 6. Interface vers le site

La couche `web/src/engine/` expose **les mêmes fonctions, avec les mêmes signatures et les mêmes erreurs** que les modules remplacés (`deriveAccess`, `passwordKey`, `passwordKeyForCreate`, `contentKeys`, `contentKeysChecked`, `accessKeys`, `seal`, `open`, `shareId`, `openStream`, `elementSealer`, `sealFinal`, `generatePassword`, `isGeneratedPassword`, `parseLink`, `shareLink`, `manageLink`, `splitPassword`, constantes du format…). Les fichiers qui les importent (`transfer/client.ts`, `transfer/draft.ts`, `transfer/api.ts`, `transfer/safety.ts`, `limits.ts`, `index.ts`, `demo/fake-server.ts`) changent seulement leur chemin d'import.

Changements de types inévitables, sans effet pour l'interface Svelte :
- `ContentKeys.kContenu` et `AccessKeys.kEnv` deviennent des poignées opaques au lieu de `CryptoKey` ;
- les fonctions de calcul pur (tailles, paliers, nonces) deviennent synchrones côté moteur ; la couche garde leur forme actuelle.

## 7. Chargement et sécurité dans le navigateur

- Le moteur compilé est un fichier `assets/engine-EMPREINTE.wasm`, lu par `fetch` avec `integrity` (empreinte SHA-384 inscrite dans le script principal, comme Argon2id, D42-14), puis instancié. `check-dist.mjs` refuse un `.wasm` cité sans son empreinte.
- Il est chargé dès le premier besoin (lecture d'un lien, premier fichier ajouté) ; la page d'accueil n'en a pas besoin. Les fonctions qui lisent un lien à l'ouverture de la page attendent le chargement (une seule fois).
- CSP : `script-src 'self' 'wasm-unsafe-eval'` permet déjà WebAssembly ; rien à ajouter. Trusted Types ne s'applique pas à `WebAssembly.instantiate`.
- Démo (GitHub Pages, `connect-src 'none'`) : le moteur y est intégré au script de la démo, comme libsodium aujourd'hui.
- Mémoire : les clés et les clairs que le moteur manipule sont mis à zéro après usage (crate `zeroize`). Limite connue, déjà vraie aujourd'hui : les noms du manifeste deviennent des chaînes JavaScript, impossibles à effacer.
- Erreurs : le moteur ne panique pas sur une entrée hostile ; toute erreur est une valeur. Une panique éventuelle (bogue) est convertie en « paquet corrompu », jamais en message qui révèle quelque chose. Tailles bornées comme aujourd'hui (manifeste ≤ 65 532 octets, 200 éléments, paliers fixes).

## 8. Règle crypto (CLAUDE.md) — à valider

Actuel : « site : WebCrypto et libsodium ». Proposé : « site : WebCrypto pour AES-GCM et les nombres aléatoires, bibliothèques Rust reconnues (RustCrypto : hkdf, sha2, hmac, argon2, subtle) pour le reste ; apps : RustCrypto, libsodium ou bibliothèques du système ». Le reste de la règle (aucune crypto maison, paramètres de la spécification, vecteurs de test communs) ne change pas.

## 9. Vecteurs de test communs

- `engine/vectors/` : fichiers JSON produits **par l'ancien moteur TypeScript avant sa suppression**, avec des entrées fixées (clés, graines, sels, aléa remplacé par une suite connue) : dérivations (K_accès, V_accès, K_mdp, K_contenu, engagement, id, K_env, K_preuve, V_preuve), enveloppes, en-têtes, nonces, manifestes, segments chiffrés d'un petit partage complet (texte + deux fichiers, dont un sur plusieurs segments), liens.
- Tests Rust (`cargo test`) : le moteur redonne chaque sortie octet pour octet, avec le fournisseur RustCrypto.
- Tests TypeScript (vitest) : le moteur WebAssembly, avec le fournisseur WebCrypto, redonne les mêmes sorties. Les deux fournisseurs sont donc prouvés équivalents.
- Partage croisé : avec le même aléa (suite connue), le nouveau moteur doit produire **exactement les mêmes octets** que l'ancien pour un même partage (enveloppe, en-tête, segments, morceau du manifeste). Le manifeste JSON est donc écrit dans le même ordre de champs, sans espace, comme `JSON.stringify` aujourd'hui. Des octets identiques prouvent la compatibilité dans les deux sens ; en plus, un partage de l'ancien moteur est ouvert par le nouveau.
- Ces vecteurs deviennent la référence pour les apps.

## 10. Tests et CI

- Rust : `cargo test`, `cargo clippy -D warnings`, `cargo fmt --check`, test de fuzz léger (`cargo test` avec entrées tronquées ou altérées : jamais de panique, toujours « paquet corrompu ») sur l'ouverture, le manifeste et le lien.
- Site : toute la suite existante (`npm test`, `make test-e2e`, Playwright, « le serveur ne voit rien »), attentes inchangées ; les tests unitaires des modules supprimés sont remplacés par les mêmes cas contre la couche `web/src/engine/`.
- Build reproductible : `rust-toolchain.toml` et versions de `wasm-bindgen` épinglées, `Cargo.lock` commité ; `web/scripts/repro.sh` couvre le `.wasm`.
- Dépendances Rust : liste fermée (§5), `cargo audit` en CI, cooldown de 7 jours dans Dependabot comme pour npm et Go.
- Mesures de vitesse (critère 3) : banc Playwright sur Chromium, chiffrement et déchiffrement de 128 Mio, Argon2id.

## 11. Risques

| Gravité | Risque | Parade |
|---|---|---|
| Haute | Une différence de format casse l'ouverture des partages en cours au moment de la mise en ligne | Vecteurs croisés (§9) ; tests e2e d'ouverture d'un partage créé par l'ancien moteur |
| Moyenne | Coût d'un appel WebCrypto par morceau depuis WebAssembly (aller-retour JavaScript) | Appels groupés par plage de 64 morceaux ; mesure avant la mise en ligne (critère 3) |
| Moyenne | Argon2id RustCrypto plus lent que libsodium dans le navigateur | Mesure d'abord ; repli temporaire sur libsodium (§5) |
| Moyenne | Nouvelle chaîne d'outils (Rust, wasm-bindgen) dans la CI et le build reproductible | Versions épinglées, contrôle dans `repro.sh` |
| Faible | Taille du `.wasm` | Chargé à la demande ; mesuré dans le plan |

## 12. Ce qui suivra

Sous-projet 3 (nettoyage des fichiers en Rust), puis sous-projet 2 (envoi et réception : brouillon, envoi par morceaux, ouverture et octrois ; le transport HTTP restera fourni par la plateforme, comme l'AES). Chacun aura sa spécification.
