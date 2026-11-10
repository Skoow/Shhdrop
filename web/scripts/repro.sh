#!/usr/bin/env bash
# Build reproductible (spec §28.1) : le site est construit deux fois, dans deux dossiers absolus
# différents, et chaque fichier doit avoir la même empreinte. Écrit la liste des empreintes dans
# le fichier donné en argument (défaut : web/SHA256SUMS.repro, ignoré par git) ; la CI compare
# ensuite les listes de deux machines.
#   web/scripts/repro.sh [fichier de sortie]
# Sortie 0 si les deux builds sont identiques ; 1 sinon (les différences sont affichées).
set -euo pipefail
umask 022
export TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8

web="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$web/SHA256SUMS.repro}"
# Même identifiant de version dans les deux copies (elles n'ont pas de dossier .git).
SHH_BUILD_ID="${SHH_BUILD_ID:-$(git -C "$web" rev-parse --short=7 HEAD)}"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$web" log -1 --format=%ct)}"
export SHH_BUILD_ID SOURCE_DATE_EPOCH

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

build() { # $1 : dossier absolu de la copie
  mkdir -p "$1"
  # Les sources suivies par git, telles qu'elles sont sur le disque ; ni dist ni node_modules.
  (cd "$web" && git ls-files -z | tar --null -T - -cf - 2>/dev/null) | tar -xf - -C "$1"
  ln -s "$web/node_modules" "$1/node_modules"
  (cd "$1" && npm run build >"$1.log" 2>&1) || { cat "$1.log" >&2; exit 1; }
  (cd "$1/dist" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
}

build "$tmp/a" >"$tmp/a.sums"
build "$tmp/un/autre/chemin plus long" >"$tmp/b.sums"
if ! diff "$tmp/a.sums" "$tmp/b.sums"; then
  echo "repro : les deux builds diffèrent (lignes ci-dessus)" >&2
  exit 1
fi
cp "$tmp/a.sums" "$out"
echo "repro : $(wc -l <"$out") fichiers identiques dans les deux builds ($out)"
