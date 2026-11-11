# Déploiement de Shhdrop

Caddy (TLS) devant le serveur Go, dans Docker. Références : spécification §8, §9.4, §10, §15, §22, §28.7, §30, §36 ; audits du 5 novembre (confidentialité P5 et P6, sécurité F3).

| Fichier | Rôle |
|---|---|
| `Caddyfile` | TLS 1.3, échange de clés hybride, remplacement de `X-Shh-Client-IP`, aucun journal |
| `Dockerfile` | image du serveur : binaire Go statique + site, sur `scratch`, compte 65532 |
| `compose.yaml` | les deux conteneurs, en lecture seule, sans capacité, sans journal |
| `deploy.sh` | installe une version par empreinte, contrôle, revient en arrière ; commandes d'administration |
| `shhcheck/` | petit programme Go : santé du conteneur, test TLS hybride |
| `test-proxy.sh` | test du proxy : le Caddyfile devant le vrai serveur, sur la boucle locale |
| `env.example` | modèle de `deploy/.env` |

Ce kit réduit les risques ; il ne rend pas le service invulnérable. Les limites sont listées en fin de page.

## 1. Avant d'installer

Chez l'hébergeur et le registraire :

- serveur loué **hors UE** (Suisse ou Islande, §15.1), trafic sortant inclus vérifié, aucun CDN ni proxy devant ;
- instantanés et sauvegardes de la machine **désactivés** chez l'hébergeur, aucun agent de surveillance de l'hébergeur ;
- DNS : `A` et `AAAA` vers le serveur ; **DNSSEC** activé ; `CAA 0 issue "letsencrypt.org"` ; double authentification et verrou de transfert (§15.4).

Sur la machine (Linux récent, Docker Engine 25 ou plus avec Compose 2.24 ou plus) :

- **2 processeurs et 2 Gio de mémoire au moins** : `compose.yaml` plafonne le serveur à 1,5 processeur et 1 Gio, Caddy à 1 processeur et 256 Mio (raisons dans le fichier). Avec moins de 2 processeurs, Docker refuse de démarrer le serveur ;

- **disque** : `SHH_STORAGE_MAX` + 1 Gio libres au moins (201 Gio par défaut), sinon le serveur refuse de démarrer ;
- **volume chiffré** LUKS2 (AES-256-XTS, Argon2id) pour toutes les données, monté avec **`noatime`** ; la phrase de déverrouillage n'est jamais stockée sur le serveur (§22) ;
- **pas de mémoire d'échange** : `swapoff -a`, ligne retirée de `/etc/fstab` (`deploy.sh` refuse d'installer sinon) ;
- **vidages mémoire coupés** : `kernel.core_pattern=|/bin/false` dans `/etc/sysctl.d/`, en plus de la limite posée sur les conteneurs ;
- **journald en mémoire** : `Storage=volatile` dans `/etc/systemd/journald.conf` (sinon `sshd` et le pare-feu écrivent des adresses sur disque) ; pas de journal des paquets refusés par le pare-feu (`ufw logging off`) ;
- **heure** synchronisée (NTP : `timedatectl set-ntp true`) ;
- **mises à jour de sécurité automatiques**, sans redémarrage automatique de la machine (`unattended-upgrades`, `Automatic-Reboot "false"`, §22) ;
- **SSH par clé seulement** (`PasswordAuthentication no`), **pare-feu** : 22, 80 et 443 en TCP, rien d'autre (pas de HTTP/3, donc pas d'UDP).

## 2. Première installation

