-- +goose Up
-- Expenses and income (transactions), money moved between accounts (transfers),
-- and the balances that follow from them.

-- posted:  real money, counted in balances, budgets and insights.
-- pending: created by a subscription coming due; waits for the user to confirm.
-- skipped: the user said it didn't happen this time; kept so the job doesn't recreate it.
CREATE TYPE transaction_status AS ENUM ('posted', 'pending', 'skipped');

CREATE TABLE transactions (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    household_id            uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    kind                    entry_kind NOT NULL,
    status                  transaction_status NOT NULL DEFAULT 'posted',
    -- Merchant or short description, shown as the row title: "Lidl", "Scholarship".
    title                   text NOT NULL,
    note                    text,
    -- Calendar day in the household's time zone. Budgets, the pace bar and the
    -- day groups in Activity all use this, so no time-zone math is needed in queries.
    occurred_on             date NOT NULL,
    -- Exact moment when known (Activity shows 21:14).
    occurred_at             timestamptz,
    category_id             uuid NOT NULL,
    account_id              uuid NOT NULL,
    account_currency        text NOT NULL,

    -- What was paid, as entered: a value and its currency, always positive.
    -- Whether it's money out or in comes from `kind`.
    amount_minor            bigint NOT NULL,
    currency                text NOT NULL REFERENCES currencies (code),
    -- The same amount in the account's currency, frozen at entry. Equals amount_minor
    -- when the currencies match. Balances are summed from this.
    account_amount_minor    bigint NOT NULL,
    -- The same amount in the household's home currency, frozen at entry with the
    -- BNR rate of that day, so totals never move when rates change later.
    home_currency           text NOT NULL REFERENCES currencies (code),
    home_amount_minor       bigint NOT NULL,
    -- home_currency per ONE unit of currency (4.98 for EUR → RON). 1 when they match.
    fx_rate                 numeric(20, 10) NOT NULL DEFAULT 1,
    -- The BNR date the rate came from (the latest banking day on or before occurred_on).
    fx_rate_date            date,

    -- Set when a subscription created this transaction.
    recurring_id            uuid,
    recurring_occurrence_on date,
    created_by              uuid REFERENCES users (id) ON DELETE SET NULL,
    row_version             bigint NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deleted_at              timestamptz,

    CONSTRAINT transactions_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
    CONSTRAINT transactions_note_length CHECK (char_length(note) <= 500),
    CONSTRAINT transactions_amounts_positive CHECK (amount_minor > 0 AND account_amount_minor > 0 AND home_amount_minor > 0),
    CONSTRAINT transactions_fx_rate_positive CHECK (fx_rate > 0),
    CONSTRAINT transactions_home_amount_matches CHECK (
        currency <> home_currency OR (home_amount_minor = amount_minor AND fx_rate = 1 AND fx_rate_date IS NULL)),
    CONSTRAINT transactions_fx_rate_date_required CHECK (currency = home_currency OR fx_rate_date IS NOT NULL),
    CONSTRAINT transactions_account_amount_matches CHECK (currency <> account_currency OR account_amount_minor = amount_minor),
    CONSTRAINT transactions_recurring_occurrence_required CHECK (recurring_id IS NULL OR recurring_occurrence_on IS NOT NULL),
    -- Same household, and the account's currency as stored on the account.
    CONSTRAINT transactions_account_fk FOREIGN KEY (account_id, household_id, account_currency)
        REFERENCES accounts (id, household_id, currency),
    -- Same household, and an expense category for an expense (income for income).
    CONSTRAINT transactions_category_fk FOREIGN KEY (category_id, household_id, kind)
        REFERENCES categories (id, household_id, kind),
    CONSTRAINT transactions_recurring_fk FOREIGN KEY (recurring_id, household_id)
        REFERENCES recurring_transactions (id, household_id) ON DELETE SET NULL (recurring_id),
    -- One transaction per subscription occurrence, so the daily job can safely run twice.
    CONSTRAINT transactions_recurring_occurrence_key UNIQUE (recurring_id, recurring_occurrence_on)
);

-- Activity: newest first, grouped by day.
CREATE INDEX transactions_household_day_idx ON transactions (household_id, occurred_on DESC, occurred_at DESC)
    WHERE deleted_at IS NULL;
-- Budgets, the pace bar and Insights: posted spending per category per period.
CREATE INDEX transactions_household_category_day_idx ON transactions (household_id, category_id, occurred_on)
    INCLUDE (home_amount_minor)
    WHERE status = 'posted' AND deleted_at IS NULL;
