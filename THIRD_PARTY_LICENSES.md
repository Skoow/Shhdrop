# Licences tierces

## Liste de mots EFF (grande liste, 7 776 mots)

- Source : https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt (voir https://www.eff.org/dice)
- Auteur : Electronic Frontier Foundation
- Licence : Creative Commons Attribution 3.0 (CC-BY 3.0), https://creativecommons.org/licenses/by/3.0/
- Utilisation : `web/src/crypto/wordlist-eff.ts` (généré), mots seuls, sans les numéros de dés.

## SecLists, `10k-most-common.txt`

- Source : https://github.com/danielmiessler/SecLists (Passwords/Common-Credentials/10k-most-common.txt)
- Licence : MIT, Copyright (c) Daniel Miessler et contributeurs
- Utilisation : `web/src/crypto/blocklist.ts` (généré), liste noire de mots de passe courants.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

## Dépendances npm de l'interface (Plan 2)

Versions exactes dans `web/package-lock.json` et `web/tools/svelte-check/package-lock.json`. Licences lues dans le `package.json` de chaque paquet installé (`node_modules`).

Exécution (le bundle ne contient que le code d'exécution de Svelte et libsodium ; le reste de la liste est installé comme dépendance de `svelte`) :

- `svelte` 5.57.3 : MIT, Copyright (c) Svelte contributors
- `libsodium-wrappers-sumo` 0.8.4 et `libsodium-sumo` 0.8.4 : ISC
- `@lucide/svelte` 1.68.0 : ISC, Copyright (c) 2026 Lucide Icons and Contributors (icônes importées une à une, voir `web/src/ui/Icon.ts`)
- Dépendances de `svelte` (fermeture complète, outils de compilation compris) :
  - MIT : `@jridgewell/remapping` 2.3.5, `@jridgewell/gen-mapping` 0.3.13, `@jridgewell/sourcemap-codec` 1.6.0, `@jridgewell/trace-mapping` 0.3.31, `@jridgewell/resolve-uri` 3.1.2, `@sveltejs/acorn-typescript` 1.0.13, `@types/estree` 1.0.10, `acorn` 8.19.0, `clsx` 2.1.1, `devalue` 5.9.4, `esm-env` 1.2.2, `esrap` 2.4.0, `is-reference` 3.0.3, `locate-character` 3.0.0, `magic-string` 0.30.21, `zimmerframe` 1.1.5
  - Apache-2.0 : `aria-query` 5.3.1, `axobject-query` 4.1.0

Construction et tests (hors bundle) :

- `@sveltejs/vite-plugin-svelte` 7.3.1, `vite` 8.3.5, `vitest` 5.1.0, `happy-dom` 21.0.4 : MIT
- `typescript` 7.0.2 (`web`) et 6.0.3 (`web/tools/svelte-check`), `@playwright/test` 1.64.1 : Apache-2.0
- `svelte-check` 4.7.8 : MIT
- `@fontsource-variable/mona-sans` 5.3.0 et `@fontsource-variable/jetbrains-mono` 5.3.0 : OFL-1.1 (sources des polices ci-dessous ; seuls les `.woff2` copiés sont servis)
- `@axe-core/playwright` 4.14.0 et `axe-core` 4.14.0 : MPL-2.0

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
