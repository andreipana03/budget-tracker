-- name: CountAppMetadata :one
-- Fails if the database is unreachable or the migrations have not been applied.
SELECT count(*) FROM app_metadata;