-- Account balances.
CREATE INDEX transactions_account_idx ON transactions (account_id, occurred_on)
    INCLUDE (kind, account_amount_minor)
    WHERE status = 'posted' AND deleted_at IS NULL;
-- "Waiting for you" list of pending subscription charges.
CREATE INDEX transactions_household_pending_idx ON transactions (household_id, occurred_on)
    WHERE status = 'pending' AND deleted_at IS NULL;
-- Search in Activity. Query with exactly this expression:
--   (title || ' ' || coalesce(note, '')) ILIKE '%' || $1 || '%'
CREATE INDEX transactions_search_trgm_idx ON transactions
    USING gin ((title || ' ' || coalesce(note, '')) gin_trgm_ops)
    WHERE deleted_at IS NULL;
CREATE INDEX transactions_household_sync_idx ON transactions (household_id, row_version);

CREATE TRIGGER transactions_bump_row_version
    BEFORE INSERT OR UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- Money moved between two of the household's accounts: an ATM withdrawal (ING → Cash)
-- or a currency exchange (lei → €). Never counted as spending or income.
CREATE TABLE transfers (
    id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    household_id      uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    from_account_id   uuid NOT NULL,
    from_currency     text NOT NULL,
    -- Leaving the source account, in its currency.
    from_amount_minor bigint NOT NULL,
    to_account_id     uuid NOT NULL,
    to_currency       text NOT NULL,
    -- Arriving in the destination account, in its currency. For an exchange the two
    -- amounts differ by the rate actually used (fees included).
    to_amount_minor   bigint NOT NULL,
    occurred_on       date NOT NULL,
    occurred_at       timestamptz,
    note              text,
    created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
    row_version       bigint NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz,
    CONSTRAINT transfers_distinct_accounts CHECK (from_account_id <> to_account_id),
    CONSTRAINT transfers_amounts_positive CHECK (from_amount_minor > 0 AND to_amount_minor > 0),
    CONSTRAINT transfers_same_currency_same_amount CHECK (from_currency <> to_currency OR from_amount_minor = to_amount_minor),
    CONSTRAINT transfers_note_length CHECK (char_length(note) <= 500),
    CONSTRAINT transfers_from_account_fk FOREIGN KEY (from_account_id, household_id, from_currency)
        REFERENCES accounts (id, household_id, currency),
    CONSTRAINT transfers_to_account_fk FOREIGN KEY (to_account_id, household_id, to_currency)
        REFERENCES accounts (id, household_id, currency)
);

CREATE INDEX transfers_household_day_idx ON transfers (household_id, occurred_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX transfers_from_account_idx ON transfers (from_account_id, occurred_on) WHERE deleted_at IS NULL;
CREATE INDEX transfers_to_account_idx ON transfers (to_account_id, occurred_on) WHERE deleted_at IS NULL;
CREATE INDEX transfers_household_sync_idx ON transfers (household_id, row_version);

CREATE TRIGGER transfers_bump_row_version
    BEFORE INSERT OR UPDATE ON transfers
    FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- Current balance of every account, in its own currency (minor units):
-- opening balance + posted income − posted expenses + transfers in − transfers out,
-- counting only what happened on or after the opening balance date.
CREATE VIEW account_balances AS
SELECT a.id            AS account_id,
       a.household_id,
       a.currency,
       (a.opening_balance_minor
        + coalesce(tx.net_minor, 0)
        + coalesce(t_in.amount_minor, 0)
        - coalesce(t_out.amount_minor, 0))::bigint AS balance_minor
  FROM accounts a
  LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.kind = 'income' THEN t.account_amount_minor ELSE -t.account_amount_minor END) AS net_minor
          FROM transactions t
         WHERE t.account_id = a.id
           AND t.status = 'posted'
           AND t.deleted_at IS NULL
           AND t.occurred_on >= a.opening_balance_on
       ) tx ON true
  LEFT JOIN LATERAL (
        SELECT sum(tr.to_amount_minor) AS amount_minor
          FROM transfers tr
         WHERE tr.to_account_id = a.id
           AND tr.deleted_at IS NULL
           AND tr.occurred_on >= a.opening_balance_on
       ) t_in ON true
  LEFT JOIN LATERAL (
        SELECT sum(tr.from_amount_minor) AS amount_minor
          FROM transfers tr
         WHERE tr.from_account_id = a.id
           AND tr.deleted_at IS NULL
           AND tr.occurred_on >= a.opening_balance_on
       ) t_out ON true
 WHERE a.deleted_at IS NULL;

-- +goose Down
DROP VIEW account_balances;
DROP TABLE transfers;
DROP TABLE transactions;
DROP TYPE transaction_status;