```sh
# Volume chiffré (exemple : /dev/sdb ; à adapter). La phrase est demandée au clavier.
cryptsetup luksFormat --type luks2 --cipher aes-xts-plain64 --key-size 512 --pbkdf argon2id /dev/sdb
cryptsetup open /dev/sdb shhdrop
mkfs.ext4 /dev/mapper/shhdrop
mkdir -p /srv/shhdrop
mount -o noatime,nodev,nosuid,noexec /dev/mapper/shhdrop /srv/shhdrop

# Dossiers attendus par compose.yaml (jamais créés par Docker).
install -d -o 65532 -g 65532 -m 0700 /srv/shhdrop/data
install -d -o root -g root -m 0700 /srv/shhdrop/caddy

# Réglages, puis installation d'une version (empreinte de l'image, voir §3).
cp deploy/env.example deploy/.env && editor deploy/.env
deploy/deploy.sh sha256:<empreinte>
```

Ne pas inscrire le volume dans `/etc/fstab` ni `/etc/crypttab` avec une clé : il se déverrouille à la main (§5).

## 3. Mise à jour et retour arrière

L'image est construite ailleurs que sur le serveur, depuis un commit précis, puis publiée dans le registre choisi (`SHH_IMAGE_REPO`) :

```sh
c=$(git rev-parse --short=7 HEAD)
docker build -f deploy/Dockerfile --build-arg SHH_BUILD_ID="$c" -t <registre>/shhdrop:"$c" . && docker push <registre>/shhdrop:"$c"
# « digest: sha256:… » affiché par push : c'est l'empreinte à donner à deploy.sh.
```

