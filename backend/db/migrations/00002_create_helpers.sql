-- +goose Up
-- Building blocks shared by every table: time-ordered UUIDs, updated_at stamping and
-- trigram search. See docs/database/postgres-schema-and-business-rules.md for the conventions they support.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- +goose StatementBegin
-- UUID version 7 (RFC 9562): a 48-bit Unix-millisecond timestamp followed by random bits.
-- Time-ordered, so B-tree inserts stay compact and ids sort by creation time.
-- PostgreSQL 18 has a built-in uuidv7(); this stands in for it on PostgreSQL 17.
-- Clients may also create v7 ids themselves (for example on the iPhone) and send them.
CREATE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
    SELECT encode(
        set_bit(
            set_bit(
                overlay(uuid_send(gen_random_uuid())
                        PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                        FROM 1 FOR 6),
                52, 1),
            53, 1),
        'hex')::uuid
$$;
-- +goose StatementEnd

-- +goose StatementBegin
-- Keeps updated_at current on tables that are not synced to devices.
-- Synced tables use bump_row_version(), which also sets updated_at.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION set_updated_at();
DROP FUNCTION uuid_generate_v7();
DROP EXTENSION IF EXISTS pg_trgm;
