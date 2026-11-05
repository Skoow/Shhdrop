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

Toutes sous licence MIT, versions exactes dans `web/package-lock.json` et `web/tools/svelte-check/package-lock.json` :

- `svelte` 5.57.3 (exécution, compilée dans le bundle) : MIT, Copyright (c) Svelte contributors
- `@sveltejs/vite-plugin-svelte` 7.3.1 (build) : MIT
- `@playwright/test` 1.64.1 (tests) : Apache-2.0
- `@axe-core/playwright` 4.14.0 (tests) : MPL-2.0
- `happy-dom` 21.0.4 (tests) : MIT
- `svelte-check` 4.7.8, `typescript` 6.0.3 (contrôle de types, `web/tools/svelte-check`) : MIT et Apache-2.0
