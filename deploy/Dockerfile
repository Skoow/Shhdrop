# Image du serveur Shhdrop : binaire Go statique + site construit (web/dist).
# Contexte : la racine du dépôt.
#
#   docker build -f deploy/Dockerfile -t shhdrop:local .
#
# Images de base épinglées par empreinte (index multi-architecture), relevées le
# 10 novembre 2026 sur registry-1.docker.io et mirror.gcr.io. À chaque montée de version :
# changer l'étiquette ET l'empreinte, ensemble. La version de Go doit rester celle de
# « toolchain » dans server/go.mod (GOTOOLCHAIN=local : sinon le build échoue, il ne
# télécharge rien). Node : version exacte, ≥ 22.2.0 (web/package.json), majeure de la CI.
#
# Reproductibilité (spec §28.1, §28.7) : -trimpath, -buildvcs=false, identifiant de build
# vide, CGO coupé (modernc.org/sqlite est en Go pur), npm ci sur le verrou. Pour une image
# identique au bit près, il faut encore fixer les dates des fichiers :
#   docker buildx build --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
#     --output type=image,rewrite-timestamp=true …
# Non vérifié : aucun test ne compare encore deux builds de l'image.

# --- Site -------------------------------------------------------------------------------
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS web
ENV TZ=UTC LANG=C.UTF-8 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
# --ignore-scripts : aucun script d'installation d'une dépendance n'est exécuté.
RUN npm ci --ignore-scripts
COPY web/ ./
# check-dist.mjs : le build de production est conforme (variantes .br et .gz exactes,
# aucun code de démo, aucune ressource tierce). Un écart arrête le build de l'image.
RUN npm run build && node scripts/check-dist.mjs

# --- Serveur ----------------------------------------------------------------------------
FROM golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS server
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=readonly
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download && go mod verify
COPY server/ ./
RUN go build -trimpath -buildvcs=false -ldflags="-s -w -buildid=" -o /out/shhdrop ./cmd/shhdrop
# shhcheck : contrôle de santé du conteneur et test TLS hybride (deploy/shhcheck/main.go).
WORKDIR /src/shhcheck
COPY deploy/shhcheck/ ./
RUN go build -trimpath -buildvcs=false -ldflags="-s -w -buildid=" -o /out/shhcheck .
# Dossier de données vide (0700), pour un point de montage qui appartienne déjà au bon compte.
RUN mkdir -m 0700 /out/data

# --- Image finale : rien d'autre que deux binaires et le site ---------------------------
# scratch : ni shell, ni bibliothèque, ni gestionnaire de paquets. Le serveur n'ouvre
# aucune connexion sortante : pas besoin de certificats racine.
FROM scratch
COPY --from=server /out/shhdrop /out/shhcheck /
COPY --from=web /src/web/dist /site
COPY --from=server --chown=65532:65532 /out/data /data
# Compte sans privilège, numérique (pas de /etc/passwd dans l'image).
USER 65532:65532
# Chemins propres à l'image. Tout le reste (SHH_LISTEN, SHH_BEHIND_PROXY,
# SHH_TRUSTED_PROXY, SHH_STORAGE_MAX) est donné par compose.yaml.
# Pas de « VOLUME /data » : sans montage explicite, Docker créerait un volume anonyme sur
# le disque système, hors du volume chiffré (spec §22).
ENV SHH_DATA_DIR=/data SHH_STATIC_DIR=/site
EXPOSE 8080
ENTRYPOINT ["/shhdrop"]
CMD ["serve"]
