-- The admin-test demo account (cmd/seed). Development only.

-- name: SeedDeleteUser :execrows
-- Deleting the user deletes their household and all its data (DB doc § 4).
DELETE FROM users WHERE username = sqlc.arg(username) OR email = sqlc.arg(email);

-- name: SeedSetupAccount :exec
-- Reuses the account signup created.
UPDATE accounts
   SET name = sqlc.arg(name), type = sqlc.arg(type), currency = sqlc.arg(currency),
       opening_balance_on = sqlc.arg(opening_balance_on), sort_order = sqlc.arg(sort_order)
 WHERE id = sqlc.arg(id);

-- name: SeedInsertAccount :one
INSERT INTO accounts (household_id, name, type, currency, opening_balance_minor, opening_balance_on, sort_order, created_by)
VALUES (sqlc.arg(household_id), sqlc.arg(name), sqlc.arg(type), sqlc.arg(currency), 0,
        sqlc.arg(opening_balance_on), sqlc.arg(sort_order), sqlc.arg(created_by))
RETURNING id;

-- name: SeedSetOpeningBalance :exec
UPDATE accounts SET opening_balance_minor = sqlc.arg(opening_balance_minor) WHERE id = sqlc.arg(id);

-- name: SeedCategories :many
SELECT id, kind, system_key, is_fixed, sort_order
  FROM categories
 WHERE household_id = $1 AND deleted_at IS NULL AND system_key IS NOT NULL;

-- name: SeedInsertBudget :exec
INSERT INTO budgets (household_id, category_id, scope, month, amount_minor, created_by)
VALUES (sqlc.arg(household_id), sqlc.arg(category_id), sqlc.arg(scope), sqlc.arg(month),
        sqlc.arg(amount_minor), sqlc.arg(created_by));

-- name: SeedInsertSubscription :one
INSERT INTO recurring_transactions (household_id, kind, title, note, amount_minor, currency, account_id, account_currency,
                                    category_id, frequency, interval_count, starts_on, next_due_on, created_by)
SELECT sqlc.arg(household_id), sqlc.arg(kind), sqlc.arg(title), sqlc.narg(note), sqlc.arg(amount_minor),
       sqlc.arg(currency), a.id, a.currency, sqlc.arg(category_id), sqlc.arg(frequency), 1,
       sqlc.arg(starts_on), sqlc.arg(next_due_on), sqlc.arg(created_by)
  FROM accounts a
 WHERE a.id = sqlc.arg(account_id)
RETURNING id;

-- name: SeedInsertTransaction :one
-- Frozen amounts computed exactly as the API does (fx_quote / fx_convert_minor on the
-- day): same currency → rate 1, no rate date. A missing rate fails the NOT NULL columns.
INSERT INTO transactions (household_id, kind, status, title, note, occurred_on, occurred_at, category_id, account_id,
                          account_currency, amount_minor, currency, account_amount_minor, home_currency,
                          home_amount_minor, fx_rate, fx_rate_date, recurring_id, recurring_occurrence_on, created_by)
SELECT sqlc.arg(household_id), sqlc.arg(kind), sqlc.arg(status), sqlc.arg(title), sqlc.narg(note),
       sqlc.arg(occurred_on), sqlc.narg(occurred_at), sqlc.arg(category_id), a.id, a.currency,
       sqlc.arg(amount_minor), sqlc.arg(currency)::text,
       fx_convert_minor(sqlc.arg(amount_minor)::bigint, sqlc.arg(currency)::text, a.currency, sqlc.arg(occurred_on)::date),
       h.home_currency,
       fx_convert_minor(sqlc.arg(amount_minor)::bigint, sqlc.arg(currency)::text, h.home_currency, sqlc.arg(occurred_on)::date),
       q.rate, q.rate_date,
       sqlc.narg(recurring_id), sqlc.narg(recurring_occurrence_on), sqlc.arg(created_by)
  FROM accounts a
  JOIN households h ON h.id = a.household_id
  LEFT JOIN LATERAL fx_quote(sqlc.arg(currency)::text, h.home_currency, sqlc.arg(occurred_on)::date) q ON true
 WHERE a.id = sqlc.arg(account_id)
