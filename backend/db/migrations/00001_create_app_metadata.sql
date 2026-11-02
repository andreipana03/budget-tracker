-- +goose Up
-- Minimal table so the health check can prove migrations have been applied.
CREATE TABLE app_metadata (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE app_metadata;
