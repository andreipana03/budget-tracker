-- Budgets screen and PUT /budgets (owned by the screens handlers: budgets.go, home.go).

-- name: ScreensExpenseCategories :many
-- Active expense categories of a household, in budget order.
SELECT id, name, color, icon, is_fixed, sort_order
  FROM categories
 WHERE household_id = $1 AND kind = 'expense' AND deleted_at IS NULL AND archived_at IS NULL
 ORDER BY sort_order, name, id;

-- name: ScreensBudgetRows :many
-- Every live budgets row of a household; the limit for a month is resolved in Go
-- (budget.ResolveLimit) so one read serves any number of months.
SELECT category_id, scope, month, amount_minor
  FROM budgets
 WHERE household_id = $1 AND deleted_at IS NULL
 ORDER BY category_id, month;

-- name: ScreensSpentByCategory :many
-- Posted expenses per category with occurred_on in [starts_on, ends_before), home currency.
SELECT category_id, sum(home_amount_minor)::bigint AS spent_minor
  FROM transactions
 WHERE household_id = $1 AND kind = 'expense' AND status = 'posted' AND deleted_at IS NULL
   AND occurred_on >= sqlc.arg(starts_on)::date AND occurred_on < sqlc.arg(ends_before)::date
 GROUP BY category_id;

-- name: ScreensCategoriesByIDs :many
-- The household's live categories among ids (for validating PUT /budgets).
SELECT id, kind, archived_at
  FROM categories
 WHERE household_id = $1 AND id = ANY(sqlc.arg(ids)::uuid[]) AND deleted_at IS NULL;

-- name: ScreensUpsertBudget :exec
-- Sets the live row for (category, scope, month). A NULL amount is only valid for ongoing rows.
INSERT INTO budgets (household_id, category_id, scope, month, amount_minor, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (category_id, scope, month) WHERE deleted_at IS NULL
DO UPDATE SET amount_minor = EXCLUDED.amount_minor;

-- name: ScreensDeleteSingleMonthBudget :exec
-- Removes a single-month override (soft delete).
UPDATE budgets
   SET deleted_at = now()
 WHERE household_id = $1 AND category_id = $2 AND scope = 'single_month' AND month = $3 AND deleted_at IS NULL;