RETURNING id, home_amount_minor;

-- name: SeedInsertTransfer :exec
-- to_amount_minor NULL means "same value": the to-account's currency equals the from one.
-- For an exchange it's computed with the day's rate and a 0.5 % fee.
INSERT INTO transfers (household_id, from_account_id, from_currency, from_amount_minor, to_account_id, to_currency,
                       to_amount_minor, occurred_on, occurred_at, note, created_by)
SELECT sqlc.arg(household_id), f.id, f.currency, sqlc.arg(from_amount_minor), t.id, t.currency,
       CASE WHEN f.currency = t.currency THEN sqlc.arg(from_amount_minor)::bigint
            ELSE round(fx_convert_minor(sqlc.arg(from_amount_minor)::bigint, f.currency, t.currency,
                                        sqlc.arg(occurred_on)::date) * 0.995)::bigint END,
       sqlc.arg(occurred_on), sqlc.narg(occurred_at), sqlc.narg(note), sqlc.arg(created_by)
  FROM accounts f, accounts t
 WHERE f.id = sqlc.arg(from_account_id) AND t.id = sqlc.arg(to_account_id);

-- name: SeedInsertSampleRates :execrows
-- Sample rates for offline development. Never overwrites a real rate.
INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate)
SELECT 'BNR', 'RON', r.code, r.rate_date, r.rate::numeric
  FROM jsonb_to_recordset(sqlc.arg(rows)::jsonb) AS r (code text, rate_date date, rate text)
ON CONFLICT DO NOTHING;

-- name: SeedAccountBalances :many
SELECT a.id, a.name, a.currency, a.opening_balance_minor, b.balance_minor
  FROM accounts a
  JOIN account_balances b ON b.account_id = a.id
 WHERE a.household_id = $1 AND a.deleted_at IS NULL
 ORDER BY a.sort_order;

-- name: SeedBudgetLines :many
-- Limit and posted spending per expense category for one budget month
-- (db/examples/screens.sql #1).
SELECT c.id, c.system_key, c.is_fixed, c.sort_order,
       coalesce(single.amount_minor, ongoing.amount_minor) AS limit_minor,
       coalesce((SELECT sum(t.home_amount_minor)
                   FROM transactions t
                  WHERE t.category_id = c.id AND t.kind = 'expense' AND t.status = 'posted'
                    AND t.deleted_at IS NULL
                    AND t.occurred_on >= sqlc.arg(starts_on)::date
                    AND t.occurred_on < sqlc.arg(ends_before)::date), 0)::bigint AS spent_minor
  FROM categories c
  LEFT JOIN LATERAL (SELECT b.amount_minor FROM budgets b
                      WHERE b.category_id = c.id AND b.scope = 'single_month'
                        AND b.month = sqlc.arg(month)::date AND b.deleted_at IS NULL) single ON true
  LEFT JOIN LATERAL (SELECT b.amount_minor FROM budgets b
                      WHERE b.category_id = c.id AND b.scope = 'ongoing'
                        AND b.month <= sqlc.arg(month)::date AND b.deleted_at IS NULL
                      ORDER BY b.month DESC LIMIT 1) ongoing ON true
 WHERE c.household_id = sqlc.arg(household_id) AND c.kind = 'expense'
   AND c.deleted_at IS NULL AND c.archived_at IS NULL
 ORDER BY c.sort_order;

-- name: SeedCounts :one
SELECT (SELECT count(*) FROM transactions t WHERE t.household_id = $1 AND t.status = 'posted' AND t.deleted_at IS NULL) AS posted,
       (SELECT count(*) FROM transactions t WHERE t.household_id = $1 AND t.status = 'pending' AND t.deleted_at IS NULL) AS pending,
       (SELECT count(*) FROM transfers tr WHERE tr.household_id = $1 AND tr.deleted_at IS NULL)                         AS transfers,
       (SELECT count(*) FROM recurring_transactions r WHERE r.household_id = $1 AND r.deleted_at IS NULL)               AS subscriptions,
       (SELECT count(*) FROM budgets b WHERE b.household_id = $1 AND b.deleted_at IS NULL)                              AS budgets;
