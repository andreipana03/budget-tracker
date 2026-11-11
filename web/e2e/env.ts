/**
 * Settings shared by playwright.config.ts, the global setup and the specs.
 * The e2e stack is isolated from `make backend` / `make web`: its own database and ports.
 */

export const E2E_DB_NAME = 'budget_tracker_e2e'
/** Seen from the host and from inside the Postgres container (both reach it on localhost:5432). */
export const E2E_DATABASE_URL = `postgres://budget:budget@localhost:5432/${E2E_DB_NAME}?sslmode=disable`

export const API_PORT = 8081
export const WEB_PORT = 5174
export const API_URL = `http://localhost:${API_PORT}`
export const WEB_URL = `http://localhost:${WEB_PORT}`
export const MAILPIT_URL = 'http://localhost:8025'

/** The Makefile's local default (the API refuses it only in production). */
export const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0123456789'

/** Seeded by `go run ./cmd/seed`: six months of data ending today. */
export const ADMIN = {
  username: 'admin-test',
  email: 'admin-test@budget-tracker.test',
  password: 'AdminTest@123',
} as const

/** Seeded by dev_seed.sql; its username is taken. */
export const DEMO_USERNAME = 'demo'
