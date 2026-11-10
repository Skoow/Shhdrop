#!/usr/bin/env bash
# Test du proxy : le Caddyfile de production devant le vrai serveur Go, sur la boucle locale.
#
# Ce qui est prouvé (audit de sécurité F3, audit de confidentialité P6, spec §28.7, §30, §36) :
#   1. « caddy validate » et « caddy fmt --diff » sur deploy/Caddyfile ;
#   2. X-Shh-Client-IP envoyé par le client est REMPLACÉ par l'adresse du pair TCP, et rien
#      d'autre ne porte l'adresse ni ne décrit le navigateur vers le serveur ;
#   3. /api fonctionne à travers Caddy avec SHH_BEHIND_PROXY=1, et la limite de débit ne se
#      contourne pas en changeant l'en-tête ;
#   4. les en-têtes du serveur Go arrivent une seule fois, les octets ne changent pas ;
#   5. TLS 1.3, échange de clés X25519MLKEM768, redirection HTTP vers HTTPS ;
#   6. aucune adresse de client dans ce que Caddy et le serveur écrivent (fichiers, sorties).
#
# Ce qui n'est PAS prouvé ici : Docker (pilote de journal, réseau), journald, le vrai
# certificat Let's Encrypt, un envoi complet de partage à travers Caddy (voir README).
#
# Seules différences avec la production : deux lignes ajoutées au Caddyfile (certificat de
# l'autorité interne de Caddy, non installée dans le système), et les ports, par variables.
#
# Usage : deploy/test-proxy.sh
#   CADDY=…        binaire caddy (défaut : celui du PATH), 2.10 ou plus
#   SHHDROP_BIN=…  binaire du serveur (défaut : construit depuis server/)
#   SHHCHECK_BIN=… binaire shhcheck (défaut : construit depuis deploy/shhcheck/)
#   STATIC_DIR=…   site construit (défaut : web/dist, qui doit exister)
#   PORT_BASE=…    premier de 6 ports locaux libres (défaut : 18400)
#   KEEP=1         garde le dossier de travail après le test
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(dirname "$here")
caddy=${CADDY:-caddy}
static=${STATIC_DIR:-$repo/web/dist}
base=${PORT_BASE:-18400}
p_go=$base p_echo=$((base + 1))
p_http=$((base + 2)) p_https=$((base + 3))
p_http_e=$((base + 4)) p_https_e=$((base + 5))

name=shhdrop.test          # nom du site pour le test (aucune requête DNS : --resolve)
client=127.83.71.9         # adresse source du client de test : repère cherché dans les écrits
client2=127.83.71.10       # autre client, pour la limite de débit
spoof=198.51.100.77        # adresse que le client tente de faire croire

fails=0
ok() { printf 'ok    %s\n' "$1"; }
ko() {
	printf 'ÉCHEC %s\n' "$1"
	fails=$((fails + 1))
}
check() { # check <description> <commande…>
	local d=$1
	shift
	if "$@" >/dev/null 2>&1; then ok "$d"; else ko "$d"; fi
}
die() {
	printf 'erreur: %s\n' "$1" >&2
	exit 2
}

command -v "$caddy" >/dev/null || die "caddy introuvable (CADDY=…)"
command -v curl >/dev/null || die "curl introuvable"
[ -f "$static/index.html" ] || die "site absent : $static (cd web && npm ci --ignore-scripts && npm run build)"

