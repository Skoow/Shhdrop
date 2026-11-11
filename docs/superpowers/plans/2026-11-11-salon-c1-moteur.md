# Salon v3, étape C-1 : moteur Rust du salon — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un crate Rust `shhdrop-salon` (et sa liaison WebAssembly séparée) qui porte tout le protocole du salon : clés, enveloppe de taille fixe, groupe MLS, formats des messages, règles d'effacement, identique pour le site et les futures apps.

**Architecture :** nouveau crate `engine/salon` (sans navigateur, comme `shhdrop-core`, dont il réutilise HKDF et Argon2id) au-dessus d'OpenMLS 0.9.2 avec le fournisseur RustCrypto et un stockage en mémoire qui efface. Une liaison `engine/salon-wasm` produit un second module `.wasm`, chargé avec contrôle d'empreinte seulement sur les pages du salon ; le module des partages ne grossit pas.

**Tech Stack :** Rust 1.99.1 (édition 2024), openmls =0.9.2, openmls_rust_crypto =0.6.0, openmls_basic_credential =0.6.0, openmls_traits =0.6.0, chacha20poly1305 (RustCrypto), unicode-segmentation, unicode-script, serde_json, zeroize ; wasm-bindgen =0.2.130 ; vitest et Playwright (Chromium) côté site.

**Spec :** `docs/superpowers/specs/2026-11-11-salon-v3-design.md` (§3, §4, §5, §5.1, §7, §10) et, pour ce qui n'y change pas, `docs/superpowers/specs/2026-11-03-shhdrop-design.md` §39.2.1, §39.2.3, §39.4 (point 4), §39.5. Rapport de l'essai : spec v3 §3.6.

## Global Constraints

