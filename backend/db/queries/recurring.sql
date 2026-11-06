-- Subscriptions = recurring_transactions (migration 00007).
-- home_rate is fx_rate_on(currency → home currency, today), NULL when missing; the API
-- turns it into amountHomeMinor and monthlyHomeMinor with exact rational math.

-- name: LedgerListSubscriptions :many
SELECT sqlc.embed(r), sqlc.embed(a), sqlc.embed(c),
       fx_rate_on(r.currency, h.home_currency, sqlc.arg('today')::date)::numeric AS home_rate,
       cf.minor_units AS currency_minor_units,
       ch.minor_units AS home_minor_units
  FROM recurring_transactions r
  JOIN households h  ON h.id = r.household_id
  JOIN accounts a    ON a.id = r.account_id
  JOIN categories c  ON c.id = r.category_id
  JOIN currencies cf ON cf.code = r.currency
  JOIN currencies ch ON ch.code = h.home_currency
 WHERE r.household_id = sqlc.arg('household_id')
   AND r.deleted_at IS NULL
   AND (NOT sqlc.arg('active_only')::bool
        OR (r.is_active AND (r.ends_on IS NULL OR r.next_due_on <= r.ends_on)))
 ORDER BY r.next_due_on, r.title, r.id;

-- name: LedgerGetSubscription :one
SELECT sqlc.embed(r), sqlc.embed(a), sqlc.embed(c),
       fx_rate_on(r.currency, h.home_currency, sqlc.arg('today')::date)::numeric AS home_rate,
       cf.minor_units AS currency_minor_units,
       ch.minor_units AS home_minor_units
  FROM recurring_transactions r
  JOIN households h  ON h.id = r.household_id
  JOIN accounts a    ON a.id = r.account_id
  JOIN categories c  ON c.id = r.category_id
  JOIN currencies cf ON cf.code = r.currency
  JOIN currencies ch ON ch.code = h.home_currency
 WHERE r.id = sqlc.arg('id')
   AND r.household_id = sqlc.arg('household_id')
   AND r.deleted_at IS NULL;

-- name: LedgerGetSubscriptionRow :one
SELECT * FROM recurring_transactions
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: LedgerFindSubscriptionHousehold :one
SELECT household_id, deleted_at FROM recurring_transactions WHERE id = $1;

-- name: LedgerInsertSubscription :one
INSERT INTO recurring_transactions (id, household_id, kind, title, note, amount_minor, currency,
                                    account_id, account_currency, category_id, frequency, interval_count,
                                    starts_on, next_due_on, ends_on, is_active, created_by)
VALUES (sqlc.arg('id'), sqlc.arg('household_id'), sqlc.arg('kind'), sqlc.arg('title'), sqlc.narg('note'),
        sqlc.arg('amount_minor'), sqlc.arg('currency'), sqlc.arg('account_id'), sqlc.arg('account_currency'),
        sqlc.arg('category_id'), sqlc.arg('frequency'), sqlc.arg('interval_count'), sqlc.arg('starts_on'),
        sqlc.arg('next_due_on'), sqlc.narg('ends_on'), true, sqlc.narg('created_by'))
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: LedgerUpdateSubscription :one
UPDATE recurring_transactions
   SET title            = sqlc.arg('title'),
       note             = sqlc.narg('note'),
       amount_minor     = sqlc.arg('amount_minor'),
       currency         = sqlc.arg('currency'),
       account_id       = sqlc.arg('account_id'),
       account_currency = sqlc.arg('account_currency'),
       category_id      = sqlc.arg('category_id'),
       frequency        = sqlc.arg('frequency'),
       interval_count   = sqlc.arg('interval_count'),
       starts_on        = sqlc.arg('starts_on'),
       next_due_on      = sqlc.arg('next_due_on'),
       ends_on          = sqlc.narg('ends_on'),
       is_active        = sqlc.arg('is_active')
 WHERE id = sqlc.arg('id')
   AND household_id = sqlc.arg('household_id')
   AND row_version = sqlc.arg('row_version')
   AND deleted_at IS NULL
RETURNING id;

-- name: LedgerSoftDeleteSubscription :one
UPDATE recurring_transactions SET deleted_at = now()
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING id;

-- name: LedgerMonthBudgetTotal :one
-- Sum of this budget month's limits: the single_month row for the month, else the latest
-- ongoing row on or before it (NULL amount = no limit), over live expense categories.
SELECT coalesce(sum(coalesce(single.amount_minor, ongoing.amount_minor)), 0)::bigint AS total_minor
  FROM categories c
  LEFT JOIN LATERAL (
        SELECT b.amount_minor FROM budgets b
         WHERE b.category_id = c.id AND b.scope = 'single_month'
           AND b.month = sqlc.arg('month')::date AND b.deleted_at IS NULL
       ) single ON true
  LEFT JOIN LATERAL (
        SELECT b.amount_minor FROM budgets b
         WHERE b.category_id = c.id AND b.scope = 'ongoing'
           AND b.month <= sqlc.arg('month')::date AND b.deleted_at IS NULL
         ORDER BY b.month DESC LIMIT 1
       ) ongoing ON true
 WHERE c.household_id = sqlc.arg('household_id')
   AND c.kind = 'expense'
   AND c.deleted_at IS NULL
   AND c.archived_at IS NULL;
