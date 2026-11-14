#!/usr/bin/env bash
# Mise en ligne de Shhdrop (spec §15.3, D3) : installe une version précise, désignée par
# l'empreinte de son image, contrôle la santé, et revient à la version précédente si le
# contrôle échoue. Lancé à la main, sur le serveur, depuis une copie du dépôt.
#
#   deploy/deploy.sh sha256:<64 chiffres hexadécimaux>   installe cette version
#   deploy/deploy.sh rollback                             réinstalle la version précédente
#   deploy/deploy.sh status                               versions et état des conteneurs
#   deploy/deploy.sh admin freeze|unfreeze|destroy -|wipe --yes
#                                                         commandes de la spec §15.3
#   deploy/deploy.sh diagnose                             serveur au premier plan, pour lire
#                                                         un refus de démarrer (rien n'est écrit)
#
# Réglages : deploy/.env (modèle : deploy/env.example). Aucun secret qui ouvre quoi que ce soit :
# le tableau de bord n'y a que l'EMPREINTE de son jeton (SHH_ADMIN_TOKEN_SHA256, README §4), le
# jeton reste chez l'exploitant. Tout deploy/.env est exporté aux commandes de ce script (set -a).
# État : deploy/.release (empreinte en service) et deploy/.release.prev (la précédente).
#
# Limites, dites aussi dans le README :
#   - le retour arrière ne concerne que l'image ; Caddyfile et compose.yaml viennent de la
#     copie du dépôt (pour les ramener en arrière : git, puis relancer ce script) ;
#   - la vérification de provenance de la spec §28.7 n'est pas faite : web/scripts/
#     release-manifest.mjs et verify-site.mjs existent, mais ni release.yml ni signature cosign
#     (aucun release.json signé à vérifier) ; ce script ne la fait pas, et le rappelle à chaque
#     installation (README, §3 et §9).
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$here"

die() {
	printf 'erreur: %s\n' "$1" >&2
	exit "${2:-1}"
}
usage() {
	printf 'usage: deploy.sh sha256:<empreinte> | rollback | status | admin <commande> | diagnose\n' >&2
	exit 2
}

