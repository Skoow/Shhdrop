# Moteur Rust : temps avant et après (11 novembre 2026)

Critère de la spécification du moteur (sous-projet 1) : **rien de plus lent qu'avant**, avec 5 % de marge. Une mesure plus mauvaise de plus de 5 % bloque la mise en ligne.

## Méthode

- Avant : dernier moteur TypeScript (`a693d33`), construit depuis un worktree avec ses propres paquets (libsodium compris).
- Après : moteur Rust en service (`7cad26a`).
- Même machine, même Chromium (153.0.8010.12), même page de mesure (`web/bench/bench.ts`, inchangée entre les deux).
- 3 tours, en alternant ancien et nouveau dans la même session, pour que le bruit de la machine touche les deux pareil. Chaque tour : 15 passes après une passe d'échauffement. On compare la médiane des 3 médianes.
- Chiffrer et ouvrir : 128 Mio en mémoire, octets vérifiés hors chrono. Argon2id : paramètres de création (3 passes, 64 Mio). Poids : octets brotli que le navigateur télécharge pour envoyer (`/`) et pour ouvrir (`/#…`).

Données : `2026-11-10-moteur-apres.json` (tours du nouveau et de l'ancien moteur). Référence du début des travaux : `2026-11-10-moteur-avant.json`.

## Résultats

| Mesure | Avant (TypeScript) | Après (Rust) | Écart | Verdict |
|---|---|---|---|---|
| Chiffrer (Mio/s, plus = mieux) | 227,4 | 246,5 | **+8,4 %** | gagné |
| Ouvrir (Mio/s, plus = mieux) | 413,6 | 509,1 | **+23,1 %** | gagné |
| Mot de passe, Argon2id (ms, moins = mieux) | 241 | 196 | **−18,7 %** | gagné |
| Argon2id, premier appel à froid (ms) | 248 | 230 | −7,3 % | gagné |
| Poids pour envoyer (octets brotli) | 341 304 | 339 022 | −0,7 % | gagné |
| Poids pour ouvrir (octets brotli) | 341 304 | 339 022 | −0,7 % | gagné |

Pour chiffrer, ouvrir et Argon2id, **chaque** tour du moteur Rust bat **chaque** tour de l'ancien moteur :

| Mesure | Tours avant | Tours après |
|---|---|---|
| Chiffrer | 227,4 / 228,7 / 212,1 | 246,5 / 237,8 / 247,8 |
| Ouvrir | 433,9 / 413,6 / 407,6 | 499,6 / 509,1 / 513,0 |
| Argon2id (ms) | 248 / 241 / 236 | 205 / 196 / 189 |

**Verdict : critère tenu, aucune mesure perdue.** Le moteur Rust est plus rapide partout et le site est un peu plus léger.

## Points à connaître

- **Démo** (`npm run build:demo`, hors production) : +14,5 % de poids, parce qu'elle embarque le moteur au lieu de le télécharger (elle n'a pas le droit de faire de requête). Jugé non bloquant : la démo n'est pas le site servi aux utilisateurs.
- **Bruit** : d'une passe à l'autre, l'écart dépasse parfois 10 % sur cette machine (ouvrir : 399 à 617 Mio/s dans un même tour). C'est pour cela qu'on alterne et qu'on compare des médianes. Les écarts ci-dessus sont nettement au-dessus de ce bruit, puisque les tours ne se chevauchent pas.
- **Mesures dans Chromium seulement** : Safari (WebKit) et Firefox ne sont pas mesurés ; WebKit est seulement testé en CI.

## Contrôle après la mise à jour des outils (Rust 1.99.1, Node 26.13.0)

Même méthode, 3 tours alternés contre le même ancien moteur (`a693d33`), sur `8c40440` :

| Mesure | Avant (TypeScript) | Après (Rust 1.99.1) | Écart | Verdict |
|---|---|---|---|---|
| Chiffrer (Mio/s) | 221,5 | 236,8 | **+6,9 %** | gagné |
| Ouvrir (Mio/s) | 418,6 | 505,3 | **+20,7 %** | gagné |
| Argon2id (ms) | 252 | 199 | **−21,0 %** | gagné |
| Argon2id, premier appel (ms) | 294 | 225 | −23,5 % | gagné |
| Poids pour envoyer et ouvrir (octets brotli) | 341 304 | 338 810 | −0,7 % | gagné |

Tours avant / après : chiffrer 221,5 / 218,8 / 231,4 contre 234,6 / 243,9 / 236,8 ; ouvrir 426,1 / 418,6 / 409,3 contre 505,3 / 503,5 / 505,3 ; Argon2id 268 / 252 / 241 contre 235 / 199 / 195 ms. Chaque tour du moteur Rust bat encore chaque tour de l'ancien. La machine était plus chargée que lors de la première mesure (l'ancien moteur y est lui aussi un peu plus lent) ; les écarts restent du même ordre. **Critère toujours tenu.**

### Rust 1.97.0 contre Rust 1.99.1 (même moteur, comparaison directe)

3 tours alternés, `3a75bc1` (Rust 1.97.0, Node 22.23.4) contre `a7164eb` (Rust 1.99.1, Node 26.13.0) :

| Mesure | Rust 1.97.0 | Rust 1.99.1 | Écart |
|---|---|---|---|
| Chiffrer (Mio/s) | 232,2 (223,5 / 232,2 / 244,5) | 235,8 (235,8 / 230,3 / 242,1) | +1,5 % (dans le bruit) |
| Ouvrir (Mio/s) | 498,1 (503,7 / 482,1 / 498,1) | 498,4 (494,6 / 498,4 / 498,8) | 0 % |
| Argon2id (ms) | 208 (212 / 194 / 208) | 218 (218 / 214 / 219) | **+4,8 % (plus lent)** |
| Argon2id, premier appel (ms) | 227 | 264 | +16 % (très dispersé : 236 à 313) |
| Poids (octets brotli) | 339 090 | 338 801 | −0,1 % |

Chiffrer et ouvrir : identiques. Argon2id : environ 10 ms de plus avec Rust 1.99.1, juste sous la marge de 5 % ; les tours se chevauchent à peine. Le moteur reste nettement plus rapide que l'ancien moteur TypeScript (199 à 218 ms contre 241 à 268 ms). Rust 1.99.1 est gardé (dernière version, correctifs du compilateur) ; à remesurer à la prochaine montée de Rust.
