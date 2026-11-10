# Moteur Rust, sous-projet 1 (chiffrement et format) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remplacer `web/src/crypto/` et `web/src/transfer/link.ts` par un moteur Rust compilé en WebAssembly, sans changer le comportement du site, et mesurer la vitesse avant et après.

**Architecture:** espace de travail Cargo `engine/` : `shhdrop-core` (logique pure, fournisseur de plateforme abstrait) et `shhdrop-wasm` (liaison wasm-bindgen, fournisseur appelant WebCrypto). Couche TypeScript `web/src/engine/` qui charge le `.wasm` avec contrôle d'intégrité et garde les signatures actuelles. Vecteurs de test produits par l'ancien moteur, puis comparés octet pour octet.

**Tech Stack:** Rust 1.97 (stable), wasm32-unknown-unknown, wasm-bindgen 0.2.130, RustCrypto (hkdf 0.13, sha2, hmac, argon2 0.6, subtle 2.6, aes-gcm 0.11 en test et natif seulement), zeroize 1.9, serde/serde_json, base64, unicode-normalization ; Vite 8, vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-11-10-moteur-rust-1-chiffrement-design.md` (validée le 10 novembre ; décisions D42-20, approche A).

## Global Constraints

- Mêmes octets que l'ancien moteur à aléa égal : enveloppe, en-tête, nonces, segments, morceau du manifeste, liens (spec §9).
- Étiquettes HKDF exactes : `shhdrop/v2/acces`, `shhdrop/v2/id` (16 octets), `shhdrop/v2/contenu`, `shhdrop/v2/maitre`, `shhdrop/v2/enveloppe`, `shhdrop/v2/preuve`, `shhdrop/v2/element` ; HMAC d'engagement sur `shhdrop/v2/engagement` ; AD : `shhdrop/v2/enveloppe-ad` ‖ id ‖ en-tête (enveloppe), `shhdrop/v2/element-ad` (éléments), en-tête (manifeste). HKDF-SHA-256 à sel vide.
- Format : CHUNK = 65 536, TAG = 16, CHUNK_CT = 65 552, HEADER = 48 (magie `SHH2`, version 2), SEG_CHUNKS = 64, BUCKETS = [1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385, 32769], MANIFEST_MAX = 65 532, MAX_ITEMS = 200, TEXT_MAX = 100 000, PREVIEW_MAX = 200 Mio ; nonce = indice big-endian sur 11 octets ‖ drapeau « dernier ».
- Argon2id : 3 passes, 64 Mio (67 108 864 octets), 1 fil, sortie 32 octets, mot de passe NFC en UTF-8, sel 16 octets ; KDF_MIN = KDF_MAX.
- Mot de passe généré : 11 caractères, alphabet `abcdefghkmnpqrtuvwxy` + `ACDEFGHJKLMNPQRTUVWXY` + `23456789` + `!?@#$%&*+-=/()` (63), exactement 3 spéciaux, quatre familles, tirage par rejet sous 252.
- Manifeste JSON : champs dans l'ordre `v, rights, keep_ttl_h?, items[{kind, name, mime, size, offset, k, clean?}]`, sans espace, comme `JSON.stringify`.
- Erreur unique `paquet_corrompu` pour tout défaut d'ouverture ; mêmes messages d'erreur que les fonctions TypeScript remplacées (`vide`, `manifeste_trop_gros`, `texte_trop_long`, `trop_gros`, `chevauchement`, `place_invalide`, `segment_invalide`, `segment_deja_produit`, `cle_deja_utilisee`, `droits_invalides`, `mot_de_passe_vide`, `mot_de_passe_non_genere`, `paramètres KDF invalides`, `paramètres KDF trop faibles`, `clé ou sel de taille invalide`, `lien_invalide`…).
- Dépendances Rust : uniquement celles du Tech Stack ; `cargo audit` propre ; `Cargo.lock` commité ; `rust-toolchain.toml` = 1.97.0.
- Aucune panique sur entrée hostile ; secrets mis à zéro (`zeroize`) ; comparaisons de secrets par `subtle`.
- Vitesse (spec §2.3) : chiffrement, déchiffrement, Argon2id et poids téléchargé jamais moins bons qu'avant, marge 5 % ; sinon la mise en ligne est bloquée (Argon2id : repli libsodium).
- Commits : `--author="Skoow <190851638+Skoow@users.noreply.github.com>"`, travail sur `main`, tests verts avant chaque push.

