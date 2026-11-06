-- Transactions (migration 00008). Every read joins the category and account so the
-- API can return CategoryRef and AccountRef in one round trip.

-- name: LedgerGetTransaction :one
SELECT sqlc.embed(t), sqlc.embed(c), sqlc.embed(a)
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  JOIN accounts a   ON a.id = t.account_id
 WHERE t.id = sqlc.arg('id')
   AND t.household_id = sqlc.arg('household_id')
   AND t.deleted_at IS NULL;

-- name: LedgerGetTransactionAny :one
-- Deleted rows included (restore, idempotent create).
SELECT * FROM transactions WHERE id = $1;

-- name: LedgerListTransactions :many
-- Activity: newest first (occurred_on desc, occurred_at desc nulls last, id desc), keyset
-- paginated. The cursor is the last row of the previous page; cursor_on NULL = first page.
-- q is already escaped for LIKE (\, %, _). Search uses exactly the trigram index expression.
SELECT sqlc.embed(t), sqlc.embed(c), sqlc.embed(a)
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  JOIN accounts a   ON a.id = t.account_id
 WHERE t.household_id = sqlc.arg('household_id')
   AND t.deleted_at IS NULL
   AND (sqlc.narg('kind')::entry_kind IS NULL OR t.kind = sqlc.narg('kind'))
   AND (sqlc.narg('status')::transaction_status IS NULL OR t.status = sqlc.narg('status'))
   AND (sqlc.narg('category_id')::uuid IS NULL OR t.category_id = sqlc.narg('category_id'))
   AND (sqlc.narg('account_id')::uuid IS NULL OR t.account_id = sqlc.narg('account_id'))
   AND (sqlc.narg('from_on')::date IS NULL OR t.occurred_on >= sqlc.narg('from_on'))
   AND (sqlc.narg('to_before')::date IS NULL OR t.occurred_on < sqlc.narg('to_before'))
   AND (sqlc.narg('q')::text IS NULL OR (t.title || ' ' || coalesce(t.note, '')) ILIKE '%' || sqlc.narg('q')::text || '%')
   AND (sqlc.narg('cursor_on')::date IS NULL
        OR t.occurred_on < sqlc.narg('cursor_on')
        OR (t.occurred_on = sqlc.narg('cursor_on')
            AND CASE WHEN sqlc.narg('cursor_at')::timestamptz IS NULL
                     THEN t.occurred_at IS NULL AND t.id < sqlc.narg('cursor_id')::uuid
                     ELSE t.occurred_at IS NULL
                          OR t.occurred_at < sqlc.narg('cursor_at')
                          OR (t.occurred_at = sqlc.narg('cursor_at') AND t.id < sqlc.narg('cursor_id')::uuid)
                END))
 ORDER BY t.occurred_on DESC, t.occurred_at DESC NULLS LAST, t.id DESC
 LIMIT sqlc.arg('row_limit');

-- name: LedgerDayTotals :many
-- Posted expense and income per day, over every row matching the same filters (not only
-- the page), for the given days.
SELECT t.occurred_on,
       coalesce(sum(t.home_amount_minor) FILTER (WHERE t.kind = 'expense'), 0)::bigint AS expense_home_minor,
       coalesce(sum(t.home_amount_minor) FILTER (WHERE t.kind = 'income'), 0)::bigint  AS income_home_minor
  FROM transactions t
 WHERE t.household_id = sqlc.arg('household_id')
   AND t.deleted_at IS NULL
   AND t.status = 'posted'
   AND t.occurred_on = ANY (sqlc.arg('days')::date[])
   AND (sqlc.narg('kind')::entry_kind IS NULL OR t.kind = sqlc.narg('kind'))
   AND (sqlc.narg('status')::transaction_status IS NULL OR t.status = sqlc.narg('status'))
   AND (sqlc.narg('category_id')::uuid IS NULL OR t.category_id = sqlc.narg('category_id'))
   AND (sqlc.narg('account_id')::uuid IS NULL OR t.account_id = sqlc.narg('account_id'))
   AND (sqlc.narg('from_on')::date IS NULL OR t.occurred_on >= sqlc.narg('from_on'))
   AND (sqlc.narg('to_before')::date IS NULL OR t.occurred_on < sqlc.narg('to_before'))
   AND (sqlc.narg('q')::text IS NULL OR (t.title || ' ' || coalesce(t.note, '')) ILIKE '%' || sqlc.narg('q')::text || '%')
 GROUP BY t.occurred_on
 ORDER BY t.occurred_on DESC;

