.PHONY: test test-engine test-go test-web test-e2e test-ui test-repro

test: test-engine test-go test-web test-e2e

# Moteur Rust : format, clippy sans avertissement (hôte, puis la liaison WebAssembly en wasm32),
# tests. --locked : Cargo.lock fait foi. cargo audit (réseau) tourne dans la CI (job engine).
test-engine:
	cd engine && cargo fmt --all --check
	cd engine && cargo clippy --workspace --all-targets --locked -- -D warnings
	cd engine && cargo clippy -p shhdrop-wasm --target wasm32-unknown-unknown --all-targets --locked -- -D warnings
	cd engine && cargo test --workspace --locked

test-go:
	cd server && go vet ./... && go test ./... && GOARCH=386 go build ./...

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
