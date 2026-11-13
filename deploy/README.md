# Déploiement de Shhdrop

Caddy (TLS) devant le serveur Go, dans Docker. Références : spécification §8, §9.4, §10, §15, §22, §28.7, §30, §36 ; audits du 5 novembre (confidentialité P5 et P6, sécurité F3).

| Fichier | Rôle |
|---|---|
| `Caddyfile` | TLS 1.3, échange de clés hybride, remplacement de `X-Shh-Client-IP`, aucun journal |
| `Dockerfile` | image du serveur : binaire Go statique + site, sur `scratch`, compte 65532 |
| `compose.yaml` | les deux conteneurs, en lecture seule, sans capacité, sans journal |
| `deploy.sh` | installe une version par empreinte, contrôle, revient en arrière ; commandes d'administration |
| `shhcheck/` | petit programme Go : santé du conteneur, test TLS hybride ; `salonws_test.go` : essai du WebSocket du salon à travers Caddy (test seulement, hors du binaire) |
| `test-proxy.sh` | test du proxy : le Caddyfile devant le vrai serveur (salon activé), sur la boucle locale |
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
- **dimensionnement des salons** : au pire, 2 Go de fichiers × `SHH_SALONS_MAX` (plus leurs conversations) ; le garde-fou `SHH_STORAGE_MAX` protège le disque (au-delà, plus de pièce ni de nouveau salon), et `SHH_SALONS_MAX=50` est conseillé pour un petit serveur ;
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