- CLAUDE.md : aucune crypto maison ; bibliothèques reconnues (RustCrypto, OpenMLS sur RustCrypto) ; le site et les apps donnent les mêmes résultats, prouvés par vecteurs communs ; tests avant tout « fait » ; commits `--author="Skoow <190851638+Skoow@users.noreply.github.com>"`, travail sur `main`, tests verts avant push.
- `#![forbid(unsafe_code)]` dans `shhdrop-salon` (comme `shhdrop-core`).
- Toute dépendance : version exacte publiée depuis **au moins 7 jours** (épingler plus ancien avec `cargo update --precise` si une dépendance transitive est plus récente) ; `cargo audit --deny warnings` vert, exceptions justifiées dans `engine/.cargo/audit.toml`.
- Suite MLS : **MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 (0x0001)** seulement. `PURE_CIPHERTEXT`. Arbre dans le Welcome, aucun GroupInfo publié, **external commits refusés**. `max_past_epochs = 1`.
- Feature `js` d'openmls et `getrandom` js/wasm_js **seulement** pour `target_arch = "wasm32"`, jamais en natif.
- Étiquettes HKDF (spec §39.2.1) : `shhdrop/v2/salon/acces`, `shhdrop/v2/salon/maitre`, `shhdrop/v2/salon/preuve`, `shhdrop/v2/salon/cle`, `shhdrop/v2/salon/trame`, `shhdrop/v2/salon/id` ; exporteur MLS : étiquette `shhdrop/v2/salon/sframe`, 32 octets.
- Trame : **4 140 octets** exactement ; partie chiffrée `O` de **4 095 octets**.
- Texte : NFC ; contrôles C0/C1 retirés sauf `\n` ; U+202A–U+202E et U+2066–U+2069 retirés ; 1 à 2 000 graphèmes et 3 500 octets UTF-8 au plus. Extrait de réponse : 140 graphèmes au plus. Pseudonyme : règles de §39.4 point 4 (2 à 24 graphèmes, une seule écriture, pas d'émoji).
- Erreurs : une variante par cause dans `shhdrop_salon::Error`, `Display` en `snake_case` français (comme `texte_invalide`) ; toute ouverture de trame ratée donne **une seule** erreur `trame_corrompue` (aucun oracle).
- Poids : module wasm du salon ≤ **400 Ko brotli** (essai : 359 Ko).
- Les secrets (clés de salon, état MLS) sont effacés à la destruction (`Zeroizing`, `ZeroizeOnDrop`).

## Review Focus

1. Commit concurrent : deux membres font un Commit sur la même époque → le premier dans l'ordre `seq` gagne chez **tous**, le perdant rejoue ses propositions, aucun membre ne reste sur une branche (Task 6, test `commits_concurrents`).
2. Trame d'une autre époque reçue juste après un Commit (message envoyé avant, rangé après) → déchiffrée grâce à `max_past_epochs = 1` ; deux époques plus tard → refus propre `epoque_perdue`, pas de panique (Task 6).
3. Entrées hostiles : trame de mauvaise taille, en-tête altéré (règle ou bit volatil changés par le serveur), `len` > 4 093, octets MLS aléatoires, JSON avec champ en trop ou sorte inconnue → erreur typée, jamais de panique (Tasks 4, 5, 6 ; fuzz léger de 100 000 entrées en Task 8).
4. Commit qui retire un membre sans être le créateur, ou ajoute une feuille sans siège annoncé → refusé avant fusion par la politique, l'état du groupe ne change pas (Task 6, `politique_refuse`).
5. Rechargement : le même participant revient avec une nouvelle identité → l'ancienne feuille est retirée et la nouvelle ajoutée, les autres continuent de déchiffrer (Task 6, `retour_nouvelle_feuille`).

---

### Task 1 : crate `shhdrop-salon`, dépendances épinglées, compilation wasm32

**Files :**
- Create : `engine/salon/Cargo.toml`, `engine/salon/src/lib.rs`, `engine/salon/src/error.rs`, `engine/salon/tests/fumee.rs`
- Modify : `engine/Cargo.toml` (membre `salon`, `[profile.dev.package.*]` opt-level 3 pour `openmls`, `openmls_rust_crypto`, `hpke-rs`, `curve25519-dalek`, `ed25519-dalek`, `aes-gcm`, `sha2`), `engine/Cargo.lock`, `engine/.cargo/audit.toml`, `Makefile` (`test-engine` : clippy de `shhdrop-salon` en wasm32), `.github/workflows/ci.yml` (job engine : même clippy), `THIRD_PARTY_LICENSES.md`
- Test : `engine/salon/tests/fumee.rs`

**Interfaces :**
- Produces : `shhdrop_salon::Error` (enum, `Display` snake_case), `shhdrop_salon::Result<T>`.

- [ ] **Step 1 : test de fumée** — `fumee::deux_membres_echangent` : avec les API OpenMLS directes (MemoryStorage d'OpenMLS, provisoirement), Alice crée un groupe suite 0x0001, ajoute Bob (KeyPackage, Commit, Welcome), Alice chiffre `b"bonjour"`, Bob déchiffre `b"bonjour"`.
- [ ] **Step 2 :** `cargo test -p shhdrop-salon` → échec (crate absent).
- [ ] **Step 3 :** créer le crate avec les versions exactes de « Tech Stack » ; getrandom 0.2 (`js`) et 0.4 (`wasm_js`) en dépendances de cible wasm32 comme dans l'essai ; `cargo update --precise` pour toute transitive de moins de 7 jours (l'essai a trouvé const-oid 0.10.3, syn 3.0.10, itoa 1.0.19) ; exceptions `audit.toml` avec la raison en commentaire (crypto-bigint : compilé pour P-256/P-384, jamais exécuté par la suite 0x0001 ; libcrux-kem : dépendance de dev ; proc-macro-error2 : compilation seulement).
- [ ] **Step 4 :** `cargo test -p shhdrop-salon --locked` PASS ; `cargo clippy -p shhdrop-salon --target wasm32-unknown-unknown --locked -- -D warnings` PASS ; `cargo audit --deny warnings` PASS ; `cargo tree -p shhdrop-salon -e features --target x86_64-unknown-linux-gnu | grep -c 'feature "js"'` → 0.
- [ ] **Step 5 :** commit `feat(salon): crate shhdrop-salon, OpenMLS 0.9.2 épinglé`.

### Task 2 : stockage MLS en mémoire qui efface

**Files :**
- Create : `engine/salon/src/stockage.rs` (+ `engine/salon/LICENSE-openmls-memory-storage` si du code MIT d'`openmls_memory_storage` est repris, avec la mention en tête du fichier)
- Test : `engine/salon/src/stockage.rs` (module `tests`)

**Interfaces :**
- Produces : `pub struct Stockage` qui implémente `openmls_traits::storage::StorageProvider<1>` ; `pub struct Fournisseur` qui implémente `openmls_traits::OpenMlsProvider` avec `RustCrypto` (crypto et aléa) et `Stockage`. Toute valeur rangée est un `Zeroizing<Vec<u8>>` ; écraser ou supprimer une entrée efface l'ancienne valeur.

- [ ] **Step 1 : tests** — `ecrase_efface` : ranger une valeur, la remplacer, vérifier par un compteur de test (`#[cfg(test)]` : nombre de `Zeroizing` détruits) que l'ancienne a été effacée ; `supprime_efface` : idem à la suppression ; `fumee_avec_stockage` : le scénario de la Task 1 avec `Fournisseur` à la place de MemoryStorage.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter (carte clé → `Zeroizing<Vec<u8>>`, sérialisation JSON comme `openmls_memory_storage`) ; remplacer MemoryStorage dans `fumee.rs`.
- [ ] **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(salon): stockage MLS en mémoire qui efface les secrets`.

### Task 3 : clés du salon

**Files :**
- Create : `engine/salon/src/cles.rs`
- Test : module `tests` de `cles.rs`

**Interfaces :**
- Consumes : `shhdrop_core::kdf::{hkdf, sha256, password_key}`, `shhdrop_core::KLien`, `shhdrop_core::KMdp`.
- Produces :
  - `pub struct CleAcces { pub k: [u8;32], pub v: [u8;32] }` (`K_accès_s`, `V_accès_s` = SHA-256(K)) ; `pub fn cle_acces(k_lien: &KLien) -> CleAcces`
  - `pub struct ClesSalon` (zeroize à la destruction) avec `k_preuve() -> &[u8;32]`, `v_preuve() -> [u8;32]`, `k_trame() -> &[u8;32]`, `tag() -> &[u8;16]` ; `pub fn cles_salon(k_lien: &KLien, k_mdp: &KMdp) -> ClesSalon` : `K_maître_s` = HKDF(`K_lien` ‖ `K_mdp`, `.../maitre`), puis `preuve`, `cle` (K_salon), `trame` (depuis K_salon), `id` (16 octets, depuis K_salon), étiquettes des Global Constraints.

- [ ] **Step 1 : tests** — `etiquettes_distinctes` (les 5 sorties diffèrent deux à deux) ; `deterministe` (mêmes entrées → mêmes sorties) ; `autre_mdp_autres_cles` ; `v_preuve_est_sha256` ; valeurs attendues figées dans `engine/vectors/salon-v3.json` à la Task 8 (ici : seulement les propriétés).
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(salon): clés du salon (HKDF, étiquettes §39.2.1)`.

### Task 4 : enveloppe de taille fixe

**Files :**
- Create : `engine/salon/src/trame.rs`
- Test : module `tests` de `trame.rs`

**Interfaces :**
- Consumes : `ClesSalon::{k_trame, tag}`.
- Produces :
  - `pub const TAILLE_TRAME: usize = 4140;` `pub const TAILLE_O: usize = 4095;` `pub const MAX_CHARGE: usize = 4093;`
  - `pub enum Regle { Desactive = 0, Instantane = 1, DixMinutes = 2, UneHeure = 3 }`
  - `pub struct EnTete { pub volatile: bool, pub regle: Regle }` ; `pub fn lire_en_tete(trame: &[u8]) -> Result<EnTete>` (sans clé : c'est ce que lit le serveur Go, qui en aura sa propre copie testée contre les vecteurs)
  - `pub fn sceller(cles: &ClesSalon, en_tete: EnTete, charge: &[u8], nonce: &[u8;24]) -> Result<[u8; 4140]>`
  - `pub fn ouvrir(cles: &ClesSalon, trame: &[u8]) -> Result<(EnTete, Zeroizing<Vec<u8>>)>`
- Format : `"SHC3"` (4) ‖ `drapeaux` (1 : bit 0 volatile, bits 1–2 règle, autres bits à zéro) ‖ `nonce` (24) ‖ XChaCha20-Poly1305(`K_trame`, nonce, `O`, données authentifiées = `"SHC3"` ‖ `drapeaux` ‖ `tag`) ; `O` = `len` (2, gros-boutiste) ‖ charge ‖ zéros jusqu'à 4 095. Le nonce vient de l'appelant (aléa du fournisseur en usage, fixe dans les vecteurs).

- [ ] **Step 1 : tests** — `aller_retour` (charges de 0, 1, 4 093 octets) ; `taille_fixe` (toujours 4 140) ; `charge_trop_grande` (4 094 → `Error::TropGrand`) ; `en_tete_altere` (changer le bit volatil ou la règle → `trame_corrompue`) ; `bits_reserves` (bit 3 mis → `trame_corrompue` à l'ouverture, `en_tete_invalide` pour `lire_en_tete`) ; `mauvaise_taille` (4 139 et 4 141 → `trame_corrompue`) ; `autre_salon` (autre `tag` → `trame_corrompue`) ; `bourrage_non_nul` (zéros de bourrage modifiés avant scellement → refus à l'ouverture) ; `len_impossible` (len > 4 093 dans le clair → `trame_corrompue`).
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter avec `chacha20poly1305::XChaCha20Poly1305`. **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(salon): enveloppe de 4 140 octets, en-tête authentifié`.

### Task 5 : formats des messages

**Files :**
- Create : `engine/salon/src/message.rs`, `engine/salon/src/texte.rs`
- Test : modules `tests` des deux fichiers

**Interfaces :**
- Produces :
  - `pub fn nettoyer_texte(s: &str) -> Result<String>` (règles des Global Constraints ; vide après nettoyage → `texte_invalide`, trop long → `texte_trop_long`)
  - `pub fn verifier_pseudo(s: &str) -> Result<String>` (renvoie la forme nettoyée) et `pub fn cle_unicite(pseudo: &str) -> String` (NFKC, minuscules, sans espaces ni ponctuation)
  - `pub type IdMessage = [u8; 16];`
  - `pub enum Message` : `Texte { x }`, `Piece { r: [u8;32], piece: [u8;16], palier: u32, nom, mime, taille: u64, sorte: SortePiece, duree_ms: Option<u32> }`, `Reaction { cible: IdMessage, emoji }`, `Reponse { cible, extrait, x }`, `Modif { cible, x }`, `Retrait { cible }`, `Ecrit`, `Recu { ids: Vec<IdMessage> }`, `Vu { ids: Vec<IdMessage> }`, `Regle { regle: Regle }`, `Profil { pseudo, couleur: u8, avatar: Option<RefPiece> }`, `Depart`, `Inconnu { sorte: String }`
  - `pub struct Enveloppe { pub id: IdMessage, pub heure_ms: u64, pub regle: Regle, pub message: Message }`
  - `pub fn encoder(e: &Enveloppe) -> Result<Zeroizing<Vec<u8>>>` et `pub fn decoder(octets: &[u8]) -> Result<Enveloppe>`
  - `pub fn est_volatile(m: &Message) -> bool` (vrai pour `Ecrit`, `Recu`, `Vu`)
- JSON strict, clés exactes : `{"v":3,"id":<b64u 22>,"t":<ms>,"e":<0..3>,"k":"<sorte>", …champs}` ; sortes `texte`, `piece`, `reaction`, `reponse`, `modif`, `retrait`, `ecrit`, `recu`, `vu`, `regle`, `profil`, `depart` ; noms de champs : ceux des variantes ci-dessus en minuscules sans accents (`x`, `r`, `piece`, `palier`, `nom`, `mime`, `taille`, `sorte`, `duree_ms`, `cible`, `emoji`, `extrait`, `ids`, `regle`, `pseudo`, `couleur`, `avatar`). Sorte inconnue (ex. `appel_invite`) → `Message::Inconnu`, jamais une erreur (compatibilité avec les apps et les appels futurs). Champ en trop, manquant ou de mauvais type → `message_invalide`. `ids` : 1 à 50. `emoji` : exactement 1 graphème, 32 octets au plus. `couleur` : 0 à 9. `palier` : un palier de §29.3 jusqu'à 8 000. `nom` passé par la même règle que `safeName` du site (repris dans le moteur : retirer `/`, `\`, contrôles, caractères d'inversion, 255 octets au plus).

- [ ] **Step 1 : tests** — un aller-retour par sorte ; `texte_nettoye` (NFC, `\u{202E}` retiré, `\r` retiré, `\n` gardé) ; `texte_limites` (2 000 graphèmes OK, 2 001 → `texte_trop_long` ; 3 501 octets → `texte_trop_long`) ; `pseudo` (« Léa » OK, « A » refusé, « Аlice » cyrillique mêlé refusé, « 😀Léa » refusé, « léa » et « Léa » même `cle_unicite`) ; `sorte_inconnue_toleree` ; `champ_en_trop_refuse` ; `json_non_utf8_refuse` ; `volatiles` (`Ecrit`, `Recu`, `Vu` seulement).
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter (`serde_json::Value` vérifié champ par champ, comme `shhdrop_core::manifest`). **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(salon): formats des messages et règles de texte et de pseudonyme`.

### Task 6 : groupe MLS du salon

**Files :**
- Create : `engine/salon/src/groupe.rs`, `engine/salon/src/politique.rs`
- Test : `engine/salon/tests/groupe.rs`

**Interfaces :**
- Consumes : `Fournisseur` (Task 2), `ClesSalon` (Task 3), `sceller`/`ouvrir` (Task 4), `Enveloppe`/`encoder`/`decoder` (Task 5).
- Produces :
  - `pub struct Identite` (paire Ed25519 éphémère, `ZeroizeOnDrop`) ; `pub fn nouvelle_identite(siege: u8, nonce_arrivee: [u8;16]) -> Result<Identite>` ; la credential basique contient `siege` (1 octet) ‖ `nonce_arrivee` (16).
  - `pub struct Salon` ; `Salon::creer(identite, cles: ClesSalon, createur: bool) -> Result<Salon>` ; `Salon::key_package(&self) -> Result<Vec<u8>>` ; `Salon::rejoindre(identite, cles, welcome: &[u8]) -> Result<Salon>`
  - `Salon::ajouter(&mut self, key_package: &[u8]) -> Result<(Vec<u8>, Vec<u8>)>` (Commit, Welcome) ; `Salon::retirer(&mut self, siege: u8) -> Result<Vec<u8>>` ; `Salon::renouveler(&mut self) -> Result<Vec<u8>>`
  - `Salon::chiffrer(&mut self, e: &Enveloppe) -> Result<Vec<u8>>` (octets MLS, à passer à `sceller`)
  - `Salon::recevoir(&mut self, mls: &[u8], seq: u64) -> Result<Evenement>` avec `pub enum Evenement { Message { de_siege: u8, enveloppe: Enveloppe }, Membres { ajoutes: Vec<u8>, retires: Vec<u8> }, CommitPerdu, Ignore }`
  - `Salon::exporter_sframe(&self) -> Result<Zeroizing<[u8;32]>>` (étiquette des Global Constraints)
  - `Salon::empreinte(&self, siege: u8) -> Result<String>` : code de vérification (spec v3 §9 point 4) = 20 chiffres en 4 groupes de 5, tirés de SHA-256(`"shhdrop/v2/salon/verif"` ‖ clé publique Ed25519 du siège) (5 chiffres par tranche de 4 octets, valeur mod 100 000, gros-boutiste).
  - `politique::verifier(commit, createur_siege: u8, auteur_siege: u8, sieges_annonces: &[(u8,[u8;16])]) -> Result<()>` : seuls les retraits par le créateur, ou le retrait de soi-même, ou le retrait d'une ancienne feuille du même siège (retour après rechargement) ; tout ajout doit porter un `(siège, nonce_arrivee)` annoncé par le serveur (enregistrements 0x02/0x0A de §39.3.1) ; sinon `commit_refuse` sans fusion.
- Règle d'ordre : le premier Commit de l'époque dans l'ordre `seq` gagne ; un Commit en attente chez nous qui perd → `clear_pending_commit`, `Evenement::CommitPerdu` (l'appelant rejoue). Configuration : `max_past_epochs(1)`, `PURE_CIPHERTEXT`, arbre dans le Welcome, aucune proposition externe ni external commit acceptés.

- [ ] **Step 1 : tests** (`tests/groupe.rs`, 10 membres sauf mention) — `dix_membres` (ajouts un par un, 100 messages, chacun relu par les 9 autres) ; `retrait` (le retiré ne déchiffre plus le message suivant → `Error::NonMembre` ou `Ignore`) ; `renouvellement` ; `commits_concurrents` (Review Focus 1) ; `message_epoque_precedente` et `deux_epoques_trop_vieux` → `epoque_perdue` (Review Focus 2) ; `politique_refuse` (Review Focus 4 : retrait par un non-créateur, ajout sans siège annoncé) ; `retour_nouvelle_feuille` (Review Focus 5) ; `octets_aleatoires` (1 000 entrées aléatoires de 0 à 4 093 octets → erreur typée, aucune panique) ; `exporteur_identique` (même clé SFrame chez tous les membres d'une époque, différente à l'époque suivante) ; `empreinte_stable` (même code chez tous pour un siège donné).
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS, et `cargo test --release` du scénario `dix_membres` < 1 s.
- [ ] **Step 5 :** commit `feat(salon): groupe MLS, ordre des commits, politique d'adhésion`.

### Task 7 : règles d'effacement côté appareil

**Files :**
- Create : `engine/salon/src/effacement.rs`
- Test : module `tests`

**Interfaces :**
- Produces : `pub enum Etat { Visible, Rebours { fin_ms: u64 }, Efface }` ; `pub fn etat(regle: Regle, envoye_ms: u64, maintenant_ms: u64, moi_expediteur: bool, vu_par_moi_ms: Option<u64>, encore_dans_conversation: bool, lu_par_tous: bool) -> Etat`.
- Règles (spec v3 §5) : `Desactive` → `Visible`. `DixMinutes` / `UneHeure` → `Rebours { fin_ms: envoye_ms + 600_000 | 3_600_000 }`, puis `Efface` à l'échéance, pour tous, expéditeur compris, lu ou non. `Instantane` : expéditeur → `Visible` tant que `!lu_par_tous`, puis `Efface` ; lecteur → `Visible` tant qu'il ne l'a pas vu ; vu et resté dans la conversation → `Rebours { fin_ms: vu + 60_000 }` puis `Efface` ; vu puis sorti de la conversation → `Efface` ; `lu_par_tous` → `Efface` pour tous.

- [ ] **Step 1 : tests** — un cas par ligne de la règle ci-dessus, plus `instantane_absent_puis_revient` (non vu → `Visible` quel que soit le temps écoulé) et `bornes` (à `fin_ms − 1` : `Rebours`, à `fin_ms` : `Efface`).
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(salon): règles d'effacement des messages`.

### Task 8 : vecteurs communs et robustesse

**Files :**
- Create : `engine/salon/tests/vecteurs.rs`, `engine/salon/tests/robustesse.rs`, `engine/vectors/salon-v3.json`
- Modify : `engine/vectors/README.md` (section `salon-v3.json`)

**Interfaces :**
- Consumes : Tasks 3, 4, 5, 6, 7.
- Produces : `engine/vectors/salon-v3.json`, sections `cles` (entrées `k_lien`, `k_mdp` en hex → sorties), `trames` (en-tête, charge, nonce → trame hex ; plus refus), `messages` (enveloppe JSON → octets et retour ; plus refus avec message d'erreur exact), `texte` et `pseudo` (entrée → sortie ou erreur), `effacement` (entrées → état), `empreinte` (clé publique → code). MLS lui-même n'est pas dans les vecteurs (aléa interne d'OpenMLS) : la même version d'OpenMLS dans le site et les apps garantit l'identité ; un test croisé natif ↔ wasm en Task 9 le prouve.

- [ ] **Step 1 :** `vecteurs.rs` lit le fichier et rejoue chaque cas ; `SHH_GEN_SALON=1 cargo test -p shhdrop-salon --test vecteurs` (re)génère le fichier (même mécanisme que `limites.rs`, conventions du README : hex, clés triées, LF final, règle anti-détecteur de secrets).
- [ ] **Step 2 :** générer, relire à la main 3 cas par section, puis `cargo test` PASS sans la variable.
- [ ] **Step 3 :** `robustesse.rs` : 100 000 entrées pseudo-aléatoires (xorshift32, graine fixe) pour `ouvrir`, `lire_en_tete`, `decoder`, `nettoyer_texte`, `verifier_pseudo` → aucune panique (`std::panic::catch_unwind`).
- [ ] **Step 4 :** PASS.
- [ ] **Step 5 :** commit `test(salon): vecteurs salon-v3.json et robustesse`.

### Task 9 : liaison WebAssembly séparée et chargement par le site

**Files :**
- Create : `engine/salon-wasm/Cargo.toml`, `engine/salon-wasm/src/lib.rs`, `web/src/salon/engine.ts`, `web/src/salon/engine.test.ts`, `web/ui-e2e/salon-moteur.spec.ts`
- Modify : `engine/Cargo.toml` (membre), `web/scripts/build-engine.mjs` (second module `shhdrop_salon_wasm`), `web/vite.config.ts` (module à empreinte `assets/salon-EMPREINTE.wasm`, chargé par `fetch` avec `integrity`, jamais importé par les pages de partage), `web/scripts/check-dist.mjs` (module cité et haché ; absent du script principal ; ≤ 400 Ko brotli), `Makefile` et `.github/workflows/ci.yml` (clippy wasm32 de `shhdrop-salon-wasm`)

**Interfaces :**
- Consumes : API publique des Tasks 3 à 7.
- Produces : `web/src/salon/engine.ts` : `loadSalonEngine(): Promise<SalonEngine>` exposant, avec des `Uint8Array` : `cleAcces`, `clesSalon` (poignée opaque), `sceller`, `ouvrir`, `lireEnTete`, `encoder`/`decoder` (objets JS ↔ `Enveloppe`), `nettoyerTexte`, `verifierPseudo`, `cleUnicite`, `Salon` (poignée avec `creer`, `keyPackage`, `rejoindre`, `ajouter`, `retirer`, `renouveler`, `chiffrer`, `recevoir`, `exporterSframe`, `empreinte`, `free`), `etatEffacement`. Les erreurs sont levées avec le message snake_case du moteur. Nonces et aléa : `crypto.getRandomValues` (getrandom js).

- [ ] **Step 1 : tests** — `engine.test.ts` (vitest, Node) : rejoue `salon-v3.json` par le wasm ; `salon-moteur.spec.ts` (Playwright, Chromium) : scénario 10 membres de la Task 6 dans une page, temps total < 2 s, et **test croisé** : Welcome et messages produits en natif (fichier généré par un test Rust `croise_natif`) déchiffrés par le wasm, et l'inverse.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter la liaison et le chargement ; `check-dist` refuse le build si le module du salon apparaît dans le script principal ou dépasse 400 Ko brotli.
- [ ] **Step 4 :** `make test-engine`, `cd web && npm test && npm run check && npm run build && node scripts/check-dist.mjs && npm run build:demo && node scripts/check-dist.mjs --demo`, Playwright `salon-moteur.spec.ts` (chromium-desktop, `--trace off`) → PASS ; noter dans le rapport la taille brotli du module.
- [ ] **Step 5 :** commit `feat(salon): module WebAssembly du salon, chargé à part avec contrôle d'empreinte`.

### Task 10 : documentation et spécification

**Files :**
- Modify : `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (§6 : RustCrypto et OpenMLS ; §39.2 marqué remplacé par la spec v3 §3 ; D42-21 : second module), `docs/superpowers/specs/2026-11-11-salon-v3-design.md` (§3.6 : chiffres réels, écarts), `THIRD_PARTY_LICENSES.md`

- [ ] **Step 1 :** écrire les amendements, avec la taille et les temps mesurés en Task 9.
- [ ] **Step 2 :** commit `docs(salon): moteur du salon en service (C-1)`.