work=$(mktemp -d "${TMPDIR:-/tmp}/shh-proxy.XXXXXX")
srv=$work/serveur # tout ce que Caddy et le serveur Go écrivent : fouillé à la fin
cli=$work/client  # réponses reçues par le client de test : non fouillé
mkdir -p "$srv/data" "$srv/caddy-a" "$srv/caddy-b" "$srv/xdg-config" "$srv/home" "$cli" "$work/echo" "$work/bin"
pids=()
cleanup() {
	for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
	wait 2>/dev/null || true
	if [ "${KEEP:-0}" = 1 ]; then echo "dossier gardé : $work"; else rm -rf "$work"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP PIPE

# Caddy écoute avec SO_REUSEPORT : un port déjà pris par un autre Caddy ne ferait pas
# échouer le démarrage, les connexions seraient réparties entre les deux. Refus net.
for port in $(seq "$base" $((base + 5))); do
	if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then die "port $port déjà pris (PORT_BASE=…)"; fi
done

# --- 1. Fichier de production : validation et mise en forme -------------------------------
echo "caddy : $("$caddy" version)"
check "caddy validate (Caddyfile de production)" \
	env SHH_DOMAIN=$name "$caddy" validate --config "$here/Caddyfile" --adapter caddyfile
check "caddy fmt --diff : aucune différence" "$caddy" fmt --diff "$here/Caddyfile"
check "SHH_DOMAIN vide : configuration refusée" \
	bash -c "! SHH_DOMAIN= '$caddy' validate --config '$here/Caddyfile' --adapter caddyfile"
# Structure : seuls ces gestionnaires. Tout autre (encode, templates, rewrite, file_server,
# metrics…) changerait des octets ou ouvrirait une surface que la spec exclut (§28.7, §35.1).
handlers=$(SHH_DOMAIN=$name "$caddy" adapt --config "$here/Caddyfile" --adapter caddyfile 2>/dev/null |
	grep -o '"handler":"[a-z_]*"' | sort -u | tr '\n' ' ')
check "gestionnaires du Caddyfile : headers, request_body, reverse_proxy, static_response, subroute ($handlers)" \
	test "$handlers" = '"handler":"headers" "handler":"request_body" "handler":"reverse_proxy" "handler":"static_response" "handler":"subroute" '

# --- Caddyfile de test : production + 2 lignes --------------------------------------------
sed -e 's/^\tadmin off$/&\n\tskip_install_trust/' \
	-e 's/^\ttls {$/&\n\t\tissuer internal/' "$here/Caddyfile" >"$work/Caddyfile"
added=$(diff "$here/Caddyfile" "$work/Caddyfile" | grep -c '^>' || true)
removed=$(diff "$here/Caddyfile" "$work/Caddyfile" | grep -c '^<' || true)
[ "$added" = 2 ] && [ "$removed" = 0 ] || die "le Caddyfile de test doit être celui de production plus 2 lignes"

# --- Binaires -------------------------------------------------------------------------------
shhdrop=${SHHDROP_BIN:-}
if [ -z "$shhdrop" ]; then
	shhdrop=$work/bin/shhdrop
	(cd "$repo/server" && CGO_ENABLED=0 go build -trimpath -o "$shhdrop" ./cmd/shhdrop)
fi
shhcheck=${SHHCHECK_BIN:-}
if [ -z "$shhcheck" ]; then
	shhcheck=$work/bin/shhcheck
	(cd "$here/shhcheck" && CGO_ENABLED=0 go build -trimpath -o "$shhcheck" .)
fi

# --- Démarrage ------------------------------------------------------------------------------
# Serveur Go, comme en production : derrière le proxy, échec fermé.
env -i PATH="$PATH" SHH_DATA_DIR="$srv/data" SHH_STATIC_DIR="$static" SHH_LISTEN="127.0.0.1:$p_go" \
	SHH_BEHIND_PROXY=1 SHH_STORAGE_MAX=1073741824 \
	"$shhdrop" serve >"$srv/shhdrop.stdout" 2>"$srv/shhdrop.stderr" &
pids+=($!)

# Amont « écho » : rend les en-têtes qu'il reçoit (pour voir ce que Caddy transmet).
# shellcheck disable=SC2016 # gabarit de Caddy, pas des variables du shell
printf '{{range $k, $v := .Req.Header}}{{$k}}:{{range $v}} [{{.}}]{{end}}\n{{end}}' >"$work/echo/echo.txt"
cat >"$work/echo.Caddyfile" <<EOF
{
	admin off
	persist_config off
	auto_https off
	log default {
		output discard
	}
}
http://:$p_echo {
	bind 127.0.0.1
	root * $work/echo
	method * GET
	rewrite * /echo.txt
	templates
	file_server
}
EOF
caddy_env=(env -i PATH="$PATH" HOME="$srv/home" XDG_CONFIG_HOME="$srv/xdg-config")
"${caddy_env[@]}" XDG_DATA_HOME="$work/echo-data" "$caddy" run --config "$work/echo.Caddyfile" --adapter caddyfile >"$work/echo.out" 2>&1 &
pids+=($!)

