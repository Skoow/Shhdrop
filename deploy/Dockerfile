# Image du serveur Shhdrop : binaire Go statique + site construit (web/dist).
# Contexte : la racine du dépôt.
#
#   docker build -f deploy/Dockerfile --build-arg SHH_BUILD_ID=$(git rev-parse --short=7 HEAD) -t shhdrop:local .
#
# SHH_BUILD_ID est obligatoire : le contexte n'a pas de dossier .git (.dockerignore), et le
# numéro de version du site (pied de page) doit être celui du build public pour que les
# empreintes de dist/ soient les mêmes que celles de la CI (spec §28, audit du 11 novembre, I6).
#
# Images de base épinglées par empreinte (index multi-architecture), relevées le
# 10 novembre 2026 sur registry-1.docker.io et mirror.gcr.io. À chaque montée de version :
# changer l'étiquette ET l'empreinte, ensemble. La version de Go doit rester celle de
# « toolchain » dans server/go.mod (GOTOOLCHAIN=local : sinon le build échoue, il ne
# télécharge rien). Node : version exacte, ≥ 22.2.0 (web/package.json), majeure de la CI.
# Rust : la version de engine/rust-toolchain.toml (relevée le 11 novembre 2026).
#
# Reproductibilité (spec §28.1, §28.7) : -trimpath, -buildvcs=false, identifiant de build
# vide, CGO coupé (modernc.org/sqlite est en Go pur), npm ci sur le verrou. Pour une image
# identique au bit près, il faut encore fixer les dates des fichiers :
#   docker buildx build --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
#     --output type=image,rewrite-timestamp=true …
# Non vérifié : aucun test ne compare encore deux builds de l'image.

# --- Moteur WebAssembly -----------------------------------------------------------------
# Mêmes commandes et mêmes options que web/scripts/build-engine.mjs (qui ne tourne pas ici :
# pas de Node dans cette étape) : le .wasm obtenu est identique, octet pour octet, à celui de la
# CI et du poste de développement (chemins de CARGO_HOME réécrits en /cargo ; comparé à chaque
# push par le job repro-docker de la CI, étape engine-pkg ci-dessous). Image glibc
# (Debian), pas Alpine : cargo mêle le triplet de l'hôte (…-linux-gnu / …-linux-musl) aux noms
# internes des crates, et un hôte musl donnerait un autre .wasm que la CI (vérifié).
FROM rust:1.99.1-slim-bookworm@sha256:f2c004e3d2d8b547e8cf7ffbc29205385f4e71d23e53e4e383065db5e9f822cd AS engine
ENV TZ=UTC LANG=C.UTF-8
# wasm-bindgen-cli : version exacte de la crate wasm-bindgen (engine/Cargo.lock), verrou compris.
RUN rustup target add wasm32-unknown-unknown \
 && cargo install --locked wasm-bindgen-cli --version 0.2.130
WORKDIR /src/engine
COPY engine/ ./
RUN CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$CARGO_HOME=/cargo" \
    cargo build --release --target wasm32-unknown-unknown -p shhdrop-wasm --locked \
 && wasm-bindgen --target web --remove-name-section --remove-producers-section --experimental-reset-state-function \
    --out-dir /out/pkg --out-name shhdrop_wasm target/wasm32-unknown-unknown/release/shhdrop_wasm.wasm

# Le pkg seul, pour la CI (job repro-docker de .github/workflows/ci.yml), qui le compare à celui
# de ses propres builds ; n'entre pas dans l'image :
#   docker build -f deploy/Dockerfile --target engine-pkg --output type=local,dest=<dossier> .
FROM scratch AS engine-pkg
COPY --from=engine /out/pkg /pkg

