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
