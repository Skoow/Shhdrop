# Mise à jour des dépendances — 2026-11-04

Spécification : §24. Branche `plan-1b-maj`. Sources : registre npm (`npm view`), `proxy.golang.org`, `go.dev/dl/?mode=json`, dépôts officiels `github.com/actions/*` (`git ls-remote`).

| Dépendance | Avant | Après | Source |
|---|---|---|---|
| Go (toolchain) | go1.26.10 | go1.27.3 (directive `go 1.26.0` conservée : aucune dépendance n'exige plus) | go.dev/dl |
| modernc.org/libc (indirect) | v1.79.0 | v1.80.1 | proxy.golang.org |
| modernc.org/sqlite | v1.61.1 | v1.61.1 (déjà la dernière) | proxy.golang.org |
| altcha-lib-go | v1.0.0 | v1.0.0 (déjà la dernière) | proxy.golang.org |
| golang.org/x/sys | v0.49.0 | v0.49.0 (déjà la dernière) | proxy.golang.org |
| libsodium-wrappers-sumo | 0.7.15 | 0.8.4 | npm |
| @types/libsodium-wrappers-sumo | 0.7.8 | 0.8.2 | npm |
| @types/node | 22 | 22.20.5 (dernière de la ligne 22) | npm |
| typescript | 5.6.3 | 7.0.2 | npm |
| vite | 6.0.3 | 8.3.5 | npm |
| vitest | 2.1.8 | 5.1.0 | npm |
| actions/checkout | v4 | v7.0.1 (3d3c42e5aac5ba805825da76410c181273ba90b1) | github.com/actions/checkout |
| actions/setup-go | v5 | v7.0.0 (b7ad1dad31e06c5925ef5d2fc7ad053ef454303e) | github.com/actions/setup-go |
| actions/setup-node | v4 | v7.1.0 (949feb2413d6458794dcd2491c4babbbce0c15c1) | github.com/actions/setup-node |
| govulncheck | @latest | v1.9.0 (épinglé) | proxy.golang.org |

Les trois actions déclarent `using: node24`. Les versions npm sont épinglées exactement (sans ^ ni ~).

## Changements de code

- TypeScript 7 : `Uint8Array` est générique (`Uint8Array<ArrayBufferLike>`), et WebCrypto/`fetch` exigent `Uint8Array<ArrayBuffer>`. Les annotations de type sont passées à `Uint8Array<ArrayBuffer>` dans `web/src` et `web/e2e` (types seulement, aucun changement d'exécution). `concat` et `kMdp` (retour libsodium) restent en `Uint8Array` large. Aucun test modifié dans son comportement.
- CI : SHA complets + commentaire de version, `cache-dependency-path: server/go.sum`, govulncheck v1.9.0, `.github/dependabot.yml` (npm `/web`, gomod `/server`, github-actions `/`, hebdomadaire).

## Sorties des outils

- `npm ci` : OK. `npm audit` : found 0 vulnerabilities (dev comprises).
- `npx tsc --noEmit` : 0 erreur.
- `go vet ./...` : propre. `GOTOOLCHAIN=go1.27.3 go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...` : No vulnerabilities found.
- `make test` : Go, 10 paquets ok ; web 7 fichiers / 98 tests passés ; e2e 4 fichiers / 22 tests passés.

## Points de vigilance

- Sans `GOTOOLCHAIN=go1.27.3`, govulncheck v1.9.0 compilé avec Go 1.26 échoue sur la bibliothèque standard 1.27 (« file requires newer Go version go1.27 »). En CI, setup-go installe 1.27.3 (directive `toolchain`), donc govulncheck est compilé avec 1.27 : à confirmer au premier passage de la CI.
- `@types/libsodium-wrappers-sumo@0.8.2` est un paquet « stub » déprécié (libsodium-wrappers-sumo 0.8 fournit ses types). Conservé car demandé ; recommandation : le retirer.
- Les révisions de majeures (Vite 8, Vitest 5, TypeScript 7, libsodium 0.8) n'ont pas été relues pour des changements de comportement cryptographique hors tests ; la suite de vecteurs et le test « le serveur ne voit rien » (e2e) passent.
