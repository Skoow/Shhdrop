.PHONY: test test-go test-web test-e2e test-ui test-repro

test: test-go test-web test-e2e

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
