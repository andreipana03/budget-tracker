-- Home and the month picker.

-- name: ScreensCurrencyMinorUnits :one
SELECT minor_units FROM currencies WHERE code = $1;

-- name: ScreensSpentByMonth :many
-- Posted expenses per budget month from `from` on. The budget month of day d is the
-- calendar month of d − (month_start_day − 1) days.
SELECT date_trunc('month', (occurred_on - (sqlc.arg(start_day)::int - 1))::timestamp)::date AS month,
       sum(home_amount_minor)::bigint AS spent_minor
  FROM transactions
 WHERE household_id = $1 AND kind = 'expense' AND status = 'posted' AND deleted_at IS NULL
   AND occurred_on >= sqlc.arg(from_day)::date
 GROUP BY 1
 ORDER BY 1;

-- name: ScreensFirstTransactionDay :one
-- The household's earliest transaction day (any kind or status).
SELECT occurred_on
  FROM transactions
 WHERE household_id = $1 AND deleted_at IS NULL
 ORDER BY occurred_on
 LIMIT 1;