# Caddy A devant le serveur Go ; Caddy B (même fichier) devant l'écho. Un dossier de données
# chacun : chacun crée sa propre autorité interne.
"${caddy_env[@]}" XDG_DATA_HOME="$srv/caddy-a" SHH_DOMAIN=$name SHH_UPSTREAM="127.0.0.1:$p_go" SHH_HTTP_PORT="$p_http" SHH_HTTPS_PORT="$p_https" \
	"$caddy" run --config "$work/Caddyfile" --adapter caddyfile >"$srv/caddy-a.stdout" 2>"$srv/caddy-a.stderr" &
pids+=($!)
"${caddy_env[@]}" XDG_DATA_HOME="$srv/caddy-b" SHH_DOMAIN=$name SHH_UPSTREAM="127.0.0.1:$p_echo" SHH_HTTP_PORT="$p_http_e" SHH_HTTPS_PORT="$p_https_e" \
	"$caddy" run --config "$work/Caddyfile" --adapter caddyfile >"$srv/caddy-b.stdout" 2>"$srv/caddy-b.stderr" &
pids+=($!)

ca_a=$srv/caddy-a/caddy/pki/authorities/local/root.crt
ca_b=$srv/caddy-b/caddy/pki/authorities/local/root.crt
ca=$cli/autorites.pem # les deux autorités internes du test
# c : client de test, à travers Caddy (TLS vérifié contre l'autorité interne du test).
c() { curl -sS --noproxy '*' --max-time 20 --cacert "$ca" --interface "$client" \
	--resolve "$name:$p_https:127.0.0.1" --resolve "$name:$p_https_e:127.0.0.1" "$@"; }
# d : accès direct au serveur Go, sans Caddy (témoin).
d() { curl -sS --noproxy '*' --max-time 20 "$@"; }
A=https://$name:$p_https
E=https://$name:$p_https_e
G=http://127.0.0.1:$p_go

ready=0
for _ in $(seq 1 100); do
	if [ -s "$ca_a" ] && [ -s "$ca_b" ] && cat "$ca_a" "$ca_b" >"$ca" &&
		c -o /dev/null "$A/" 2>/dev/null && c -o /dev/null "$E/" 2>/dev/null; then
		ready=1
		break
	fi
	sleep 0.2
