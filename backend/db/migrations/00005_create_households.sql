-- +goose Up
-- A household owns all money data. Today every user has exactly one, with themselves as owner.
-- Sharing a budget later means adding rows to household_members; no data has to move.

CREATE TYPE household_role AS ENUM ('owner', 'member');

CREATE TABLE households (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    name            text NOT NULL DEFAULT 'Personal',
    -- Currency for totals, budgets and the Home hero. Each transaction keeps its own copy.
    home_currency   text NOT NULL DEFAULT 'RON' REFERENCES currencies (code),
    -- IANA zone, e.g. 'Europe/Bucharest'. Decides what "today" and "this month" mean
    -- for the pace bar and when subscriptions come due. Validated by the API.
    timezone        text NOT NULL DEFAULT 'Europe/Bucharest',
    -- Budget months can start on payday: 10 → the "November" budget runs 10 Nov – 9 Dec.
    month_start_day smallint NOT NULL DEFAULT 1,
    -- Last sync version handed out to any row in this household. See bump_row_version().
    change_seq      bigint NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT households_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    CONSTRAINT households_month_start_day_range CHECK (month_start_day BETWEEN 1 AND 28),
    CONSTRAINT households_change_seq_non_negative CHECK (change_seq >= 0)
);

CREATE TRIGGER households_set_updated_at
    BEFORE UPDATE ON households
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE household_members (
    household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role         household_role NOT NULL DEFAULT 'owner',
    joined_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (household_id, user_id)
);

CREATE INDEX household_members_user_id_idx ON household_members (user_id);

-- +goose StatementBegin
-- A household with no members is deleted with all its data. This is what makes
-- "Delete my account" complete: users → household_members → households → everything.
CREATE FUNCTION delete_empty_household() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM households h
     WHERE h.id = OLD.household_id
       AND NOT EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = OLD.household_id);
    RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER household_members_delete_empty_household
    AFTER DELETE ON household_members
    FOR EACH ROW EXECUTE FUNCTION delete_empty_household();

-- +goose StatementBegin
-- Sync versions for every synced table (accounts, categories, transactions, transfers,
-- budgets, recurring_transactions). Each insert or update takes the household's next
-- change_seq. Updating the household row locks it until commit, so versions within a
-- household are handed out and committed strictly in order: a device that has seen
-- version N can ask for "everything with row_version > N" and never miss a change.
-- Deletes are soft (deleted_at), so they sync the same way.
CREATE FUNCTION bump_row_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE households
       SET change_seq = change_seq + 1
     WHERE id = NEW.household_id
    RETURNING change_seq INTO NEW.row_version;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'household % does not exist', NEW.household_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION bump_row_version();
DROP TABLE household_members;
DROP FUNCTION delete_empty_household();
DROP TABLE households;
DROP TYPE household_role;