## Review Focus

1. **Nom de fichier avec une demi-paire de substitution (surrogate isolé)** : `JSON.stringify` l'écrit `\udXXX` ; un manifeste ancien qui en contient doit s'ouvrir (caractère remplacé par U+FFFD), et le nouveau moteur écrit U+FFFD. Test en Task 6.
2. **Partage créé par l'ancien moteur juste avant la mise en ligne, ouvert après** : vecteur « partage complet » (Task 2) ouvert par le nouveau moteur (Task 8) et par le site (Task 11, e2e).
3. **Lien collé abîmé** (point ou parenthèse collé, clé tronquée, `#M` majuscule, mot de passe du QR après le point) : mêmes refus et mêmes extractions qu'avant (tests de `link.test.ts` portés en Task 3).
4. **Moteur WebAssembly indisponible** (fichier modifié en route, réseau coupé au chargement) : erreur claire « reseau » ou refus d'intégrité, jamais de déchiffrement partiel ni de page figée. Test en Task 10.
5. **Deux opérations en même temps sur un lecteur** (aperçu et téléchargement) : sérialisées comme aujourd'hui, un seul segment en cache. Test en Task 8.

---

### Task 1: Mesure de vitesse de la version actuelle

**Files:**
- Create: `web/bench/index.html`, `web/bench/bench.ts`, `web/bench/run.mjs`, `docs/superpowers/benchmarks/2026-11-10-moteur-avant.json`

**Interfaces:**
- Consumes: API publique actuelle uniquement (`elementSealer`, `openStream`, `contentKeys`, `passwordKey`, `KDF_CREATE` via `web/src/index.ts` ou leurs modules) — la même page servira à la Task 13, donc elle n'importe que des noms gardés par la spec §6.
- Produces: `node web/bench/run.mjs <sortie.json>` : JSON `{ commit, chromium, seal_mib_s, open_mib_s, argon2_ms, send_bytes, open_bytes }` (médiane de 5 passes ; `send_bytes`/`open_bytes` : octets brotli des fichiers chargés pour envoyer et pour ouvrir, lus dans `web/dist`).

- [ ] **Step 1:** écrire `bench.ts` : 128 Mio pseudo-aléatoires à graine fixe ; chiffrement par `elementSealer` (toutes les pièces) ; ouverture du résultat par `openStream` avec un `fetchSegment` en mémoire ; 5 × `passwordKey` avec `KDF_CREATE` ; résultats dans `window.__bench`.
- [ ] **Step 2:** écrire `run.mjs` : construit la page avec Vite (`vite build web/bench --outDir <scratch>`), la sert, la lance dans Chromium (Playwright, `executablePath` si `PW_LOCAL_CHROMIUM=1`), écrit le JSON.
- [ ] **Step 3:** lancer `node web/bench/run.mjs docs/superpowers/benchmarks/2026-11-10-moteur-avant.json` ; attendu : valeurs proches de la revue (≈ 277 Mio/s, ≈ 540 Mio/s, ≈ 250 ms).
- [ ] **Step 4:** commit `bench: mesure de référence du moteur TypeScript`.

### Task 2: Vecteurs de test produits par l'ancien moteur

**Files:**
- Create: `web/scripts/gen-vectors.ts`, `engine/vectors/v2.json`, `web/src/engine/vectors.test.ts`

**Interfaces:**
- Produces: `engine/vectors/v2.json` = `{ hkdf[], sha256[], argon2id[], access[], content[], envelope[], header[], nonce[], password[], link[], manifest[], share }` ; chaque cas : entrées en hex/base64url et sorties attendues. `share` : un partage complet (note de 10 octets, fichier de 3 Mio, fichier de 9 Mio sur trois segments, droits `enregistrer`) avec K_lien, mot de passe, sel, R, graines k_i fixés, et tous les segments chiffrés en base64.

