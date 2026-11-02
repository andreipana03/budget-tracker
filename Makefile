# Run `make help` to list the available commands.

# Local defaults. Create backend/.env to override them.
DATABASE_URL ?= postgres://budget:budget@localhost:5432/budget_tracker?sslmode=disable
PORT ?= 8080
CORS_ALLOWED_ORIGINS ?= http://localhost:5173
-include backend/.env
export DATABASE_URL PORT CORS_ALLOWED_ORIGINS

GO_TOOL := go tool -modfile=tools.mod
MIGRATIONS := db/migrations

.DEFAULT_GOAL := help
.PHONY: help setup db-up db-down migrate backend web generate generate-backend generate-web generate-ios test

help: ## List the available commands
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

setup: ## Install the web dependencies
	cd web && npm install

db-up: ## Start PostgreSQL and wait until it is ready
	docker compose up -d --wait postgres

db-down: ## Stop PostgreSQL (keeps its data)
	docker compose down

migrate: ## Apply the database migrations
	cd backend && $(GO_TOOL) goose -dir $(MIGRATIONS) postgres "$(DATABASE_URL)" up

backend: ## Run the API on http://localhost:8080
	cd backend && go run ./cmd/api

web: ## Run the web app on http://localhost:5173
	cd web && npm run dev

generate: generate-backend generate-web generate-ios ## Regenerate all code from the API spec and SQL queries

generate-backend:
	cd backend && $(GO_TOOL) oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml
	cd backend && $(GO_TOOL) sqlc generate

generate-web:
	cd web && npm run generate:api

generate-ios:
	cd ios/Tools && swift run swift-openapi-generator generate ../../api/openapi.yaml \
		--config ../Packages/BudgetTrackerAPI/openapi-generator-config.yaml \
		--output-directory ../Packages/BudgetTrackerAPI/Sources/BudgetTrackerAPI/Generated

test: ## Run the backend tests and type-check and build the web app
	cd backend && go test ./...
	cd web && npm run build
