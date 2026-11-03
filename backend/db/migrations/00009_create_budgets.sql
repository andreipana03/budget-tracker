-- +goose Up
-- Monthly spending limits per expense category.
-- An 'ongoing' limit applies from its month onwards until a later ongoing row replaces it
-- (Groceries = 600 lei from September). A 'single_month' limit overrides just that month
-- (Eating Out = 400 lei in December only). The limit for month M is:
--   the single_month row for M if there is one, else the latest ongoing row on or before M.

CREATE TYPE budget_scope AS ENUM ('ongoing', 'single_month');

CREATE TABLE budgets (
    id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    household_id  uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    category_id   uuid NOT NULL,
    -- Always 'expense'; part of the foreign key so income categories can't get a budget.
    category_kind entry_kind NOT NULL DEFAULT 'expense',
    scope         budget_scope NOT NULL,
    -- The budget month this row starts (ongoing) or covers (single_month), as its 1st day.
    -- With households.month_start_day = 10, '2026-11-01' means the period 10 Nov – 9 Dec.
    month         date NOT NULL,
    -- Limit in the household's home currency, minor units.
    -- NULL on an ongoing row means "no limit from this month on" (budget removed).
    amount_minor  bigint,
    created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    row_version   bigint NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    CONSTRAINT budgets_expense_only CHECK (category_kind = 'expense'),
    CONSTRAINT budgets_month_first_day CHECK (extract(day FROM month) = 1),
    CONSTRAINT budgets_amount_non_negative CHECK (amount_minor IS NULL OR amount_minor >= 0),
    CONSTRAINT budgets_single_month_has_amount CHECK (scope = 'ongoing' OR amount_minor IS NOT NULL),
    CONSTRAINT budgets_category_fk FOREIGN KEY (category_id, household_id, category_kind)
        REFERENCES categories (id, household_id, kind)
);

CREATE UNIQUE INDEX budgets_category_scope_month_key ON budgets (category_id, scope, month)
    WHERE deleted_at IS NULL;
CREATE INDEX budgets_household_month_idx ON budgets (household_id, month) WHERE deleted_at IS NULL;
CREATE INDEX budgets_household_sync_idx ON budgets (household_id, row_version);

CREATE TRIGGER budgets_bump_row_version
    BEFORE INSERT OR UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- +goose Down
DROP TABLE budgets;
DROP TYPE budget_scope;
