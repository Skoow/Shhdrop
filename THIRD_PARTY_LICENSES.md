# Licences tierces

Le code de Shhdrop est publié sous licence GNU AGPL-3.0 (voir `LICENSE`). Les composants ci-dessous ne sont pas couverts par cette licence : chacun garde la sienne, rappelée dans sa section.

## SecLists, `10k-most-common.txt` et `100k-most-used-passwords-NCSC.txt`

- Source : https://github.com/danielmiessler/SecLists (Passwords/Common-Credentials/10k-most-common.txt et 100k-most-used-passwords-NCSC.txt, 20 000 premières lignes de cette dernière)
- Licence : MIT, Copyright (c) Daniel Miessler et contributeurs. La liste NCSC vient du National Cyber Security Centre (Royaume-Uni, 2019), tirée de Pwned Passwords (Troy Hunt) ; SecLists la redistribue sous sa licence MIT.
- Utilisation : `web/src/vault/blocklist.ts` (généré), mots de passe courants et « cœurs » de dictionnaire (règle de `web/src/vault/weakpw.ts`).

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

## Richelieu, `french_passwords_top20000.txt`

- Source : https://github.com/tarraschk/richelieu (20 000 mots de passe français les plus courants, tirés de fuites publiques filtrées sur des adresses en .fr)
- Auteurs : Maxime Alay-Eddine et Paul Barbaste
- Licence : Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- Utilisation : `web/src/vault/blocklist.ts` (généré), transformée (minuscules, accents retirés, entrées de 10 caractères ou plus et cœurs de dictionnaire seulement).

## Dépendances npm de l'interface (Plan 2)

Versions exactes dans `web/package-lock.json` et `web/tools/svelte-check/package-lock.json`. Licences lues dans le `package.json` de chaque paquet installé (`node_modules`).