-- name: LedgerPendingTransactions :many
-- Subscription charges waiting for confirmation, oldest first.
SELECT sqlc.embed(t), sqlc.embed(c), sqlc.embed(a)
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  JOIN accounts a   ON a.id = t.account_id
 WHERE t.household_id = sqlc.arg('household_id')
   AND t.deleted_at IS NULL
   AND t.status = 'pending'
 ORDER BY t.occurred_on, t.occurred_at NULLS FIRST, t.id;

-- name: LedgerCountPending :one
SELECT count(*)::int AS pending
  FROM transactions
 WHERE household_id = $1 AND deleted_at IS NULL AND status = 'pending';

-- name: LedgerRecentTransactions :many
-- The latest posted transactions, newest first.
SELECT sqlc.embed(t), sqlc.embed(c), sqlc.embed(a)
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  JOIN accounts a   ON a.id = t.account_id
 WHERE t.household_id = sqlc.arg('household_id')
   AND t.deleted_at IS NULL
   AND t.status = 'posted'
 ORDER BY t.occurred_on DESC, t.occurred_at DESC NULLS LAST, t.id DESC
 LIMIT sqlc.arg('row_limit');

-- name: LedgerInsertTransaction :one
INSERT INTO transactions (id, household_id, kind, status, title, note, occurred_on, occurred_at,
                          category_id, account_id, account_currency, amount_minor, currency,
                          account_amount_minor, home_currency, home_amount_minor, fx_rate, fx_rate_date,
                          recurring_id, recurring_occurrence_on, created_by)
VALUES (sqlc.arg('id'), sqlc.arg('household_id'), sqlc.arg('kind'), sqlc.arg('status'), sqlc.arg('title'),
        sqlc.narg('note'), sqlc.arg('occurred_on'), sqlc.narg('occurred_at'),
        sqlc.arg('category_id'), sqlc.arg('account_id'), sqlc.arg('account_currency'),
        sqlc.arg('amount_minor'), sqlc.arg('currency'), sqlc.arg('account_amount_minor'),
        sqlc.arg('home_currency'), sqlc.arg('home_amount_minor'), sqlc.arg('fx_rate'), sqlc.narg('fx_rate_date'),
        sqlc.narg('recurring_id'), sqlc.narg('recurring_occurrence_on'), sqlc.narg('created_by'))
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: LedgerUpdateTransaction :one
UPDATE transactions
   SET kind                 = sqlc.arg('kind'),
       title                = sqlc.arg('title'),
       note                 = sqlc.narg('note'),
       occurred_on          = sqlc.arg('occurred_on'),
       occurred_at          = sqlc.narg('occurred_at'),
       category_id          = sqlc.arg('category_id'),
       account_id           = sqlc.arg('account_id'),
       account_currency     = sqlc.arg('account_currency'),
       amount_minor         = sqlc.arg('amount_minor'),
       currency             = sqlc.arg('currency'),
       account_amount_minor = sqlc.arg('account_amount_minor'),
       home_currency        = sqlc.arg('home_currency'),
       home_amount_minor    = sqlc.arg('home_amount_minor'),
       fx_rate              = sqlc.arg('fx_rate'),
       fx_rate_date         = sqlc.narg('fx_rate_date')
 WHERE id = sqlc.arg('id')
   AND household_id = sqlc.arg('household_id')
   AND row_version = sqlc.arg('row_version')
   AND deleted_at IS NULL
RETURNING id;

-- name: LedgerConfirmTransaction :one
-- Pending → posted, optionally with the real amount (same currency, amounts re-frozen).
UPDATE transactions
   SET status               = 'posted',
       amount_minor         = sqlc.arg('amount_minor'),
       account_amount_minor = sqlc.arg('account_amount_minor'),
       home_currency        = sqlc.arg('home_currency'),
       home_amount_minor    = sqlc.arg('home_amount_minor'),
       fx_rate              = sqlc.arg('fx_rate'),
       fx_rate_date         = sqlc.narg('fx_rate_date')
 WHERE id = sqlc.arg('id')
   AND household_id = sqlc.arg('household_id')
   AND status = 'pending'
   AND deleted_at IS NULL
RETURNING id;

-- name: LedgerSkipTransaction :one
UPDATE transactions SET status = 'skipped'
 WHERE id = $1 AND household_id = $2 AND status = 'pending' AND deleted_at IS NULL
RETURNING id;

-- name: LedgerSoftDeleteTransaction :one
UPDATE transactions SET deleted_at = now()
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING id;

-- name: LedgerRestoreTransaction :one
UPDATE transactions SET deleted_at = NULL
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NOT NULL
RETURNING id;
