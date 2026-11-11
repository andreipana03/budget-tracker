-- Insights.

-- name: ScreensDailySpending :many
-- Posted expenses per day and category in [starts_on, ends_before), home currency,
-- optionally for one category.
SELECT occurred_on, category_id, sum(home_amount_minor)::bigint AS spent_minor
  FROM transactions
 WHERE household_id = $1 AND kind = 'expense' AND status = 'posted' AND deleted_at IS NULL
   AND occurred_on >= sqlc.arg(starts_on)::date AND occurred_on < sqlc.arg(ends_before)::date
   AND (sqlc.narg(category_id)::uuid IS NULL OR category_id = sqlc.narg(category_id)::uuid)
 GROUP BY occurred_on, category_id;

-- name: ScreensCategoryRefs :many
-- Every expense category of the household, archived ones too, so past spending in an
-- archived category still has a name. Deleted ones are included only to label history.
SELECT id, name, color, icon, is_fixed, sort_order, archived_at, deleted_at
  FROM categories
 WHERE household_id = $1 AND kind = 'expense'
 ORDER BY sort_order, name, id;
