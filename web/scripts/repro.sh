#!/usr/bin/env bash
# Build reproductible (spec §28.1) : le site et ses modules WebAssembly (engine/, web/src/engine/pkg,
# web/src/salon/pkg) sont construits deux fois, dans deux dossiers absolus différents (chacun avec son propre
# engine/target), et chaque fichier doit avoir la même empreinte. Écrit la liste des empreintes dans
# le fichier donné en argument (défaut : web/SHA256SUMS.repro, ignoré par git) ; la CI compare
# ensuite les listes de deux machines.
#   web/scripts/repro.sh [fichier de sortie]
# Sortie 0 si les deux builds sont identiques ; 1 sinon (les différences sont affichées).
set -euo pipefail
umask 022
export TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8

web="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$web/.." && pwd)"
out="${1:-$web/SHA256SUMS.repro}"
# Même identifiant de version dans les deux copies (elles n'ont pas de dossier .git).
SHH_BUILD_ID="${SHH_BUILD_ID:-$(git -C "$web" rev-parse --short=7 HEAD)}"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$web" log -1 --format=%ct)}"
export SHH_BUILD_ID SOURCE_DATE_EPOCH

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

build() { # $1 : dossier absolu de la copie (même disposition que le dépôt : web/ et engine/)
  mkdir -p "$1"
  # Les sources suivies par git, telles qu'elles sont sur le disque ; ni dist, ni node_modules,
  # ni engine/target, ni web/src/engine/pkg.
  (cd "$repo" && git ls-files -z -- web engine | tar --null -T - -cf - 2>/dev/null) | tar -xf - -C "$1"
  ln -s "$web/node_modules" "$1/web/node_modules"
  (cd "$1/web" && npm run build >"$1.log" 2>&1) || { cat "$1.log" >&2; exit 1; }
  (cd "$1/web/dist" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
  # Moteur tel que construit par build-engine.mjs (web/src/engine/pkg, ignoré par git : le .wasm
  # et sa colle JavaScript). Le greffon shh-engine (vite.config.ts) en émet le .wasm dans dist/assets (déjà compté ci-dessus) ; ces
  # empreintes nomment en plus la sortie brute de wasm-bindgen si les deux builds diffèrent.
  (cd "$1/web/src/engine" && find pkg -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
  # Module du salon (web/src/salon/pkg) : aucune page du site ne l'importe encore, il n'est donc
  # pas dans dist/ ; ses empreintes sont comptées ici, préfixées « salon/pkg/ » (le job
  # repro-docker de la CI ne compare que « ./ » et « pkg/ », l'image ne le construit pas encore).
  (cd "$1/web/src" && find salon/pkg -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
}

build "$tmp/a" >"$tmp/a.sums"
build "$tmp/un/autre/chemin plus long" >"$tmp/b.sums"
if ! diff "$tmp/a.sums" "$tmp/b.sums"; then
  echo "repro : les deux builds diffèrent (lignes ci-dessus)" >&2
  exit 1
fi
cp "$tmp/a.sums" "$out"
echo "repro : $(wc -l <"$out") fichiers identiques dans les deux builds ($out)"
