# Run `make help` to list the available commands.

# Local defaults. Create backend/.env to override them (template: backend/.env.example).
DATABASE_URL ?= postgres://budget:budget@localhost:5432/budget_tracker?sslmode=disable
TEST_DATABASE_URL ?= postgres://budget:budget@localhost:5432/budget_tracker_test?sslmode=disable
PORT ?= 8080
CORS_ALLOWED_ORIGINS ?= http://localhost:5173
APP_ENV ?= development
APP_BASE_URL ?= http://localhost:5173
JWT_SECRET ?= dev-only-insecure-jwt-secret-change-me-0123456789
COOKIE_SECURE ?= false
GOOGLE_CLIENT_IDS ?=
MAIL_DRIVER ?= smtp
SMTP_HOST ?= localhost
SMTP_PORT ?= 1025
MAIL_FROM ?= Budget Tracker <no-reply@budget-tracker.test>
JOBS_ENABLED ?= true
BNR_BASE_URL ?= https://curs.bnr.ro
TRUST_PROXY ?= false
RATE_LIMIT_ENABLED ?= true
-include backend/.env
export DATABASE_URL TEST_DATABASE_URL PORT CORS_ALLOWED_ORIGINS APP_ENV APP_BASE_URL JWT_SECRET COOKIE_SECURE \
	GOOGLE_CLIENT_IDS MAIL_DRIVER SMTP_HOST SMTP_PORT MAIL_FROM JOBS_ENABLED BNR_BASE_URL TRUST_PROXY RATE_LIMIT_ENABLED

GO_TOOL := go tool -modfile=tools.mod
MIGRATIONS := db/migrations

.DEFAULT_GOAL := help
.PHONY: help setup db-up db-down migrate db-seed db-test test-db backend web generate generate-backend generate-web generate-ios test web-test e2e ios-test ios-build

help: ## List the available commands
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

setup: ## Install the web dependencies and the Playwright browsers
	cd web && npm install && npx playwright install chromium webkit

db-up: ## Start PostgreSQL and Mailpit (inbox: http://localhost:8025) and wait until they are ready
	docker compose up -d --wait postgres mailpit

db-down: ## Stop PostgreSQL and Mailpit (keeps the data)
	docker compose down

migrate: ## Apply the database migrations
	cd backend && $(GO_TOOL) goose -dir $(MIGRATIONS) postgres "$(DATABASE_URL)" up

# psql runs inside the postgres container, so nothing extra needs to be installed.
PSQL := docker compose exec -T postgres psql "$(DATABASE_URL)" -X -v ON_ERROR_STOP=1

db-seed: ## Load the demo users: demo@budget-tracker.test and admin-test (run after migrate)
	$(PSQL) < backend/db/seed/dev_seed.sql
	cd backend && go run ./cmd/seed

db-test: ## Run the database integrity tests (rolled back, leaves no data)
	$(PSQL) < backend/db/tests/schema_test.sql

test-db: ## Create and migrate the database the Go integration tests use
	@docker compose exec -T postgres psql -U budget -d postgres -Atc \
		"SELECT 1 FROM pg_database WHERE datname = 'budget_tracker_test'" | grep -q 1 \
		|| docker compose exec -T postgres createdb -U budget budget_tracker_test
	cd backend && $(GO_TOOL) goose -dir $(MIGRATIONS) postgres "$(TEST_DATABASE_URL)" up

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

test: test-db ## Run the backend tests (unit + integration), the web unit tests, and build the web app
	cd backend && go test ./...
	cd web && npm test
	cd web && npm run build

web-test: ## Run the web unit tests (Vitest)
	cd web && npm test

ios-test: ## Run the iOS logic tests (formatting, parsing, copy) on the Mac with swift test
	cd ios/Packages/BudgetTrackerCore && swift test

ios-build: ## Build the iOS app for the simulator (needs Xcode)
	xcodebuild -project ios/BudgetTracker.xcodeproj -scheme BudgetTracker -destination 'generic/platform=iOS Simulator' build

# Needs `make db-up`. Recreates and seeds budget_tracker_e2e, starts the API on :8081 and Vite on :5174
# (see web/playwright.config.ts), and runs Desktop Chromium + iPhone WebKit.
e2e: ## Run the Playwright end-to-end tests (needs `make db-up`)
	cd web && npx playwright test