- [ ] **Step 1:** test `vectors.test.ts` « l'ancien moteur redonne chaque vecteur » (il échoue tant que `v2.json` n'existe pas).
- [ ] **Step 2:** `gen-vectors.ts` : remplace `crypto.getRandomValues` par une suite connue (SHA-256 en mode compteur sur une graine fixe) et appelle l'ancien moteur ; écrit `v2.json` (clés triées, LF final).
- [ ] **Step 3:** `npx vitest run src/engine/vectors.test.ts` vert ; relancer le générateur deux fois → fichier identique.
- [ ] **Step 4:** commit `test(engine): vecteurs de référence produits par le moteur TypeScript`.

### Task 3: Espace de travail Rust, encodage, lien, mot de passe

**Files:**
- Create: `engine/Cargo.toml` (workspace), `engine/rust-toolchain.toml`, `engine/core/Cargo.toml`, `engine/core/src/{lib.rs,error.rs,encoding.rs,link.rs,password.rs}`, `engine/core/tests/vectors.rs`

**Interfaces:**
- Produces: `pub enum Error` (une variante par message des Global Constraints, `Display` = le message exact) ; `encoding::{b64u(&[u8]) -> String, unb64u(&str) -> Result<Vec<u8>>}` ; `link::{ParsedLink, parse_link(url:&str, base:&str) -> Result<ParsedLink>, share_link(origin, &KLien, base) -> String, manage_link(..), share_link_with_password(link, pw) -> Result<String>, split_password(href) -> (String, Option<String>), check_origin(&str) -> Result<String>}` ; `password::{generate(rng: &mut impl FnMut(&mut [u8])) -> String, is_generated(&str) -> bool}`. Types `KLien`, `SGestion` : `[u8; 32]` enveloppés, `Zeroize` à la destruction.

- [ ] **Step 1:** `tests/vectors.rs` : cas `link` et `password` de `v2.json`, plus les cas de `web/src/transfer/link.test.ts` et `crypto/password.test.ts` portés (Review Focus 3).
- [ ] **Step 2:** `cargo test -p shhdrop-core` → échec (fonctions absentes).
- [ ] **Step 3:** implémenter ; `check_origin` avec la crate `url` n'est pas permise : analyse manuelle `https://hôte[:port]` ou `http://localhost|127.0.0.1|[::1]` comme `link.ts`.
- [ ] **Step 4:** `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` verts.
- [ ] **Step 5:** commit `feat(engine): espace de travail Rust, liens et mot de passe généré`.

### Task 4: Dérivations et Argon2id, avec la mesure qui décide

**Files:**
- Create: `engine/core/src/kdf.rs`, `engine/core/benches/argon2.rs` (ou test `#[ignore]` chronométré), `engine/wasm/` minimal pour mesurer Argon2id dans Chromium
- Modify: `engine/core/tests/vectors.rs`

**Interfaces:**
- Produces: `kdf::{hkdf(ikm:&[u8], info:&str, len:usize) -> Zeroizing<Vec<u8>>, sha256(&[u8]) -> [u8;32], derive_access(&KLien) -> AccessKeys{k_acces, v_acces}, check_kdf_params(ops:u32, mem:u32) -> Result<()>, password_key(pw:&str, salt:&[u8], ops, mem) -> Result<KMdp>, password_key_for_create(pw, salt) -> Result<KMdp>}`.

- [ ] **Step 1:** tests des cas `hkdf`, `sha256`, `argon2id`, `access` de `v2.json` et des refus (paramètres, sel, mot de passe vide ou non généré).
- [ ] **Step 2:** échec, puis implémentation (`hkdf`, `sha2`, `argon2` en Argon2id v0x13, `unicode-normalization` NFC).
- [ ] **Step 3:** mesure : Argon2id compilé en wasm dans Chromium, médiane de 5, comparée à `argon2_ms` de la Task 1. **Si plus lent de plus de 5 %** : garder `web/src/crypto/argon2*.ts` (libsodium) pour ce seul calcul, le noter dans le rapport (Task 13) et prévenir le propriétaire ; `password_key` reçoit alors la sortie Argon2id du fournisseur (méthode `argon2id` ajoutée au fournisseur, Task 5).
- [ ] **Step 4:** commit `feat(engine): dérivations HKDF, SHA-256 et Argon2id`.

