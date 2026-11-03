-- +goose Up
-- Where money lives (accounts) and what it's for (categories).

CREATE TYPE account_type AS ENUM ('cash', 'bank', 'credit_card', 'savings', 'other');
-- Shared by categories and transactions, so a composite foreign key can make sure an
-- expense is never filed under an income category and vice versa.
CREATE TYPE entry_kind AS ENUM ('expense', 'income');

CREATE TABLE accounts (
    id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    household_id          uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    name                  text NOT NULL,
    -- Picks the icon: cash → Money, bank / credit_card → CreditCard, …
    type                  account_type NOT NULL DEFAULT 'bank',
    -- Fixed once the account has transactions (the composite foreign keys below enforce it).
    currency              text NOT NULL REFERENCES currencies (code),
    -- Balance on opening_balance_on, in the account's minor units. Transactions dated earlier
    -- are history only: they're already part of this number.
    opening_balance_minor bigint NOT NULL DEFAULT 0,
    opening_balance_on    date NOT NULL DEFAULT current_date,
    -- Counted in the sidebar's ≈ total.
    include_in_total      boolean NOT NULL DEFAULT true,
    sort_order            integer NOT NULL DEFAULT 0,
    -- Closed accounts are archived: hidden from pickers, history kept.
    archived_at           timestamptz,
    created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
    row_version           bigint NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    deleted_at            timestamptz,
    CONSTRAINT accounts_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    -- Target for composite foreign keys: same household, same currency.
    CONSTRAINT accounts_id_household_currency_key UNIQUE (id, household_id, currency)
);

CREATE UNIQUE INDEX accounts_household_name_key ON accounts (household_id, lower(name))
    WHERE deleted_at IS NULL;
CREATE INDEX accounts_household_sync_idx ON accounts (household_id, row_version);

CREATE TRIGGER accounts_bump_row_version
    BEFORE INSERT OR UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION bump_row_version();

CREATE TABLE categories (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    kind         entry_kind NOT NULL,
    name         text NOT NULL,
    -- A hue from docs/design/ui-design-system-and-screen-specs.md › Categories. The clients map it to their --cat-* color token.
    -- Blue and red are reserved by the design (interactive, over budget); green is for income.
    color        text NOT NULL,
    -- Phosphor icon name, e.g. 'shopping-cart' (docs/design/ui-design-system-and-screen-specs.md › Icons).
    icon         text NOT NULL,
    -- Fixed costs (rent, phone) count in full from day 1 and don't change the daily amount.
    is_fixed     boolean NOT NULL DEFAULT false,
    sort_order   integer NOT NULL DEFAULT 0,
    -- Set on the defaults ('groceries', …) so features and translations can find them
    -- even after the user renames them. NULL on categories the user creates.
    system_key   text,
    -- Archived categories keep their history but leave the pickers and budgets.
    archived_at  timestamptz,
    created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    row_version  bigint NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    CONSTRAINT categories_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
    CONSTRAINT categories_color_valid CHECK (color IN ('mint', 'orange', 'indigo', 'cyan', 'purple', 'pink', 'brown', 'gray', 'teal', 'yellow', 'green')),
    CONSTRAINT categories_icon_format CHECK (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT categories_fixed_only_for_expenses CHECK (kind = 'expense' OR NOT is_fixed),
    -- Target for composite foreign keys: same household, same kind.
    CONSTRAINT categories_id_household_kind_key UNIQUE (id, household_id, kind)
);

CREATE UNIQUE INDEX categories_household_name_key ON categories (household_id, kind, lower(name))
    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX categories_household_system_key ON categories (household_id, system_key)
    WHERE system_key IS NOT NULL;
CREATE INDEX categories_household_sync_idx ON categories (household_id, row_version);

CREATE TRIGGER categories_bump_row_version
    BEFORE INSERT OR UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- +goose StatementBegin
-- Every new household starts with the design's categories. People can rename, recolor,
-- reorder, archive or add to them afterwards.
CREATE FUNCTION seed_default_categories() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO categories (household_id, kind, name, color, icon, is_fixed, sort_order, system_key) VALUES
        (NEW.id, 'expense', 'Groceries',       'mint',   'shopping-cart',  false, 10, 'groceries'),
        (NEW.id, 'expense', 'Eating Out',      'orange', 'fork-knife',     false, 20, 'eating_out'),
        (NEW.id, 'expense', 'Housing & Bills', 'indigo', 'house-line',     true,  30, 'housing'),
        (NEW.id, 'expense', 'Transport',       'cyan',   'bus',            false, 40, 'transport'),
        (NEW.id, 'expense', 'Fun',             'purple', 'ticket',         false, 50, 'fun'),
        (NEW.id, 'expense', 'Shopping',        'pink',   'shopping-bag',   false, 60, 'shopping'),
        (NEW.id, 'expense', 'Education',       'brown',  'book-open',      false, 70, 'education'),
        (NEW.id, 'expense', 'Other',           'gray',   'dots-three',     false, 80, 'other'),
        (NEW.id, 'income',  'Scholarship',     'green',  'graduation-cap', false, 10, 'scholarship'),
        (NEW.id, 'income',  'Allowance',       'green',  'hand-coins',     false, 20, 'allowance'),
        (NEW.id, 'income',  'Salary',          'green',  'briefcase',      false, 30, 'salary'),
        (NEW.id, 'income',  'Gifts',           'green',  'gift',           false, 40, 'gifts'),
        (NEW.id, 'income',  'Other Income',    'green',  'dots-three',     false, 50, 'other_income');
    RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER households_seed_default_categories
    AFTER INSERT ON households
    FOR EACH ROW EXECUTE FUNCTION seed_default_categories();

-- +goose Down
DROP TRIGGER households_seed_default_categories ON households;
DROP FUNCTION seed_default_categories();
DROP TABLE categories;
DROP TABLE accounts;
DROP TYPE entry_kind;
DROP TYPE account_type;