done
[ "$ready" = 1 ] || {
	cat "$srv"/*.stderr >&2 || true
	die "démarrage raté (ports $base à $((base + 5)) libres ?)"
}

# --- 2. Ce que Caddy transmet au serveur (amont écho) --------------------------------------
hostile=(-H "X-Shh-Client-IP: $spoof" -H "X-Shh-Client-IP: 203.0.113.5" -H "X-Forwarded-For: $spoof"
	-H "X-Forwarded-Host: evil.example" -H "X-Forwarded-Proto: http" -H "Forwarded: for=$spoof"
	-H "X-Real-IP: $spoof" -H "Via: 1.1 $spoof" -H "User-Agent: UA-REPERE" -H "Referer: https://ref.example/REPERE"
	-H "Accept-Language: fr-REPERE" -H "Cookie: c=REPERE" -H 'Sec-CH-UA: "REPERE"' -H "Sec-CH-UA-Platform: REPERE"
	-H "Sec-Fetch-Site: REPERE" -H "DNT: 1" -H "Priority: u=1" -H "Accept-Encoding: br, gzip")
for proto in --http1.1 --http2; do
	out=$cli/echo$proto.txt
	check "$proto écho : l'amont répond" test "$(c $proto "${hostile[@]}" -o "$out" -w '%{http_code}' "$E/api/x")" = 200
	check "$proto écho : la liste des en-têtes reçus n'est pas vide" grep -qi '^Accept:' "$out"
	check "$proto écho : X-Shh-Client-IP vaut exactement [$client], une seule valeur" \
		grep -qixF "X-Shh-Client-Ip: [$client]" "$out"
	check "$proto écho : aucune adresse usurpée ($spoof, 203.0.113.5)" \
		bash -c "! grep -qE '198\.51\.100\.77|203\.0\.113\.5' '$out'"
	check "$proto écho : ni X-Forwarded-*, Forwarded, X-Real-IP, Via" \
		bash -c "! grep -qiE '^(X-Forwarded-[a-z]+|Forwarded|X-Real-Ip|Via):' '$out'"
	check "$proto écho : ni User-Agent du client, Referer, Accept-Language, Cookie, Sec-CH-UA*, Sec-Fetch-*, DNT, Priority" \
		bash -c "! grep -qiE 'REPERE|^(Referer|Accept-Language|Cookie|Sec-Ch-Ua[a-z-]*|Sec-Fetch-[a-z-]+|Dnt|Priority):' '$out'"
	check "$proto écho : Accept-Encoding transmis tel quel" grep -qixF "Accept-Encoding: [br, gzip]" "$out"
done
c --http1.1 -o "$cli/echo-noae.txt" "$E/"
check "écho sans Accept-Encoding : la liste des en-têtes reçus n'est pas vide" grep -qi '^Accept:' "$cli/echo-noae.txt"
check "écho : sans Accept-Encoding du client, Caddy n'en ajoute pas" \
	bash -c "! grep -qi '^Accept-Encoding:' '$cli/echo-noae.txt'"
echo "--- en-têtes reçus par l'amont (requête hostile, HTTP/2) :"
sed 's/^/    /' "$cli/echo--http2.txt"

# --- 3. /api de bout en bout, serveur Go réel, SHH_BEHIND_PROXY=1 --------------------------
code() { "$@" -o /dev/null -w '%{http_code}'; }
check "témoin : direct, sans X-Shh-Client-IP → 500 (échec fermé)" \
	test "$(code d "$G/api/captcha")" = 500
check "témoin : direct, X-Shh-Client-IP invalide → 500" \
	test "$(code d -H 'X-Shh-Client-IP: pas-une-adresse' "$G/api/captcha")" = 500
check "via Caddy : GET /api/captcha → 200" test "$(code c "$A/api/captcha")" = 200
check "via Caddy : X-Shh-Client-IP invalide envoyé par le client → 200 (remplacé)" \
	test "$(code c -H 'X-Shh-Client-IP: pas-une-adresse' "$A/api/captcha")" = 200
check "via Caddy : deux X-Shh-Client-IP envoyés par le client → 200 (remplacés par un seul)" \
	test "$(code c -H "X-Shh-Client-IP: $spoof" -H 'X-Shh-Client-IP: 203.0.113.5' "$A/api/captcha")" = 200
c -o "$cli/captcha.json" "$A/api/captcha"
check "via Caddy : /api/captcha rend du JSON" grep -q '^{.*}$' "$cli/captcha.json"
check "via Caddy : POST /api/shares, corps invalide → 400 du serveur Go" \
	test "$(code c -X POST -H 'Content-Type: application/json' -d '{}' "$A/api/shares")" = 400
check "via Caddy : /healthz → 404 (réservé à la boucle locale sans proxy)" test "$(code c "$A/healthz")" = 404
check "direct : shhcheck health → ok" "$shhcheck" health "127.0.0.1:$p_go"
head -c 4195376 /dev/zero >"$cli/segment.bin"
head -c 6291456 /dev/zero >"$cli/trop.bin"
seg=$(code c -X PUT --data-binary "@$cli/segment.bin" "$A/api/shares/segments/0")
check "via Caddy : PUT d'un segment entier (4 195 376 octets) sans jeton → refus du serveur Go, pas 413 (reçu $seg)" \
	bash -c "[ '$seg' != 413 ] && [ '$seg' -ge 400 ] && [ '$seg' -lt 500 ]"
check "via Caddy : PUT de 6 Mio → 413" \
	test "$(code c -X PUT --data-binary "@$cli/trop.bin" "$A/api/shares/segments/0")" = 413

# Limite de débit (60 requêtes par minute et par adresse) : 130 requêtes d'un même client qui
# change X-Shh-Client-IP à chaque fois. Si l'en-tête du client passait, aucune ne serait refusée.
limited=0
for i in $(seq 1 130); do
	s=$(curl -sS --noproxy '*' --max-time 20 --cacert "$ca" --interface "$client2" --resolve "$name:$p_https:127.0.0.1" \
		-H "X-Shh-Client-IP: 203.0.113.$i" -o /dev/null -w '%{http_code}' "$A/api/shares/meta")
	[ "$s" = 429 ] && limited=$((limited + 1))
done
check "limite de débit : 130 requêtes avec 130 X-Shh-Client-IP différents → des 429 ($limited reçus)" test "$limited" -ge 1

# --- 4. En-têtes de réponse et octets ---------------------------------------------------------
asset=$(cd "$static" && find assets -name '*.js' | sort | head -n 1)
[ -n "$asset" ] || die "aucun fichier .js dans $static/assets"
hdrs() { tr -d '\r' <"$1" | tail -n +2 | grep -v -i '^date:' | grep -v '^$' | tr '[:upper:]' '[:lower:]' | sort; }
for path in / "/$asset" /api/captcha /x.js; do
	n=$(printf '%s' "$path" | tr -c 'a-zA-Z0-9' _)
	d --http1.1 -H "X-Shh-Client-IP: $client" -H 'Accept-Encoding: br' -D "$cli/h-direct$n" -o /dev/null "$G$path"
	c --http1.1 -H 'Accept-Encoding: br' -D "$cli/h-caddy$n" -o /dev/null "$A$path"
	if [ "$path" = /api/captcha ]; then # corps aléatoire : la longueur peut varier
		check "$path : mêmes en-têtes qu'en direct (hors Date, Content-Length)" \
			diff <(hdrs "$cli/h-direct$n" | grep -v '^content-length:') <(hdrs "$cli/h-caddy$n" | grep -v '^content-length:')
	else
		check "$path : en-têtes identiques à ceux du serveur Go (hors Date)" \
			diff <(hdrs "$cli/h-direct$n") <(hdrs "$cli/h-caddy$n")
	fi
	for h in content-security-policy strict-transport-security referrer-policy x-content-type-options \
		permissions-policy cross-origin-opener-policy cross-origin-resource-policy cache-control; do
		got=$(hdrs "$cli/h-caddy$n" | grep -c "^$h:" || true)
		[ "$got" = 1 ] || ko "$path : $h présent $got fois (attendu : 1)"
	done
	check "$path : ni Server, ni Via, ni Alt-Svc" bash -c "! grep -qiE '^(server|via|alt-svc):' '$cli/h-caddy$n'"
done
ok "8 en-têtes de sécurité présents une seule fois sur /, /$asset, /api/captcha, /x.js (sauf ÉCHEC ci-dessus)"

for enc in br gzip identity; do
	for path in / "/$asset"; do
		a=$(d -H "X-Shh-Client-IP: $client" -H "Accept-Encoding: $enc" "$G$path" | sha256sum)
		b=$(c -H "Accept-Encoding: $enc" "$A$path" | sha256sum)
		check "$path ($enc) : octets identiques en direct et via Caddy" test "$a" = "$b"
	done
done
# Tous les fichiers du site, avec « Accept-Encoding: gzip, br » : même encodage et mêmes
# octets qu'en direct (un « encode » dans Caddy compresserait ceux que le build n'a pas compressés).
nfiles=0
ndiff=0
while IFS= read -r f; do
	nfiles=$((nfiles + 1))
	a=$(d -H "X-Shh-Client-IP: $client" -H 'Accept-Encoding: gzip, br' -w '%header{content-encoding}' "$G/$f" | sha256sum)
	b=$(c -H 'Accept-Encoding: gzip, br' -w '%header{content-encoding}' "$A/$f" | sha256sum)
	[ "$a" = "$b" ] || {
		ndiff=$((ndiff + 1))
		ko "/$f : réponse différente en direct et via Caddy"
	}
done < <(cd "$static" && find . -type f ! -name '*.br' ! -name '*.gz' | sed 's|^\./||' | sort)
check "$nfiles fichiers du site : encodage et octets identiques en direct et via Caddy" test "$ndiff" = 0
a=$(c "$A/$asset" | sha256sum | cut -d' ' -f1)
b=$(sha256sum <"$static/$asset" | cut -d' ' -f1)
check "/$asset sans Accept-Encoding : octets du fichier de dist" test "$a" = "$b"

# --- 5. TLS ---------------------------------------------------------------------------------
tlsout=$(SSL_CERT_FILE=$ca "$shhcheck" tls "127.0.0.1:$p_https" "$name" 2>&1) || true
check "TLS 1.3 avec X25519MLKEM768 seul proposé (spec §30) : « $tlsout »" test "$tlsout" = "TLS 1.3, X25519MLKEM768"
check "TLS 1.2 refusé" bash -c "! curl -sS --noproxy '*' --max-time 10 --cacert '$ca' --tls-max 1.2 \
	--resolve '$name:$p_https:127.0.0.1' -o /dev/null '$A/'"
loc=$(curl -sS --noproxy '*' --max-time 10 --interface "$client" -o /dev/null -w '%{http_code} %{redirect_url}' \
	-H "Host: $name" "http://127.0.0.1:$p_http/abc")
check "HTTP → HTTPS : « $loc »" test "$loc" = "308 https://$name/abc"

# --- 6. Rien d'écrit avec l'adresse du client -----------------------------------------------
# Erreurs provoquées depuis l'adresse repère : HTTP en clair sur le port TLS, TLS 1.2, nom
# inconnu, connexion coupée. Par défaut, Caddy les écrirait avec l'adresse (audit P6).
curl -sS --noproxy '*' --max-time 5 --interface "$client" -o /dev/null "http://127.0.0.1:$p_https/" 2>/dev/null || true
curl -sS --noproxy '*' --max-time 5 --interface "$client" --cacert "$ca" --tls-max 1.2 \
	--resolve "$name:$p_https:127.0.0.1" -o /dev/null "$A/" 2>/dev/null || true
curl -sS --noproxy '*' --max-time 5 --interface "$client" -k -o /dev/null "https://127.0.0.1:$p_https/" 2>/dev/null || true
c --max-time 1 --limit-rate 1k -o /dev/null "$A/$asset" 2>/dev/null || true
# Serveur Go arrêté : Caddy répond 502. Par défaut, il écrirait cette erreur avec l'adresse
# et tous les en-têtes de la requête.
kill "${pids[0]}" && wait "${pids[0]}" 2>/dev/null || true
check "serveur Go arrêté : 502 de Caddy" \
	test "$(code c -H 'User-Agent: UA-REPERE' -H 'Cookie: c=REPERE' "$A/api/captcha")" = 502
sleep 1
for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
wait 2>/dev/null || true
pids=()

echo "--- fichiers écrits par Caddy et le serveur Go :"
(cd "$srv" && find . -type f -printf '    %s octets  %p\n' | sort -k3)
raw=$(printf '\x7f\x53\x47\x09') # 127.83.71.9 en 4 octets
hits_txt=$(LC_ALL=C grep -rlaF -e "$client" -e "$client2" -e "$spoof" "$srv" || true)
hits_raw=$(LC_ALL=C grep -rlaF -e "$raw" "$srv" || true)
check "aucune adresse de client en texte ($client, $client2, $spoof) dans les écrits" test -z "$hits_txt"
check "aucune adresse de client en 4 octets dans les écrits" test -z "$hits_raw"
check "aucun repère d'en-tête (REPERE) dans les écrits" bash -c "! LC_ALL=C grep -rqaF REPERE '$srv'"
check "sortie standard du serveur Go : la seule ligne SHH_LISTENING" \
	test "$(cat "$srv/shhdrop.stdout")" = "SHH_LISTENING 127.0.0.1:$p_go"
check "sortie d'erreur du serveur Go : vide" test ! -s "$srv/shhdrop.stderr"
check "sortie standard de Caddy : vide" test ! -s "$srv/caddy-a.stdout"
check "sortie d'erreur de Caddy : vide" test ! -s "$srv/caddy-a.stderr"
[ -n "$hits_txt$hits_raw" ] && printf 'fichiers en cause :\n%s\n' "$hits_txt$hits_raw"

echo
if [ "$fails" -eq 0 ]; then
	echo "RÉUSSI : tous les contrôles passent."
else
	echo "ÉCHEC : $fails contrôle(s) en échec."
	exit 1
fi