### Task 5: Fournisseur de plateforme et enveloppe

**Files:**
- Create: `engine/core/src/platform.rs`, `engine/core/src/envelope.rs`, `engine/core/src/native.rs` (fournisseur RustCrypto, `cfg(not(target_arch = "wasm32"))`)

**Interfaces:**
- Produces: `trait Platform { fn random(&self, out: &mut [u8]); fn aes_import(&self, key: Zeroizing<[u8;32]>) -> impl Future<Output = Result<KeyHandle>>; fn aes_seal_batch(&self, k: KeyHandle, ad: &[u8], nonces: &[[u8;12]], plain: &[u8], chunk: usize) -> impl Future<Output = Result<Vec<u8>>>; fn aes_open_batch(&self, k, ad, nonces, cipher, chunk_ct) -> impl Future<Output = Result<Vec<u8>>>; fn aes_drop(&self, k: KeyHandle); }` (sans `Send`) ; `envelope::{new_seed, content_keys(&P, &Seed) -> ContentKeys{k_contenu: KeyHandle, engagement:[u8;32]}, content_keys_checked(&P, &Seed, &[u8]) -> Result<ContentKeys>, share_id(&KLien) -> [u8;16], access_keys(&P, &KLien, &KMdp) -> AccessKeys{k_env, k_preuve, v_preuve}, seal(&P, k_env, &Seed, id, header) -> Vec<u8>, open(&P, k_env, e, id, header) -> Result<Seed>}`. `native::RustCrypto` implémente `Platform`.

- [ ] **Step 1:** tests `content`, `envelope` de `v2.json` avec `native::RustCrypto` et un `random` déterministe ; refus : engagement faux, enveloppe modifiée → `paquet_corrompu`.
- [ ] **Step 2:** échec, implémentation ; un chiffré par lot = concaténation des morceaux, chacun `chunk + 16` octets.
- [ ] **Step 3:** commit `feat(engine): fournisseur de plateforme et enveloppe`.

### Task 6: Format : paliers, en-tête, nonces, manifeste

**Files:**
- Create: `engine/core/src/format.rs`, `engine/core/src/manifest.rs`

**Interfaces:**
- Produces: constantes des Global Constraints ; `bucket_for(data_end:u64) -> u32`, `segment_count(bucket) -> u32`, `segment_size(bucket, n) -> usize`, `header(&[u8;32]) -> [u8;48]`, `read_header(&[u8]) -> Result<([u8;48],[u8;32])>`, `nonce(index:u64, last:bool) -> [u8;12]` ; `manifest::{Manifest, Entry, Rights, Clean, parse(&[u8]) -> Result<Manifest>, to_json(&Manifest) -> Vec<u8>}`.

