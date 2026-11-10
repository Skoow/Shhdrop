# Banc de vitesse du moteur

`node web/bench/run.mjs <sortie.json> [--ref <révision>]` reconstruit le site (`npm run build`), construit la page du banc (`bench/vite.config.ts`, mêmes greffons Argon2 que le site), la lance dans Chromium (`PW_LOCAL_CHROMIUM=1` pour utiliser `/opt/pw-browsers/chromium`) et écrit : vitesse de chiffrement et d'ouverture (Mio/s, 128 Mio), Argon2id (ms), poids brotli à télécharger pour envoyer et pour ouvrir. Chaque mesure : médiane, minimum, écart interquartile et passes brutes.

Le banc ne touche le moteur que par `api.ts` (interface neutre : `sealPacket`, `openPacket`, `deriveKey`). Changer de moteur = réécrire `api.ts` (et `vite.config.ts` si le chargement change).

## Comparer avant et après (Task 13)

Le bruit d'une passe à l'autre dépasse 5 %, donc on alterne dans la même session, plusieurs tours :

```
for i in 1 2 3; do
  node web/bench/run.mjs avant-$i.json --ref <commit du moteur TypeScript>
  node web/bench/run.mjs apres-$i.json
done
```

`--ref` construit banc et site depuis cette révision dans un `git worktree` temporaire (supprimé ensuite). Comparer les médianes des tours ; ne pas lancer d'autre charge pendant la mesure.