Depuis un autre poste (`D=shhgone.com`) :

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
CADDY=/chemin/vers/caddy deploy/test-proxy.sh     # Caddy 2.10 ou plus, curl 7.83 ou plus, Go, web/dist construit (≈ 2 min 30 : WebSocket gardé 75 s)
make lint-deploy                                  # bash -n, ShellCheck, go vet de shhcheck
```

Le binaire Caddy à donner est celui de l'image épinglée par empreinte dans `compose.yaml` : `docker create` de cette image puis `docker cp …:/usr/bin/caddy` (ce que fait la CI), ou, sans démon Docker, l'index de l'image, son manifeste linux/amd64 et ses couches lus dans le registre, chacun contrôlé par son empreinte SHA-256 avant d'extraire `/usr/bin/caddy`. L'essai long du WebSocket du salon (condition d'activation, §10) : `SALON_GARDE=660` (≈ 14 min en tout).

La CI fait les deux à chaque push : `deploy-lint` (ShellCheck 0.11.0 épinglé), et `repro-docker`, qui construit l'image complète puis lance `test-proxy.sh` avec ses binaires, son site et le Caddy de l'image épinglée dans `compose.yaml`.

`test-proxy.sh` est à relancer à chaque changement du `Caddyfile` ou de version de Caddy : c'est le seul test de la ligne dont dépendent les quotas et l'anti-robot (audit F3).

### Vérification de sécurité hebdomadaire

`.github/workflows/securite.yml` tourne chaque lundi à 04:17 UTC et à la demande (onglet Actions, « Run workflow »). Trois jobs : `govulncheck ./...` (server/), `npm audit --omit=dev --audit-level=moderate` (web/, plus un audit complet informatif qui ne fait pas échouer) et `cargo audit --deny warnings` (engine/, mêmes exceptions que la CI : `engine/.cargo/audit.toml`). Aucun secret.

Un job rouge = une faille connue : GitHub envoie un e-mail d'échec au propriétaire (vérifier que les notifications Actions sont actives pour le dépôt). Pas d'issue automatique. Marche à suivre : lire le journal du job, mettre la dépendance à jour (tests), ou noter l'exception et sa date de réexamen (jamais d'ignore silencieux). Si GitHub n'a lancé aucune exécution pendant 60 jours sans activité sur le dépôt, il désactive les workflows planifiés : les réactiver dans l'onglet Actions.

## 9. Ce que ce kit ne fait pas

- **Démarches légales (§17)** : avis d'un juriste sur la conservation des données d'identification (LCEN, décret 2021-1362, en conflit avec « aucune adresse IP enregistrée »), point de contact DSA, déclaration ANSSI, mentions légales, CGU. Rien n'ouvre au public avant.
- **Provenance du code (§28.7)** : `web/scripts/release-manifest.mjs` et `verify-site.mjs` existent, et la CI prouve que le site de l'image est celui de ses builds (`repro-docker`), mais il n'y a ni `release.yml`, ni signature `cosign` de l'image ou d'un `release.json`, ni registre choisi. `deploy.sh` installe donc l'empreinte qu'on lui donne, sans rien vérifier de sa provenance, et le rappelle à chaque fois ; `verify-site.mjs` se lance à la main (§3).
- **Surveillance (§15.2)** : ni sonde externe (site injoignable, **date de fin du certificat** : Caddy ne journalise rien, un renouvellement raté ne se voit pas autrement), ni script horaire d'alerte (disque à 80 %, signalements). Pour ce script : `df` pour le disque ; `docker exec shhdrop-shhdrop-1 /shhcheck health` affiche `reports_alert`.
- **Déverrouillage (§22)** : pas de `deploy/unlock.sh` ; les trois commandes du §5 en tiennent lieu. Pas d'alerte « redémarrage nécessaire ».
- **Sauvegardes** : aucune, et c'est voulu. La spécification les interdit pour les données (§9.2 : « aucune sauvegarde de ce dossier ») : des partages chiffrés qui vivent 24 h n'ont rien à restaurer, et une sauvegarde garderait ce qui doit disparaître. À sauvegarder ailleurs que sur le serveur : `deploy/.env` (aucun secret) et la phrase du volume, c'est tout. Le dossier `caddy/` se recrée seul (nouveau certificat).
- **Durcissement de la machine** : les réglages du §1 (journald, pare-feu, SSH, mises à jour) sont à faire à la main ; aucun script ne les pose ni ne les vérifie, sauf `noatime` et la mémoire d'échange, contrôlés par `deploy.sh`.
- **Hébergeur** : il voit les adresses IP et peut lire la mémoire de la machine. Hors de portée (§18.3).
- **Caddy tourne en root dans son conteneur** (audit du 13 novembre, D9 ; non corrigé, décision à prendre). Il n'a aucune capacité sauf `NET_BIND_SERVICE` (écouter sur 80 et 443), sous `no-new-privileges`, avec un système de fichiers en lecture seule. Le passer en `user: "65532:65532"` ne marche pas avec l'image officielle épinglée : son binaire porte la capacité de fichier `cap_net_bind_service=+p` (lu dans la couche `sha256:5000c332…` de `caddy:2.11.9` : attribut `security.capability`, bit « effectif » absent), et `no-new-privileges` fait de toute façon ignorer les capacités de fichier. Un Caddy non root ne pourrait donc pas écouter sur 443. Deux voies, à choisir : (a) `sysctl net.ipv4.ip_unprivileged_port_start=80` sur la machine (réglage global : tout processus de la machine pourrait alors prendre 80 ou 443 pendant un redémarrage de Caddy ; `network_mode: host` interdit de le poser pour le seul conteneur), puis `user: "65532:65532"` et le dossier `caddy/` donné à 65532 ; (b) garder root, comme aujourd'hui.
- **Confiance accordée à `X-Shh-Client-IP`** : le serveur Go croit cet en-tête, qui donne l'adresse du client pour les limites, de la seule passerelle `172.30.53.1/32` (`SHH_TRUSTED_PROXY`, `compose.yaml`), c'est-à-dire de la machine où Caddy écoute. **Tout processus de la machine** peut donc joindre `172.30.53.2:8080` et annoncer l'adresse qu'il veut : il contourne toutes les limites par adresse (quotas, places, salons). C'est accepté : la machine ne doit faire tourner que `sshd`, Docker, Caddy et le serveur, et un accès à la machine donne déjà bien plus (mémoire, volume déverrouillé). Caddy, lui, remplace toujours l'en-tête par l'adresse du pair TCP (`header_up X-Shh-Client-IP {remote_host}`, contrôlé par `test-proxy.sh`) ; un pair qui n'est pas la passerelle reçoit 500 (échec fermé).
- **Envoi complet à travers Caddy** : `test-proxy.sh` prouve le relais (`/api/captcha`, corps d'un segment, en-têtes, octets), pas la création puis l'ouverture d'un partage par un navigateur. À faire à la main après la première installation (tests manuels de la §14).
- **WebSocket du salon** : `test-proxy.sh` le garde ouvert 75 s à travers Caddy, en HTTP/1.1. Un WebSocket par HTTP/2 (RFC 8441, que certains navigateurs emploient) n'est pas essayé, et l'essai court ne dépasse pas les délais de Caddy : la première coupure possible est à **5 min** (`read_body 5m`). L'essai long se lance avec `SALON_GARDE=660`. Conditions bloquantes d'activation : §10.

## 10. Salon (désactivé)

Le salon (spécification §39 et `docs/superpowers/specs/2026-11-11-salon-v3-design.md`) est livré **désactivé** : `compose.yaml` pose `SHH_SALONS: "0"`, sans variable dans `.env` pour l'ouvrir. Il reste fermé au public tant que le juriste n'a pas validé l'hébergement des conversations chiffrées (Q-SAL8, §39.7). Avec `SHH_SALONS=0`, aucune route `/api/salons/*` n'existe (même réponse 404 qu'une route inconnue).

Variables :

| Variable | Valeur | Rôle |
|---|---|---|
| `SHH_SALONS` | `0` (défaut) ou `1` | active les routes du salon et son WebSocket |
| `SHH_ORIGIN` | `https://${SHH_DOMAIN}` (posée par `compose.yaml`) | origine publique du site, comparée **exactement** à l'en-tête `Origin` du WebSocket et copiée dans la CSP (`connect-src … wss://hôte`). Obligatoire avec `SHH_SALONS=1`. Forme exigée : `https://hôte[:port]` en minuscules, sans chemin ni barre finale, port par défaut omis ; `http://` seulement pour `localhost` ou `127.0.0.0/8` ; IPv6 refusé, `http://[::1]` compris (la CSP ne l'accepte pas) |
| `SHH_SALONS_MAX` | 1 à 10 000, défaut 200 | salons vivants au plus ; **50 proposé pour un usage personnel** (`deploy/.env`) |

À savoir avant d'activer :

- **Conditions bloquantes d'activation** (sans elles, `SHH_SALONS` reste à `0`) : (1) l'avis du juriste (Q-SAL8) ; (2) un **essai long** du WebSocket à travers Caddy, au-delà de la première coupure possible à 5 min (`read_body 5m`) : `SALON_GARDE=660 CADDY=… make test-proxy`, réussi avec le Caddy de l'image épinglée ; (3) un **essai dans WebKit et dans Chromium à travers Caddy en HTTP/2**, mise à niveau par la RFC 8441 comprise (parcours du salon de C-3). Spec v3 §3.6.1, exigence C-3 21.

- **`SHH_ORIGIN` est vérifiée même salon coupé** : une valeur refusée empêche le serveur de démarrer **et** fait échouer `shhdrop admin` (`deploy.sh admin …`), qui lit la même configuration. Corriger `SHH_DOMAIN` (minuscules) d'abord.
- **Schéma de base 2 sans retour arrière** : le premier démarrage d'une version qui contient le salon ajoute les tables `salons` et `salon_pieces` (schéma 2), **même avec `SHH_SALONS=0`**. Une image plus ancienne refuse ensuite cette base : `deploy.sh rollback` vers une version d'avant le salon ne marche plus sans effacer la base (`admin wipe --yes`, partages perdus). Le schéma 2 n'a jamais été publié avant sa forme finale (colonne `rotation_r` comprise) : une base de développement créée par une version intermédiaire est à effacer, pas à reprendre.
- **Disque** : une conversation est écrite chiffrée sur le disque (`data/salons/`, seconde couche AES-256-GCM dont la clé ne vit qu'en mémoire), les pièces dans `data/salon-pieces/`. Une création de salon exige 2 Gio libres sous `SHH_STORAGE_MAX` (sinon 503) ; au pire environ 1,2 Go de conversation et 3,5 Go de vocaux par salon (plan C-2, point 10) : `SHH_STORAGE_MAX` reste la vraie protection du disque.
- **À la fin d'un salon, la clé de la seconde couche est oubliée** (plus référencée par le serveur, tableau mis à zéro), **pas effacée de la mémoire** au sens strict : Go ne permet pas d'effacer la clé étendue gardée par AES ni d'éventuelles copies du ramasse-miettes. Elle n'est jamais écrite sur disque ; elle disparaît au plus tard à l'arrêt du processus.
- **Un redémarrage du serveur** rend toutes les conversations illisibles : au démarrage, les fichiers de conversation et toutes les pièces sont effacés ; les salons restent (lien et mot de passe valables), les membres reviennent par `rejoindre`.
- **Le redémarrage ou la recréation du conteneur Caddy (après un changement du `Caddyfile` ; `caddy reload` n'est pas possible, l'API d'administration étant coupée, `admin off`) et toute mise à jour du serveur coupent les WebSocket ouverts.** Les pages du salon se reconnectent d'elles-mêmes (reconnexion automatique, avec rattrapage des messages manqués ; exigence du client C-3) ; rien n'est perdu côté serveur tant que le serveur Go ne redémarre pas.
- **Caddy garde l'en-tête `Origin`** et laisse passer la mise à niveau WebSocket (§36 S2) : `test-proxy.sh` (section 7) le prouve, et une ligne `header_up -Origin` ferait échouer le test.
- **Signalements** : « Quitter et signaler » (`POST /api/salons/signaler`) et « Détruire et signaler » comptent dans le même entier horaire que les partages (`reports_alert` de `shhcheck health`). `admin destroy -` accepte aussi un lien de salon `#c…`.
- **Paniques de l'entretien** : une panique dans la passe d'entretien du salon (chaque seconde) est récupérée sans aucune sortie (ni journal ni stderr : un message pourrait citer un identifiant), et l'entretien repart à la seconde suivante. Elles ne sont comptées que dans un entier en mémoire (`Manager.PaniquesTick`, sans identifiant), lu par les tests ; `shhdrop admin`, qui tourne hors du serveur, ne le voit pas, et `/api/health` ne l'expose pas (relecture C-2, N7). Symptôme à surveiller à la place : des salons échus qui ne disparaissent pas.
- **Adresses IP** : le serveur n'en garde aucune pour le salon ; seules les limites en mémoire en tiennent compte (empreintes HMAC à clé du jour ou du processus, jamais l'adresse ; §9.5).

## 11. Capacité du serveur

Aucune limite de capacité n'est fixée en dur (décision du propriétaire du 13 novembre) : chaque valeur se règle dans `deploy/.env` ; laissée vide, elle est **calculée au démarrage** d'après `GOMEMLIMIT` (`compose.yaml`) et la limite de descripteurs (`ulimits.nofile`, 65 536 dans `compose.yaml`). Les limites anti-abus **par personne** (créations, octets par jour, places par connexion et par /48, requêtes par minute) ne changent pas et ne se règlent pas ici.

| Variable | Rôle | Valeur calculée | Avec `compose.yaml` (900 Mio, 65 536) |
|---|---|---|---|
| `SHH_UPLOADS_MAX` | envois de segments simultanés (partages et pièces) | 30 % de `GOMEMLIMIT` ÷ 4 Mio (corps gardé en mémoire), au moins 8 ; 64 sans `GOMEMLIMIT` | 67 |
| `SHH_DOWNLOADS_MAX` | lectures de segments simultanées | 10 % de `GOMEMLIMIT` ÷ 256 Kio (tampon), au moins 16 ; 256 sans `GOMEMLIMIT` | 360 |
| `SHH_WATCH_MAX` | surveillances tenues (`/api/shares/watch`) | autant que de lectures | 360 |
| `SHH_WS_MAX` | WebSocket du salon ouverts | 2 000 | 2 000 |
| `SHH_DISK_OPS_MAX` | appels système de fichiers simultanés (partages et pièces) ; au-delà, ils attendent leur tour | 64 | 64 |

`SHH_DISK_OPS_MAX` borne les fils du système bloqués sur le disque (audit du 13 novembre, D4) : à garder bien sous `pids_limit` (1 024 dans `compose.yaml`). Chaque autre catégorie a au plus `nofile / 8` places (une lecture ou un envoi tient 2 descripteurs) ; une valeur réglée au-delà empêche le serveur de démarrer (message `… dépasse la limite de descripteurs`), au lieu de le faire tomber sous la charge.

**Règle de sûreté** : ne monter `SHH_UPLOADS_MAX` qu'avec la mémoire. Chaque envoi garde 4 Mio, que le ramasse-miettes peut doubler : au-delà de `mem_limit`, le noyau tue le serveur (envois en cours perdus). Pour une machine plus grosse, monter `mem_limit` et `GOMEMLIMIT` ensemble (`GOMEMLIMIT` ≈ 90 % de `mem_limit`) et laisser les places se recalculer.

**Part équitable** (audit du 13 novembre, D2) : en plus de ses propres limites, une connexion ou un bloc /48 (une adresse en IPv4) prend au plus **1/8** de chaque plafond global, et le **dernier quart** des places (envois, lectures, surveillances, WebSocket, salons) ne va qu'à un bloc qui n'en tient aucune. Le **dernier huitième du stockage** ne va qu'à une adresse qui n'a rien créé ni envoyé aujourd'hui (UTC) ; un agrandissement et une pièce du salon n'y entrent jamais ; une adresse ne réserve pas plus de `SHH_STORAGE_MAX / 8` octets par jour. Un salon où personne n'est entré est effacé 15 min après sa création. Adresses IPv4 nécessaires pour tout prendre, avec `compose.yaml` : envois 23 (8 avant), lectures 107 (16 avant), salons (200) 80 qui y entrent (40 avant, sans y entrer), stockage environ 43 (34 avant). Ces seuils restent atteignables par un attaquant qui dispose de beaucoup d'adresses : ce sont des limites assumées, à reporter dans la spécification (§18).
