.PHONY: test test-go test-web test-e2e

test: test-go test-web test-e2e

test-go:
	cd server && go vet ./... && go test ./...

test-web:
	cd web && npm test

test-e2e:
	cd web && npm run test:e2e --if-present
