-- Transfers between two of a household's accounts (migration 00008). Every read joins
-- both accounts so the API can return two AccountRefs in one round trip.

-- name: LedgerGetTransfer :one
SELECT sqlc.embed(tr),
       fa.name AS from_name, fa.type AS from_type,
       ta.name AS to_name,   ta.type AS to_type
  FROM transfers tr
  JOIN accounts fa ON fa.id = tr.from_account_id
  JOIN accounts ta ON ta.id = tr.to_account_id
 WHERE tr.id = sqlc.arg('id')
   AND tr.household_id = sqlc.arg('household_id')
   AND tr.deleted_at IS NULL;

-- name: LedgerGetTransferAny :one
-- Deleted rows included (idempotent create).
SELECT * FROM transfers WHERE id = $1;

-- name: LedgerListTransfers :many
-- Activity with includeTransfers: the same order and keyset cursor as LedgerListTransactions
-- (occurred_on desc, occurred_at desc nulls last, id desc), so the API can merge both lists.
-- account_id matches either side. q is already escaped for LIKE (\, %, _).
SELECT sqlc.embed(tr),
       fa.name AS from_name, fa.type AS from_type,
       ta.name AS to_name,   ta.type AS to_type
  FROM transfers tr
  JOIN accounts fa ON fa.id = tr.from_account_id
  JOIN accounts ta ON ta.id = tr.to_account_id
 WHERE tr.household_id = sqlc.arg('household_id')
   AND tr.deleted_at IS NULL
   AND (sqlc.narg('account_id')::uuid IS NULL
        OR tr.from_account_id = sqlc.narg('account_id') OR tr.to_account_id = sqlc.narg('account_id'))
   AND (sqlc.narg('from_on')::date IS NULL OR tr.occurred_on >= sqlc.narg('from_on'))
   AND (sqlc.narg('to_before')::date IS NULL OR tr.occurred_on < sqlc.narg('to_before'))
   AND (sqlc.narg('q')::text IS NULL
        OR (fa.name || ' ' || ta.name || ' ' || coalesce(tr.note, '')) ILIKE '%' || sqlc.narg('q')::text || '%')
   AND (sqlc.narg('cursor_on')::date IS NULL
        OR tr.occurred_on < sqlc.narg('cursor_on')
        OR (tr.occurred_on = sqlc.narg('cursor_on')
            AND CASE WHEN sqlc.narg('cursor_at')::timestamptz IS NULL
                     THEN tr.occurred_at IS NULL AND tr.id < sqlc.narg('cursor_id')::uuid
                     ELSE tr.occurred_at IS NULL
                          OR tr.occurred_at < sqlc.narg('cursor_at')
                          OR (tr.occurred_at = sqlc.narg('cursor_at') AND tr.id < sqlc.narg('cursor_id')::uuid)
                END))
 ORDER BY tr.occurred_on DESC, tr.occurred_at DESC NULLS LAST, tr.id DESC
 LIMIT sqlc.arg('row_limit');

-- name: LedgerConvertAmount :one
-- An amount converted between two currencies with the BNR rate of a day (NULL when a
-- rate is missing). Used for a transfer's arriving amount when the client leaves it out.
SELECT fx_convert_minor(sqlc.arg('amount_minor')::bigint, sqlc.arg('from_currency')::text,
                        sqlc.arg('to_currency')::text, sqlc.arg('on_date')::date)::numeric AS amount_minor;

-- name: LedgerInsertTransfer :one
INSERT INTO transfers (id, household_id, from_account_id, from_currency, from_amount_minor,
                       to_account_id, to_currency, to_amount_minor, occurred_on, occurred_at, note, created_by)
VALUES (sqlc.arg('id'), sqlc.arg('household_id'), sqlc.arg('from_account_id'), sqlc.arg('from_currency'),
        sqlc.arg('from_amount_minor'), sqlc.arg('to_account_id'), sqlc.arg('to_currency'), sqlc.arg('to_amount_minor'),
        sqlc.arg('occurred_on'), sqlc.narg('occurred_at'), sqlc.narg('note'), sqlc.narg('created_by'))
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: LedgerUpdateTransfer :one
UPDATE transfers
   SET from_account_id   = sqlc.arg('from_account_id'),
       from_currency     = sqlc.arg('from_currency'),
       from_amount_minor = sqlc.arg('from_amount_minor'),
       to_account_id     = sqlc.arg('to_account_id'),
       to_currency       = sqlc.arg('to_currency'),
       to_amount_minor   = sqlc.arg('to_amount_minor'),
       occurred_on       = sqlc.arg('occurred_on'),
       occurred_at       = sqlc.narg('occurred_at'),
       note              = sqlc.narg('note')
 WHERE id = sqlc.arg('id')
   AND household_id = sqlc.arg('household_id')
   AND row_version = sqlc.arg('row_version')
   AND deleted_at IS NULL
RETURNING id;

-- name: LedgerSoftDeleteTransfer :one
UPDATE transfers SET deleted_at = now()
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL
RETURNING id;

-- name: LedgerRestoreTransfer :one
UPDATE transfers SET deleted_at = NULL
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NOT NULL
RETURNING id;