- [ ] **Step 1:** tests `header`, `nonce`, `manifest` de `v2.json`, cas de `container.test.ts` sur les paliers et le manifeste (bornes, droits, `keep_ttl_h`, `clean` inconnu ignoré), plus Review Focus 1 (surrogate isolé : ancien `\ud800` lu comme U+FFFD ; écrit U+FFFD).
- [ ] **Step 2:** échec, implémentation (`serde_json` ; pré-passage qui remplace un `\udXXX` isolé par `�` avant l'analyse).
- [ ] **Step 3:** commit `feat(engine): format des partages et manifeste`.

### Task 7: Éléments et manifeste final

**Files:**
- Create: `engine/core/src/elements.rs`

**Interfaces:**
- Produces: `segments_for`, `reservation_for`, `chunks_for`, `is_small`, `footprint_for`, `segments_needed` (mêmes formules que `elements.ts`) ; `ElementSealer::new(&P, size:u64, first:u64) -> Result<ElementSealer>` avec `k() -> [u8;32]`, `pieces() -> &[Piece{seg, from, chunks}]`, `async piece(&P, j, plain:&[u8]) -> Result<Vec<u8>>` (`plain` = octets de la plage lus par l'hôte, zéros ajoutés par le moteur au-delà de la fin) ; `seal_final(&P, entries:&[FinalEntry], &ContentKeys, rights, keep_ttl) -> Result<{bucket, header:[u8;48], tail:Vec<u8>}>`.

- [ ] **Step 1:** tests : segments du vecteur `share` reproduits octet pour octet ; cas de `elements.test.ts` (places invalides, pièce produite deux fois, clé de manifeste réutilisée).
- [ ] **Step 2:** échec, implémentation (chiffrement d'une pièce = un seul `aes_seal_batch` de ses morceaux).
- [ ] **Step 3:** commit `feat(engine): chiffrement des éléments et manifeste final`.

### Task 8: Ouverture en flux

**Files:**
- Create: `engine/core/src/reader.rs`

**Interfaces:**
- Produces: `trait Segments { fn fetch(&self, n:u32) -> impl Future<Output = Result<Vec<u8>>>; }` ; `Reader::open(&P, src: S, bucket:u32, &ContentKeys) -> Result<Reader>` ; `manifest() -> &Manifest` ; `async item(i) -> Result<Vec<u8>>` (refus au-delà de PREVIEW_MAX : `trop_gros_pour_apercu`) ; `async stream_item(i, sink: impl AsyncFnMut(Vec<u8>) -> Result<()>) -> Result<()>` ; `wipe()`. Un seul segment en cache ; opérations sérialisées.

- [ ] **Step 1:** tests : vecteur `share` ouvert (Review Focus 2) ; segment tronqué, échangé, palier annoncé faux, morceau « dernier » déplacé → `paquet_corrompu` ; deux opérations simultanées sérialisées (Review Focus 5) ; 400 altérations à graine fixe : jamais de panique.
- [ ] **Step 2:** échec, implémentation.
- [ ] **Step 3:** commit `feat(engine): ouverture en flux`.

### Task 9: Liaison WebAssembly et fournisseur WebCrypto

**Files:**
- Create: `engine/wasm/Cargo.toml`, `engine/wasm/src/lib.rs`, `web/src/engine/provider.ts`, `web/src/engine/load.ts`, `web/scripts/build-engine.mjs`
- Modify: `web/package.json` (script `build:engine`, appelé avant `build`)

**Interfaces:**
- Consumes: Tasks 3 à 8.
- Produces: exports wasm-bindgen (classes `JsElementSealer`, `JsReader`, fonctions des Tasks 3 à 7) qui prennent un objet JS fournisseur `{ random(n), aesImport(raw), aesSealBatch(h, ad, nonces, plain, chunk), aesOpenBatch(…), aesDrop(h) }` ; `provider.ts` l'implémente avec WebCrypto (clés non extractibles, `Promise.all` par lot) ; `build-engine.mjs` : `cargo build --release --target wasm32-unknown-unknown` puis `wasm-bindgen 0.2.130 --target web`, sortie dans `web/src/engine/pkg/` (ignoré par git, reconstruit) ; `load.ts` : `loadEngine(): Promise<Engine>` une seule fois.

- [ ] **Step 1:** test vitest `engine.test.ts` : le moteur wasm, avec le fournisseur WebCrypto, redonne tous les vecteurs de `v2.json` (prouve WebCrypto ≡ RustCrypto).
- [ ] **Step 2:** échec, implémentation ; `wasm-bindgen-cli` installé à la version exacte par `cargo install --locked`.
- [ ] **Step 3:** commit `feat(engine): moteur WebAssembly et fournisseur WebCrypto`.

### Task 10: Chargement vérifié dans le site

**Files:**
- Modify: `web/vite.config.ts` (greffon `shh-engine` sur le modèle de `shh-argon2` : fichier `assets/engine-EMPREINTE.wasm`, adresse et SHA-384 dans un module virtuel `virtual:shh-engine`), `web/scripts/check-dist.mjs` (tout `.wasm` cité doit avoir son empreinte dans le script principal), `web/src/engine/load.ts`
- Test: `web/scripts/check-dist.test.ts`, `web/ui-e2e/hygiene.spec.ts`

**Interfaces:**
- Produces: `loadEngine()` lit le `.wasm` par `fetch(src, { integrity, credentials: "omit", redirect: "error" })` puis `WebAssembly.instantiate` ; démo : `.wasm` intégré au build de démo (pas de `fetch`).

- [ ] **Step 1:** tests : `check-dist` refuse un `.wasm` sans empreinte ; Playwright : un `.wasm` modifié d'un octet en route → aucun déchiffrement, message d'erreur réseau (Review Focus 4) ; accueil : aucun `.wasm` chargé.
- [ ] **Step 2:** échec, implémentation, `npm run build && node scripts/check-dist.mjs` et `--demo` conformes.
- [ ] **Step 3:** commit `feat(engine): moteur chargé à la demande avec contrôle d'intégrité`.

### Task 11: Bascule du site et suppression de l'ancien moteur

**Files:**
- Create: `web/src/engine/index.ts` (mêmes noms et signatures que la spec §6, au-dessus de `loadEngine`)
- Modify: imports de `transfer/{client,draft,api,safety}.ts`, `limits.ts`, `index.ts`, `demo/fake-server.ts`
- Delete: `web/src/crypto/{kdf,envelope,container,elements,password,passphrase,wordlist-eff,encoding,types}.ts` et leurs tests, `web/src/transfer/link.ts` et son test (cas déjà portés), et `crypto/argon2*` sauf repli décidé en Task 4
- Test: toute la suite existante

- [ ] **Step 1:** basculer les imports ; types `kContenu`/`kEnv` → poignées.
- [ ] **Step 2:** `npm test`, `npm run check`, `make test-e2e`, Playwright Chromium complet (`--trace off`), test « le serveur ne voit rien » : verts **sans changer une attente** ; e2e : ouverture d'un partage du vecteur `share` (créé par l'ancien moteur) servi par le vrai serveur.
- [ ] **Step 3:** supprimer l'ancien code ; relancer la même suite.
- [ ] **Step 4:** commit `feat(engine): le site utilise le moteur Rust ; ancien moteur TypeScript supprimé`.

### Task 12: CI, build reproductible, dépendances

**Files:**
- Modify: `.github/workflows/ci.yml` (job `engine` : `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `cargo audit` ; cible wasm et `wasm-bindgen-cli` épinglés dans les jobs web, e2e, ui, repro), `.github/dependabot.yml` (écosystème `cargo`, cooldown 7 jours), `web/scripts/repro.sh` (le `.wasm` est dans les empreintes comparées), `Makefile` (`test-engine`), `.gitignore` (`engine/target`, `web/src/engine/pkg`)

- [ ] **Step 1:** `web/scripts/repro.sh` vert en local (deux builds, mêmes empreintes, `.wasm` compris).
- [ ] **Step 2:** commit, push ; CI verte (hors échecs WebKit déjà connus, à comparer à la liste du 10 novembre).

### Task 13: Mesure après, rapport, spécification

**Files:**
- Create: `docs/superpowers/benchmarks/2026-11-10-moteur-apres.json`, `docs/superpowers/benchmarks/2026-11-10-moteur-rapport.md`
- Modify: `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (§42 : D42-21, moteur Rust en service), `CLAUDE.md` seulement si le repli libsodium a été retenu

- [ ] **Step 1:** `node web/bench/run.mjs docs/superpowers/benchmarks/2026-11-10-moteur-apres.json` sur le même Chromium.
- [ ] **Step 2:** rapport : tableau avant/après des quatre mesures, écart en %, verdict par mesure (gagné, égal, perdu) ; une mesure perdue de plus de 5 % bloque la mise en ligne et est corrigée avant le push final.
- [ ] **Step 3:** commit `docs: mesures avant et après le moteur Rust`, push.
