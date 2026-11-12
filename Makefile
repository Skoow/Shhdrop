.PHONY: test test-engine test-go test-web test-e2e test-ui test-repro lint-deploy test-proxy

test: test-engine test-go test-web test-e2e

# Moteur Rust : format, clippy sans avertissement (hôte, puis la liaison WebAssembly, le salon et sa liaison en wasm32),
# tests. --locked : Cargo.lock fait foi. cargo audit (réseau) tourne dans la CI (job engine).
test-engine:
	cd engine && cargo fmt --all --check
	cd engine && cargo clippy --workspace --all-targets --locked -- -D warnings
	cd engine && cargo clippy -p shhdrop-wasm --target wasm32-unknown-unknown --all-targets --locked -- -D warnings
	cd engine && cargo clippy -p shhdrop-salon --target wasm32-unknown-unknown --all-targets --locked -- -D warnings
	cd engine && cargo clippy -p shhdrop-salon-wasm --target wasm32-unknown-unknown --all-targets --locked -- -D warnings
	cd engine && cargo test --workspace --locked

test-go:
	cd server && go vet ./... && go test -race ./... && GOARCH=386 go build ./...

test-web:
	cd web && npm test
	cd web && npm run build && node scripts/check-dist.mjs
	cd web && npm run build:demo && node scripts/check-dist.mjs --demo

test-e2e:
	cd server && go build -o shhdrop ./cmd/shhdrop
	cd web && npm run test:e2e

test-ui:
	cd web && npm run test:ui

# Build reproductible (spec §28.1) : deux builds dans deux dossiers, mêmes empreintes.
test-repro:
	web/scripts/repro.sh

# Scripts de déploiement et de build : syntaxe, ShellCheck (0.11.0 en CI, job deploy-lint),
# go vet de deploy/shhcheck (module à part, hors de test-go).
lint-deploy:
	bash -n deploy/deploy.sh && bash -n deploy/test-proxy.sh
	for f in web/scripts/*.sh; do bash -n "$$f" || exit 1; done
	shellcheck deploy/*.sh web/scripts/*.sh
	cd deploy/shhcheck && go vet ./...

# Test du proxy (deploy/test-proxy.sh) : Caddy 2.10 ou plus dans le PATH (ou CADDY=…), site
# construit. La CI le lance avec l'image complète et le Caddy de compose.yaml (job repro-docker).
test-proxy:
	cd web && npm run build
	deploy/test-proxy.sh
