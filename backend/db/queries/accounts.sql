-- Accounts (migration 00006) with balances from the account_balances view (00008).

-- name: LedgerListAccounts :many
-- balance_home_minor is ≈ the balance in the home currency at today's rate (NULL when no rate).
SELECT sqlc.embed(a),
       b.balance_minor::bigint AS balance_minor,
       fx_convert_minor(b.balance_minor, a.currency, h.home_currency, sqlc.arg('today')::date)::numeric AS balance_home_minor
  FROM accounts a
  JOIN account_balances b ON b.account_id = a.id
  JOIN households h       ON h.id = a.household_id
 WHERE a.household_id = sqlc.arg('household_id')
   AND a.deleted_at IS NULL
   AND (sqlc.arg('include_archived')::bool OR a.archived_at IS NULL)
 ORDER BY a.sort_order, a.created_at, a.id;

-- name: LedgerGetAccountWithBalance :one
SELECT sqlc.embed(a),
       b.balance_minor::bigint AS balance_minor,
       fx_convert_minor(b.balance_minor, a.currency, h.home_currency, sqlc.arg('today')::date)::numeric AS balance_home_minor
  FROM accounts a
  JOIN account_balances b ON b.account_id = a.id
  JOIN households h       ON h.id = a.household_id
 WHERE a.id = sqlc.arg('id')
   AND a.household_id = sqlc.arg('household_id')
   AND a.deleted_at IS NULL;

-- name: LedgerGetAccount :one
SELECT * FROM accounts
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: LedgerFindAccountHousehold :one
-- Who owns an id (deleted rows included), for idempotent creates.
SELECT household_id, deleted_at FROM accounts WHERE id = $1;

-- name: LedgerInsertAccount :one
INSERT INTO accounts (id, household_id, name, type, currency, opening_balance_minor, opening_balance_on,
                      include_in_total, sort_order, created_by)
VALUES (sqlc.arg('id'), sqlc.arg('household_id'), sqlc.arg('name'), sqlc.arg('type'), sqlc.arg('currency'),
        sqlc.arg('opening_balance_minor'), sqlc.arg('opening_balance_on'), sqlc.arg('include_in_total'),
        coalesce(sqlc.narg('sort_order')::int,
                 (SELECT coalesce(max(x.sort_order) + 1, 0) FROM accounts x
                   WHERE x.household_id = sqlc.arg('household_id') AND x.deleted_at IS NULL)),
        sqlc.narg('created_by'))
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: LedgerAccountHasHistory :one
-- Any row at all references the account (deleted ones too: Undo can bring them back).
-- Its currency is then fixed by the composite foreign keys, and deleting it archives it.
SELECT (EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = sqlc.arg('id'))
        OR EXISTS (SELECT 1 FROM recurring_transactions r WHERE r.account_id = sqlc.arg('id'))
        OR EXISTS (SELECT 1 FROM transfers tr
                    WHERE tr.from_account_id = sqlc.arg('id') OR tr.to_account_id = sqlc.arg('id')))::bool AS has_history;

-- name: LedgerUpdateAccount :one
UPDATE accounts
   SET name                  = sqlc.arg('name'),
       type                  = sqlc.arg('type'),
       currency              = sqlc.arg('currency'),
       opening_balance_minor = sqlc.arg('opening_balance_minor'),
       opening_balance_on    = sqlc.arg('opening_balance_on'),
       include_in_total      = sqlc.arg('include_in_total'),
       sort_order            = sqlc.arg('sort_order'),
       archived_at           = CASE WHEN sqlc.arg('archived')::bool THEN coalesce(archived_at, now()) END
 WHERE id = sqlc.arg('id')
   AND household_id = sqlc.arg('household_id')
   AND row_version = sqlc.arg('row_version')
   AND deleted_at IS NULL
RETURNING id;

-- name: LedgerArchiveAccount :exec
UPDATE accounts SET archived_at = coalesce(archived_at, now())
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: LedgerSoftDeleteAccount :exec
UPDATE accounts SET deleted_at = now()
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;
