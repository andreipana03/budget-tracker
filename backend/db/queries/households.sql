-- name: GetHousehold :one
SELECT * FROM households WHERE id = $1;

-- name: LedgerHouseholdHasMoneyData :one
-- The home currency can change only while this is false. Deleted transactions and
-- subscriptions count too (Undo can bring them back with amounts frozen in the old home
-- currency), and so do budget limits (stored in home-currency minor units).
SELECT (EXISTS (SELECT 1 FROM transactions t WHERE t.household_id = $1)
        OR EXISTS (SELECT 1 FROM recurring_transactions r WHERE r.household_id = $1)
        OR EXISTS (SELECT 1 FROM budgets b WHERE b.household_id = $1 AND b.deleted_at IS NULL
                                           AND b.amount_minor IS NOT NULL))::bool AS has_data;

-- name: LedgerTimezoneExists :one
SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = $1)::bool AS ok;

-- name: LedgerUpdateHousehold :one
UPDATE households
   SET name            = coalesce(sqlc.narg('name')::text, name),
       home_currency   = coalesce(sqlc.narg('home_currency')::text, home_currency),
       timezone        = coalesce(sqlc.narg('timezone')::text, timezone),
       month_start_day = coalesce(sqlc.narg('month_start_day')::smallint, month_start_day)
 WHERE id = sqlc.arg('id')
RETURNING *;