# --- Site -------------------------------------------------------------------------------
FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS web
ENV TZ=UTC LANG=C.UTF-8 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# Hash court du commit construit, 7 à 40 chiffres hexadécimaux minuscules : sans lui, l'image
# s'arrête ici (vite.config.ts, buildId, refuse aussi un build sans identifiant).
ARG SHH_BUILD_ID
RUN test -n "$SHH_BUILD_ID" || { echo "SHH_BUILD_ID manquant : --build-arg SHH_BUILD_ID=\$(git rev-parse --short=7 HEAD)" >&2; exit 1; } \
 && printf '%s' "$SHH_BUILD_ID" | grep -Eqx '[0-9a-f]{7,40}' || { echo "SHH_BUILD_ID invalide : 7 à 40 chiffres hexadécimaux minuscules" >&2; exit 1; }
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
# --ignore-scripts : aucun script d'installation d'une dépendance n'est exécuté.
RUN npm ci --ignore-scripts
COPY web/ ./
# Moteur construit à l'étape précédente ; build:engine vérifie seulement sa présence.
COPY --from=engine /out/pkg ./src/engine/pkg
# check-dist.mjs : le build de production est conforme (variantes .br et .gz exactes,
# aucun code de démo, aucune adresse http(s):// externe dans index.html, le CSS et
# pdf-frame.html). Un écart arrête le build de l'image.
RUN SHH_ENGINE_PREBUILT=1 npm run build && node scripts/check-dist.mjs

# Le site seul, pour la CI (job repro-docker), qui compare chaque fichier aux empreintes de ses
# propres builds (même SHH_BUILD_ID) ; n'entre pas dans l'image :
#   docker build -f deploy/Dockerfile --build-arg SHH_BUILD_ID=… --target web-dist --output type=local,dest=<dossier> .
FROM scratch AS web-dist
COPY --from=web /src/web/dist /dist

# --- Serveur ----------------------------------------------------------------------------
FROM golang:1.27.4-alpine@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS server
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=readonly
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download && go mod verify
COPY server/ ./
# Empreinte du commit gravée dans le binaire (main.buildID), affichée par le tableau de bord
# d'administration : sans .git ni empreinte vcs (-buildvcs=false), la page ne pouvait pas dire
# quel code tourne (audit adverse du 13 novembre, 3e campagne, tableau de bord, F6). Même
# SHH_BUILD_ID, même binaire : la reproductibilité tient. Forme revérifiée ici (ARG propre à
# cette étape : la valeur ne peut rien injecter dans -ldflags).
ARG SHH_BUILD_ID
RUN printf '%s' "$SHH_BUILD_ID" | grep -Eqx '[0-9a-f]{7,40}' || { echo "SHH_BUILD_ID manquant ou invalide : 7 à 40 chiffres hexadécimaux minuscules" >&2; exit 1; } \
 && go build -trimpath -buildvcs=false -ldflags="-s -w -buildid= -X main.buildID=$SHH_BUILD_ID" -o /out/shhdrop ./cmd/shhdrop
# shhcheck : contrôle de santé du conteneur et test TLS hybride (deploy/shhcheck/main.go).
WORKDIR /src/shhcheck
COPY deploy/shhcheck/ ./
RUN go build -trimpath -buildvcs=false -ldflags="-s -w -buildid=" -o /out/shhcheck .
# Dossier de données vide (0700), pour un point de montage qui appartienne déjà au bon compte.
RUN mkdir -m 0700 /out/data

# --- Image finale : rien d'autre que deux binaires, le site et les certificats racine -----
# scratch : ni shell, ni bibliothèque, ni gestionnaire de paquets. Seule connexion sortante
# du serveur : SMTP en TLS vérifié vers SHH_SMTP_HOST, avec SHH_COMPTES=1 seulement
# (internal/courriel/smtp.go, conception du compte §3.2) ; elle exige les certificats racine,
# copiés de l'étape server (paquet ca-certificates de l'image golang épinglée ci-dessus), au
# chemin que lit crypto/x509 sous Linux. Avec SHH_COMPTES=0, ils ne servent à rien.
FROM scratch
COPY --from=server /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
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
