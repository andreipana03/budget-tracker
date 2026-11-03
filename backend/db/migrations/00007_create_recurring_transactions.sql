-- +goose Up
-- Repeating payments: the Subscriptions screen (Netflix, phone, transport pass) and
-- repeating income (monthly allowance). When one comes due, a daily job adds a
-- *pending* transaction that the user confirms with one tap (or skips).

CREATE TYPE recurrence_frequency AS ENUM ('weekly', 'monthly', 'yearly');

CREATE TABLE recurring_transactions (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    household_id     uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    kind             entry_kind NOT NULL DEFAULT 'expense',
    -- Shown as the subscription's name and copied to each transaction's title.
    title            text NOT NULL,
    note             text,
    amount_minor     bigint NOT NULL,
    currency         text NOT NULL REFERENCES currencies (code),
    account_id       uuid NOT NULL,
    account_currency text NOT NULL,
    category_id      uuid NOT NULL,
    frequency        recurrence_frequency NOT NULL,
    -- Every N weeks / months / years.
    interval_count   smallint NOT NULL DEFAULT 1,
    -- First occurrence. Its day of month is kept for monthly ones: a subscription that
    -- starts on the 31st falls on the last day of shorter months, then back on the 31st.
    starts_on        date NOT NULL,
    -- Next occurrence the job hasn't created yet. Advanced by the job.
    next_due_on      date NOT NULL,
    -- Optional last day; after it the subscription stops by itself.
    ends_on          date,
    -- false = paused or cancelled. Past transactions stay.
    is_active        boolean NOT NULL DEFAULT true,
    created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
    row_version      bigint NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    CONSTRAINT recurring_transactions_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
    CONSTRAINT recurring_transactions_note_length CHECK (char_length(note) <= 500),
    CONSTRAINT recurring_transactions_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT recurring_transactions_interval_range CHECK (interval_count BETWEEN 1 AND 52),
    CONSTRAINT recurring_transactions_next_due_after_start CHECK (next_due_on >= starts_on),
    CONSTRAINT recurring_transactions_ends_after_start CHECK (ends_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT recurring_transactions_account_fk FOREIGN KEY (account_id, household_id, account_currency)
        REFERENCES accounts (id, household_id, currency),
    CONSTRAINT recurring_transactions_category_fk FOREIGN KEY (category_id, household_id, kind)
        REFERENCES categories (id, household_id, kind),
    -- Target for transactions' composite foreign key.
    CONSTRAINT recurring_transactions_id_household_key UNIQUE (id, household_id)
);

-- The daily job: "what's due on or before today?"
CREATE INDEX recurring_transactions_due_idx ON recurring_transactions (next_due_on)
    WHERE is_active AND deleted_at IS NULL;
CREATE INDEX recurring_transactions_household_sync_idx ON recurring_transactions (household_id, row_version);

CREATE TRIGGER recurring_transactions_bump_row_version
    BEFORE INSERT OR UPDATE ON recurring_transactions
    FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- +goose Down
DROP TABLE recurring_transactions;
DROP TYPE recurrence_frequency;