`SHH_BUILD_ID` est obligatoire (le build s'arrête sans lui) : c'est le numéro de version affiché par le site, et il doit être celui du commit pour que le site de l'image soit, octet pour octet, celui des builds de la CI (job `repro-docker`, spec §28). Construire depuis un arbre propre (`git status` vide) : des modifications non commitées entreraient dans l'image sous ce numéro.

Vérification du site servi, à faire à la main depuis un autre poste tant que la provenance signée n'existe pas (§9) : construire le site du même commit (`cd web && npm ci --ignore-scripts && npm run build`), en tirer le manifeste (`node scripts/release-manifest.mjs dist --name shhdrop-web --version 0.0.0 --commit "$c" --out /tmp/rel`), puis `node scripts/verify-site.mjs https://<site> /tmp/rel/release.json`.

Sur le serveur :

```sh
git pull                              # Caddyfile, compose.yaml, deploy.sh à jour
deploy/deploy.sh sha256:<empreinte>   # installe, contrôle, revient en arrière si le contrôle échoue
deploy/deploy.sh status               # version en service, version précédente, conteneurs
deploy/deploy.sh rollback             # réinstalle la version précédente
```

Contrôle fait par `deploy.sh`, sans option pour le sauter : conteneur en bonne santé (`/healthz` local) ; `https://<site>/api/captcha` répond 200 à travers Caddy ; page d'accueil avec HSTS ; poignée de main TLS 1.3 limitée à `X25519MLKEM768` (test bloquant de la §30).

À savoir :

- **chaque redémarrage du serveur efface les envois en cours et les partages en cours de lecture** (les jetons ne survivent pas, §36 S12). Relancer `deploy.sh` avec la même empreinte ne redémarre rien ;
- le retour arrière ne concerne que l'image. Pour ramener `Caddyfile` ou `compose.yaml` en arrière : `git checkout <commit> -- deploy/`, puis `deploy.sh` ;
- si le serveur refuse de démarrer, son message n'est écrit nulle part (aucun journal). Pour le lire : `deploy/deploy.sh diagnose`.

## 4. Commandes d'administration (§15.3)

Elles s'exécutent dans le conteneur en marche. Codes de sortie : 0 réussite, 1 échec, 2 erreur d'usage.

```sh
deploy/deploy.sh admin freeze        # suspend les nouveaux envois
deploy/deploy.sh admin unfreeze      # les rétablit
deploy/deploy.sh admin destroy -     # signalement : coller le lien, Entrée, puis Ctrl-D
deploy/deploy.sh admin wipe --yes    # urgence : gèle, puis efface tous les partages
```

Le lien signalé ne se donne **jamais** en argument (il irait dans l'historique du shell) : toujours sur l'entrée standard.

## 5. Après un redémarrage de la machine

Le site reste hors service tant que le volume n'est pas déverrouillé (les conteneurs ne démarrent pas sans lui) :

```sh
cryptsetup open /dev/sdb shhdrop
mount -o noatime,nodev,nosuid,noexec /dev/mapper/shhdrop /srv/shhdrop
deploy/deploy.sh "$(cat deploy/.release)"
```

## 6. Plan d'incident (§15.5)

En cas de doute sur la sécurité du serveur ou du code :

1. `deploy/deploy.sh admin freeze`, puis `deploy/deploy.sh admin wipe --yes` si nécessaire.
2. Changer les accès : clés SSH, GitHub, registraire, registre d'images.
3. Réinstaller le serveur depuis zéro (nouvelle machine, nouveau volume chiffré, §1 et §2). Ne pas reprendre `/srv/shhdrop/caddy` : nouvelles clés TLS, et révoquer les anciens certificats.
4. Publier un avis sur le site.

## 7. Vérifications après chaque mise en ligne

Depuis un autre poste (`D=shhdrop.app`) :

```sh
# 1. En-têtes du serveur Go, une seule fois chacun : 8 lignes attendues.
curl -sSI https://$D/ | grep -iE '^(content-security-policy|strict-transport-security|referrer-policy|x-content-type-options|permissions-policy|cross-origin-opener-policy|cross-origin-resource-policy|cache-control):' | sort | uniq -c

# 2. X-Shh-Client-IP ne se contrefait pas.
#    a) valeur invalide : 200 attendu (Caddy l'a remplacée ; transmise telle quelle, le serveur répondrait 500).
curl -sS -o /dev/null -w '%{http_code}\n' -H 'X-Shh-Client-IP: pas-une-adresse' https://$D/api/captcha
#    b) 130 requêtes avec 130 adresses annoncées : des 429 doivent apparaître (60 requêtes par minute et par adresse réelle).
for i in $(seq 1 130); do curl -sS -o /dev/null -w '%{http_code}\n' -H "X-Shh-Client-IP: 1.2.3.$i" https://$D/api/shares/meta; done | sort | uniq -c

# 3. /healthz n'est pas exposé : 404 attendu.
curl -sS -o /dev/null -w '%{http_code}\n' https://$D/healthz

# 4. TLS : échange de clés hybride (OpenSSL 3.5 ou plus), TLS 1.2 refusé, HTTP redirigé (308).
openssl s_client -connect $D:443 -servername $D -groups X25519MLKEM768 </dev/null 2>/dev/null | grep -iE 'group|protocol'
curl -sS --tls-max 1.2 -o /dev/null https://$D/ ; echo "code de sortie $? (attendu : non nul)"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://$D/

# 5. DNS.
dig +short CAA $D ; dig +dnssec +short $D | head -n 2
```

Sur le serveur, après avoir visité le site depuis une adresse connue (`MOI=<votre adresse IP>`) :

```sh
# 6. Aucun journal de conteneur, aucune adresse sur disque (rien ne doit s'afficher après « none none »).
docker inspect -f '{{.HostConfig.LogConfig.Type}}' shhdrop-shhdrop-1 shhdrop-caddy-1 | xargs
find /var/lib/docker/containers -name '*-json.log' -size +0
ls /var/log/journal 2>/dev/null
grep -rlaF "$MOI" /var/lib/docker /var/log /srv/shhdrop 2>/dev/null

# 7. Volume : noatime, pas de mémoire d'échange (rien ne doit s'afficher pour swapon).
findmnt -no OPTIONS -T /srv/shhdrop | tr ',' '\n' | grep -x noatime
swapon --show

# 8. Dates des fichiers chiffrés, après avoir créé puis ouvert un partage : accès et
#    modification au 1er janvier 1970.
stat -c '%x | %y | %n' /srv/shhdrop/data/blobs/*
ls -la --time-style=long-iso /srv/shhdrop/data
```

Si le test 4 ne peut pas être fait avec OpenSSL (version trop ancienne), le même contrôle par `shhcheck`, sur le serveur :

```sh
docker run --rm --network host --log-driver none -v /etc/ssl/certs/ca-certificates.crt:/ca.pem:ro -e SSL_CERT_FILE=/ca.pem \
  --entrypoint /shhcheck "$SHH_IMAGE_REPO@$(cat deploy/.release)" tls 127.0.0.1:443 $D    # « TLS 1.3, X25519MLKEM768 »
```

## 8. Tester le kit

```sh
CADDY=/chemin/vers/caddy deploy/test-proxy.sh     # Caddy 2.10 ou plus, curl 7.83 ou plus, Go, web/dist construit
make lint-deploy                                  # bash -n, ShellCheck, go vet de shhcheck
```

La CI fait les deux à chaque push : `deploy-lint` (ShellCheck 0.11.0 épinglé), et `repro-docker`, qui construit l'image complète puis lance `test-proxy.sh` avec ses binaires, son site et le Caddy de l'image épinglée dans `compose.yaml`.

`test-proxy.sh` est à relancer à chaque changement du `Caddyfile` ou de version de Caddy : c'est le seul test de la ligne dont dépendent les quotas et l'anti-robot (audit F3).

## 9. Ce que ce kit ne fait pas

- **Démarches légales (§17)** : avis d'un juriste sur la conservation des données d'identification (LCEN, décret 2021-1362, en conflit avec « aucune adresse IP enregistrée »), point de contact DSA, déclaration ANSSI, mentions légales, CGU. Rien n'ouvre au public avant.
- **Provenance du code (§28.7)** : `web/scripts/release-manifest.mjs` et `verify-site.mjs` existent, et la CI prouve que le site de l'image est celui de ses builds (`repro-docker`), mais il n'y a ni `release.yml`, ni signature `cosign` de l'image ou d'un `release.json`, ni registre choisi. `deploy.sh` installe donc l'empreinte qu'on lui donne, sans rien vérifier de sa provenance, et le rappelle à chaque fois ; `verify-site.mjs` se lance à la main (§3).
- **Surveillance (§15.2)** : ni sonde externe (site injoignable, **date de fin du certificat** : Caddy ne journalise rien, un renouvellement raté ne se voit pas autrement), ni script horaire d'alerte (disque à 80 %, signalements). Pour ce script : `df` pour le disque ; `docker exec shhdrop-shhdrop-1 /shhcheck health` affiche `reports_alert`.
- **Déverrouillage (§22)** : pas de `deploy/unlock.sh` ; les trois commandes du §5 en tiennent lieu. Pas d'alerte « redémarrage nécessaire ».
- **Sauvegardes** : aucune, et c'est voulu. La spécification les interdit pour les données (§9.2 : « aucune sauvegarde de ce dossier ») : des partages chiffrés qui vivent 24 h n'ont rien à restaurer, et une sauvegarde garderait ce qui doit disparaître. À sauvegarder ailleurs que sur le serveur : `deploy/.env` (aucun secret) et la phrase du volume, c'est tout. Le dossier `caddy/` se recrée seul (nouveau certificat).
- **Durcissement de la machine** : les réglages du §1 (journald, pare-feu, SSH, mises à jour) sont à faire à la main ; aucun script ne les pose ni ne les vérifie, sauf `noatime` et la mémoire d'échange, contrôlés par `deploy.sh`.
- **Hébergeur** : il voit les adresses IP et peut lire la mémoire de la machine. Hors de portée (§18.3).
- **Envoi complet à travers Caddy** : `test-proxy.sh` prouve le relais (`/api/captcha`, corps d'un segment, en-têtes, octets), pas la création puis l'ouverture d'un partage par un navigateur. À faire à la main après la première installation (tests manuels de la §14).