Exécution (le bundle ne contient que le code d'exécution de Svelte ; le reste de la liste est installé comme dépendance de `svelte`) :

- `svelte` 5.57.3 : MIT, Copyright (c) Svelte contributors
- `pdfjs-dist` 6.5.438 : Apache-2.0, Copyright Mozilla Foundation et contributeurs de pdf.js (https://github.com/mozilla/pdf.js). Seulement dans le cadre PDF isolé (`pdf-frame.js`), non modifié ; texte de la licence : https://www.apache.org/licenses/LICENSE-2.0. Dépendance facultative `@napi-rs/canvas` (MIT) : pour Node seulement, jamais servie.
- Dépendances de `svelte` (fermeture complète, outils de compilation compris) :
  - MIT : `@jridgewell/remapping` 2.3.5, `@jridgewell/gen-mapping` 0.3.13, `@jridgewell/sourcemap-codec` 1.6.0, `@jridgewell/trace-mapping` 0.3.31, `@jridgewell/resolve-uri` 3.1.2, `@sveltejs/acorn-typescript` 1.0.13, `@types/estree` 1.0.10, `acorn` 8.19.0, `clsx` 2.1.1, `devalue` 5.9.4, `esm-env` 1.2.2, `esrap` 2.4.0, `is-reference` 3.0.3, `locate-character` 3.0.0, `magic-string` 0.30.21, `zimmerframe` 1.1.5
  - Apache-2.0 : `aria-query` 5.3.1, `axobject-query` 4.1.0

Construction et tests (hors bundle) :

- `@sveltejs/vite-plugin-svelte` 7.3.1, `vite` 8.3.5, `vitest` 5.1.0, `happy-dom` 21.0.4 : MIT
- `typescript` 7.0.2 (`web`) et 6.0.3 (`web/tools/svelte-check`), `@playwright/test` 1.64.1 : Apache-2.0
- `svelte-check` 4.7.8 : MIT
- `@fontsource-variable/mona-sans` 5.3.0 et `@fontsource-variable/jetbrains-mono` 5.3.0 : OFL-1.1 (sources des polices ci-dessous ; seuls les `.woff2` copiés sont servis)
- `@axe-core/playwright` 4.14.0 et `axe-core` 4.14.0 : MPL-2.0

## Moteur WebAssembly (crates Rust compilées dans `assets/engine-*.wasm`)

Versions exactes dans `engine/Cargo.lock` ; liste : `cargo tree -p shhdrop-wasm --target wasm32-unknown-unknown -e normal`. Seules les crates ci-dessous entrent dans le `.wasm` et sa colle JavaScript (les macros procédurales, `proc-macro2`, `quote`, `syn`, `unicode-ident`, `wasm-bindgen-macro*`, `wasm-bindgen-shared` et `bumpalo`, ne servent qu'à la compilation).

- MIT OR Apache-2.0 : `argon2` 0.6.0, `base64ct` 1.8.3, `base64` 0.23.1, `blake2` 0.11.0, `block-buffer` 0.12.1, `cfg-if` 1.0.5, `cmov` 0.5.4, `crypto-common` 0.2.2, `ctutils` 0.4.8, `digest` 0.11.3, `futures-core`, `futures-task` et `futures-util` 0.3.34, `hkdf` 0.13.0, `hmac` 0.13.0, `hybrid-array` 0.4.15, `itoa` 1.0.19, `js-sys` 0.3.107, `pin-project-lite` 0.2.17, `serde_core` 1.0.229, `serde_json` 1.0.154, `postcard` 1.1.3, `cobs` 0.3.0, `embedded-io` 0.4.0 et 0.6.1, `sha2` 0.11.1, `typenum` 1.20.1, `wasm-bindgen` 0.2.130, `wasm-bindgen-futures` 0.4.80, `zeroize` 1.9.1 (RustCrypto et projet wasm-bindgen ; textes : https://opensource.org/license/mit, https://www.apache.org/licenses/LICENSE-2.0)
- MIT : `slab` 0.4.12, `zmij` 1.0.23 ; Unlicense OR MIT : `memchr` 2.8.3 ; Zlib OR Apache-2.0 OR MIT : `tinyvec` 1.13.3
- (MIT OR Apache-2.0) AND Unicode-3.0 : `unicode-normalization` 0.1.26 (tables Unicode, licence Unicode : https://www.unicode.org/license.txt)
- BSD-3-Clause : `subtle` 2.6.1 (comparaisons en temps constant), texte de la licence :

```
Copyright (c) 2016-2017 Isis Agora Lovecruft, Henry de Valence. All rights reserved.
Copyright (c) 2016-2024 Isis Agora Lovecruft. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

1. Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Polices hébergées (SIL Open Font License 1.1)

Fichiers copiés de `web/node_modules/@fontsource-variable/*/files/` vers `web/public/fonts/` par `web/scripts/copy-fonts.mjs` (empreintes SHA-256 vérifiées, voir `web/src/ui/tokens.test.ts`). Servies par le serveur lui-même, jamais depuis un CDN. Polices non modifiées.

- **Mona Sans** : `web/public/fonts/mona-sans-latin-standard-normal.woff2`, extrait latin de `@fontsource-variable/mona-sans` 5.3.0. Copyright 2022 The Mona Sans Project Authors (https://github.com/github/mona-sans), with Reserved Font Name "Mona".
- **JetBrains Mono** : `web/public/fonts/jetbrains-mono-latin-wght-normal.woff2`, extrait latin de `@fontsource-variable/jetbrains-mono` 5.3.0. Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono).

Texte de la licence (identique dans les deux paquets) :

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## uqr 0.1.3 (recopié dans `web/src/qr/vendor/`)

- Source : archive npm `uqr-0.1.3.tgz` (https://github.com/unjs/uqr), intégrité sha512 `0rjE8iEJe4YmT9TOhwsZtqCMRLc5DXZUI2UEYUUg63ikBkqqE5EYWaI0etFe/5KUcmcYwLih2RND1kq+hrUJXA==` ; `dist/index.mjs`, `dist/index.d.mts` et `LICENSE` recopiés sans modification, empreintes SHA-256 vérifiées par `web/src/qr/qr.test.ts`. Portage du générateur de QR de Project Nayuki ; seule `encode` est utilisée (QR du lien, « Lien prêt »).
- Licence : MIT, Copyright (c) Project Nayuki, Copyright (c) 2023 Anthony Fu (texte complet : `web/src/qr/vendor/LICENSE`)
- Mise à jour : relire le diff (`npm diff --diff=uqr@0.1.3 --diff=uqr@<nouvelle>`), recopier, changer les empreintes du test (audit F3 du 7 novembre).

## Moteur du salon (crate `shhdrop-salon`, OpenMLS 0.9.2)

Versions exactes dans `engine/Cargo.lock` ; liste : `cargo tree -p shhdrop-salon --target wasm32-unknown-unknown -e normal` (état au 11 novembre 2026, Task 1 du moteur du salon). Les macros procédurales et leurs aides de compilation (`proc-macro2`, `quote`, `syn`, `unicode-ident`, `hax-lib-macros`, `serde_derive`, `thiserror-impl`, `tls_codec_derive`, `zeroize_derive`, `wasm-bindgen-macro*`) ne sont pas dans le `.wasm`. Les crates déjà listées pour le moteur des partages gardent leur licence indiquée plus haut.

- MIT : `openmls` 0.9.2, `openmls_rust_crypto` 0.6.0, `openmls_basic_credential` 0.6.0, `openmls_traits` 0.6.0, `openmls_memory_storage` 0.6.0, `openmls_serialization_helpers` 0.1.0, `generic-array` 0.14.7
- Code repris et adapté (MIT, Copyright (c) 2020 OpenMLS Authors ; texte complet : `engine/salon/LICENSE-openmls-memory-storage`) : `engine/salon/src/stockage.rs` dérive de `openmls_memory_storage` 0.6.0 (https://github.com/openmls/openmls, `memory_storage`) ; modifications : valeurs en postcard (longueur en tête) plutôt qu'en JSON, valeurs effacées à l'écrasement, à la suppression et à la destruction, erreurs typées à la place des `unwrap`, correction de `clear_proposal_queue`, fonctionnalités optionnelles retirées (mention en tête du fichier). `openmls_memory_storage` reste aussi une dépendance transitive d'`openmls_rust_crypto`, non utilisée par le salon.
- MPL-2.0 (copyleft au niveau du fichier ; code non modifié, source : https://github.com/cryspen/hpke-rs) : `hpke-rs` 0.7.0, `hpke-rs-crypto` 0.7.0, `hpke-rs-rust-crypto` 0.7.0
- Apache-2.0 : `libcrux-sha3` 0.0.10, `libcrux-intrinsics` 0.0.8, `libcrux-platform` 0.0.3, `libcrux-secrets` 0.0.6, `libcrux-traits` 0.0.8, `hax-lib` 0.3.7
- BSD-3-Clause (même licence que `subtle`, texte plus haut ; chaque crate garde son propre fichier de licence) : `curve25519-dalek` 4.1.3 et 5.0.0, `ed25519-dalek` 2.2.0, `x25519-dalek` 2.0.1 et 3.0.0
- Apache-2.0 OR MIT : `aes-gcm` 0.10.3, `chacha20` 0.9.1, `chacha20poly1305` 0.10.1, `poly1305` 0.8.0, `ghash` 0.5.1, `polyval` 0.6.2, `crypto-bigint` 0.5.5, `ecdsa` 0.16.9, `elliptic-curve` 0.13.8, `p256` 0.13.2, `p384` 0.13.1, `k256` 0.13.4, `primeorder` 0.13.6, `ed25519` 2.2.3, `signature` 2.2.0 et 3.0.0, `rfc6979` 0.4.0, `sec1` 0.7.3, `der` 0.7.10 et 0.8.3, `spki` 0.7.3 et 0.8.1, `pkcs8` 0.10.2 et 0.11.0, `pem-rfc7468` 0.7.0, `const-oid` 0.9.6 et 0.10.2, `base16ct` 0.2.0, `kem` 0.3.0, `ml-kem` 0.3.4, `ml-dsa` 0.1.2, `module-lattice` 0.2.4, `x-wing` 0.1.1, `keccak` 0.2.2, `tls_codec` 0.5.0, `pin-project-lite` 0.2.17, `zeroize` 1.9.1, `zerocopy` 0.8.63 (BSD-2-Clause OR Apache-2.0 OR MIT)
- MIT OR Apache-2.0 : `aead` 0.5.2, `aes` 0.8.4, `cipher` 0.4.4, `ctr` 0.9.2, `universal-hash` 0.5.1, `opaque-debug` 0.3.1, `inout` 0.1.4, `digest` 0.10.7, `block-buffer` 0.10.4, `crypto-common` 0.1.7, `hkdf` 0.12.4, `hmac` 0.12.1, `sha2` 0.10.9, `sha3` 0.12.0, `shake` 0.1.0, `sponge-cursor` 0.1.0, `typenum` 1.20.1, `rand` 0.10.3, `rand_chacha` 0.3.1 et 0.10.0, `rand_core` 0.6.4 et 0.10.1, `ppv-lite86` 0.2.21, `getrandom` 0.2.17 et 0.4.3, `serde` et `serde_core` 1.0.229, `serde_bytes` 0.11.19, `serde_json` 1.0.154, `thiserror` 2.0.21, `log` 0.4.35, `num-traits` 0.2.19, `itoa` 1.0.18, `either` 1.19.0, `rayon` 1.12.0, `rayon-core` 1.13.0, `crossbeam-deque` 0.8.8, `crossbeam-epoch` 0.9.21, `crossbeam-utils` 0.8.23, `bumpalo` 3.20.3, `libc` 0.2.191, `web-time` 1.1.0 ; `ff` 0.13.1 et `group` 0.13.0 (MIT/Apache-2.0) ; `memchr` 2.8.3 (Unlicense OR MIT)
- Navigateur seulement (cible wasm32) : `js-sys` 0.3.107 et `wasm-bindgen` 0.2.130 (MIT OR Apache-2.0).
- Crates déjà listées plus haut, en versions parfois différentes : `hkdf` 0.13.0, `hmac` 0.13.0, `sha2` 0.11.1, `digest` 0.11.3, `block-buffer` 0.12.1, `crypto-common` 0.2.2, `hybrid-array` 0.4.15, `cmov` 0.5.4, `ctutils` 0.4.8, `base64ct` 1.8.3, `cfg-if` 1.0.5, `slab` 0.4.12, `zmij` 1.0.23, `subtle` 2.6.1.
