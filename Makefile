.PHONY: test test-go test-web test-e2e

test: test-go test-web test-e2e

test-go:
	cd server && go vet ./... && go test ./...

test-web:
	cd web && npm test

test-e2e:
	cd server && go build -o shhdrop ./cmd/shhdrop
	cd web && npm run test:e2e