[ $# -ge 1 ] || usage
[ -f .env ] || die "deploy/.env absent (copier deploy/env.example et l'adapter)"
set -a
# shellcheck disable=SC1091 # fichier propre à chaque serveur
. ./.env
set +a
: "${SHH_DOMAIN:?SHH_DOMAIN manquant dans deploy/.env}"
: "${SHH_DATA_ROOT:?SHH_DATA_ROOT manquant dans deploy/.env}"
: "${SHH_IMAGE_REPO:?SHH_IMAGE_REPO manquant dans deploy/.env}"
# Autorités pour le contrôle TLS. Changé seulement par les essais (autorité interne de Caddy).
ca=${SHH_CHECK_CA:-/etc/ssl/certs/ca-certificates.crt}

SHH_CADDYFILE_SHA256=$(sha256sum Caddyfile | cut -d' ' -f1)
export SHH_CADDYFILE_SHA256

cur=$(cat .release 2>/dev/null || true)
prev=$(cat .release.prev 2>/dev/null || true)
valid() { [[ $1 =~ ^sha256:[0-9a-f]{64}$ ]]; }

# dc <empreinte> <arguments de docker compose…>
# « -f compose.yaml » explicite : sans lui, docker compose fusionne de lui-même un
# compose.override.yaml posé à côté et suit COMPOSE_FILE (deploy/.env), qui pourraient changer
# l'environnement du serveur sans rien dire (audit adverse du 13 novembre, stockage, H1). Un
# seul fichier fait foi : celui de la copie du dépôt.
dc() {
	local digest=$1
	shift
	SHH_IMAGE="$SHH_IMAGE_REPO@$digest" docker compose -f compose.yaml "$@"
}
need_current() { valid "$cur" || die "aucune version installée (deploy/.release absent)"; }

# Contrôles de la machine, bloquants (spec §15.1, §22 ; audits de confidentialité P5, P6).
preflight() {
	local opts src
	docker compose version >/dev/null 2>&1 || die "docker compose introuvable"
	mountpoint -q "$SHH_DATA_ROOT" ||
		die "$SHH_DATA_ROOT n'est pas un point de montage : volume chiffré non déverrouillé ?"
	opts=$(findmnt -no OPTIONS -T "$SHH_DATA_ROOT")
	[[ ",$opts," == *,noatime,* ]] ||
		die "$SHH_DATA_ROOT n'est pas monté avec noatime (options : $opts)"
	[ -d "$SHH_DATA_ROOT/data" ] && [ -d "$SHH_DATA_ROOT/caddy" ] ||
		die "$SHH_DATA_ROOT doit contenir data/ (compte 65532) et caddy/ (root) : voir le README"
	[ "$(wc -l </proc/swaps)" -le 1 ] ||
		die "mémoire d'échange active (swapon --show) : la désactiver (spec §22)"
	# Simple avertissement : la détection ne connaît que dm-crypt (LUKS), pas d'autre montage.
	src=$(findmnt -no SOURCE -T "$SHH_DATA_ROOT")
	if ! lsblk -s -n -o TYPE "$src" 2>/dev/null | grep -qx crypt; then
		printf 'AVERTISSEMENT : %s (%s) ne semble pas être sur un volume LUKS (spec §22).\n' "$SHH_DATA_ROOT" "$src" >&2
	fi
}

# Contrôle de santé d'une version en service. Rend 0 si tout passe.
check() {
	local i code
	# 1. Le conteneur du serveur se dit en bonne santé (/healthz local, via shhcheck).
	dc "$1" up -d --wait --wait-timeout 120 >/dev/null 2>&1 || {
		echo "contrôle : conteneurs pas en bonne santé (attente : 120 s au plus)" >&2
		return 1
	}
	# 2. De bout en bout à travers Caddy, sans dépendre du DNS : /api ne répond 200 que si
	#    Caddy pose X-Shh-Client-IP et que le serveur lui fait confiance. Jusqu'à 2 min :
	#    à la première installation, Caddy doit d'abord obtenir son certificat.
	code=000
	for i in $(seq 1 40); do
		code=$(curl -sS --noproxy '*' --max-time 10 --cacert "$ca" --resolve "$SHH_DOMAIN:443:127.0.0.1" \
			-o /dev/null -w '%{http_code}' "https://$SHH_DOMAIN/api/captcha" 2>/dev/null) || true
		[ "$code" = 200 ] && break
		sleep 3
	done
	[ "$code" = 200 ] || {
		echo "contrôle : https://$SHH_DOMAIN/api/captcha répond $code après $i essais (attendu : 200)" >&2
		return 1
	}
	# 3. La page d'accueil arrive avec les en-têtes du serveur Go.
	curl -sS --noproxy '*' --max-time 10 --cacert "$ca" --resolve "$SHH_DOMAIN:443:127.0.0.1" \
		-o /dev/null -D - "https://$SHH_DOMAIN/" | grep -qi '^strict-transport-security:' || {
		echo "contrôle : page d'accueil sans Strict-Transport-Security" >&2
		return 1
	}
	# 4. Test bloquant de la spec §30 : échange de clés hybride X25519MLKEM768.
	docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges:true \
		--log-driver none -v "$ca:/ca.pem:ro" -e SSL_CERT_FILE=/ca.pem --entrypoint /shhcheck \
		"$SHH_IMAGE_REPO@$1" tls 127.0.0.1:443 "$SHH_DOMAIN" || {
		echo "contrôle : pas d'échange de clés X25519MLKEM768 en TLS 1.3" >&2
		return 1
	}
}

install_version() {
	local new=$1
	valid "$new" || usage
	# Une seule installation à la fois (status et admin restent possibles pendant ce temps).
	exec 9>.deploy.lock
	flock -n 9 || die "une autre installation est en cours"
	preflight
	echo "RAPPEL : vérification de provenance (spec §28.7) NON faite : aucun release.json signé (cosign) à vérifier ; verify-site.mjs se lance à la main, depuis un autre poste (README, §3)."
	# Image absente : téléchargée par empreinte (le contenu est donc vérifié par Docker).
	docker image inspect "$SHH_IMAGE_REPO@$new" >/dev/null 2>&1 || docker pull "$SHH_IMAGE_REPO@$new"

	echo "installation de $new"
	dc "$new" up -d --remove-orphans || true # l'échec éventuel est constaté par check
	if check "$new"; then
		if [ "$new" != "$cur" ]; then
			if valid "$cur"; then printf '%s\n' "$cur" >.release.prev; fi
			printf '%s\n' "$new" >.release.tmp && mv .release.tmp .release
		fi
		echo "en service : $new"
		return 0
	fi

	if valid "$cur" && [ "$cur" != "$new" ]; then
		echo "ÉCHEC du contrôle : retour à $cur" >&2
		dc "$cur" up -d --remove-orphans || true
		if check "$cur"; then
			echo "retour arrière fait : $cur est en service" >&2
		else
			echo "ATTENTION : le retour arrière échoue aussi au contrôle. Site à vérifier à la main." >&2
		fi
	else
		echo "ÉCHEC du contrôle, et aucune autre version à remettre : pile arrêtée." >&2
		dc "$new" down || true
	fi
	exit 1
}

case $1 in
sha256:*)
	[ $# -eq 1 ] || usage
	install_version "$1"
	;;
rollback)
	[ $# -eq 1 ] || usage
	valid "$prev" || die "aucune version précédente (deploy/.release.prev absent)"
	install_version "$prev"
	;;
status)
	[ $# -eq 1 ] || usage
	echo "en service : ${cur:-aucune}"
	echo "précédente : ${prev:-aucune}"
	if valid "$cur"; then dc "$cur" ps -a; fi
	;;
admin)
	# Dans le conteneur en marche : même dossier de données, même compte. L'entrée standard
	# est transmise (destroy - lit le lien dessus). Le code de sortie est celui de la commande.
	[ $# -ge 2 ] || usage
	need_current
	shift
	dc "$cur" exec -T shhdrop /shhdrop admin "$@"
	;;
diagnose)
	# Le pilote de journal est « none » : un refus de démarrer ne se lit nulle part. Ici le
	# serveur est arrêté puis lancé au premier plan ; Ctrl-C pour finir, puis réinstaller.
	[ $# -eq 1 ] || usage
	need_current
	dc "$cur" stop shhdrop
	echo "serveur au premier plan (Ctrl-C pour arrêter), puis : deploy/deploy.sh $cur"
	dc "$cur" run --rm --no-deps shhdrop serve
	;;
*) usage ;;
esac
