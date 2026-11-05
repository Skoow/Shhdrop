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
- Dépendances de `svelte` (fermeture complète, outils de compilation compris) :
  - MIT : `@jridgewell/remapping` 2.3.5, `@jridgewell/gen-mapping` 0.3.13, `@jridgewell/sourcemap-codec` 1.6.0, `@jridgewell/trace-mapping` 0.3.31, `@jridgewell/resolve-uri` 3.1.2, `@sveltejs/acorn-typescript` 1.0.13, `@types/estree` 1.0.10, `acorn` 8.19.0, `clsx` 2.1.1, `devalue` 5.9.4, `esm-env` 1.2.2, `esrap` 2.4.0, `is-reference` 3.0.3, `locate-character` 3.0.0, `magic-string` 0.30.21, `zimmerframe` 1.1.5
  - Apache-2.0 : `aria-query` 5.3.1, `axobject-query` 4.1.0

Construction et tests (hors bundle) :

- `@sveltejs/vite-plugin-svelte` 7.3.1, `vite` 8.3.5, `vitest` 5.1.0, `happy-dom` 21.0.4 : MIT
- `typescript` 7.0.2 (`web`) et 6.0.3 (`web/tools/svelte-check`), `@playwright/test` 1.64.1 : Apache-2.0
- `svelte-check` 4.7.8 : MIT
- `@axe-core/playwright` 4.14.0 et `axe-core` 4.14.0 : MPL-2.0
