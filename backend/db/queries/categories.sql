-- Categories (migration 00006).

-- name: LedgerListCategories :many
SELECT * FROM categories
 WHERE household_id = sqlc.arg('household_id')
   AND deleted_at IS NULL
   AND (sqlc.arg('include_archived')::bool OR archived_at IS NULL)
 ORDER BY kind, sort_order, created_at, id;

-- name: LedgerGetCategory :one
SELECT * FROM categories
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: LedgerFindCategoryHousehold :one
SELECT household_id, deleted_at FROM categories WHERE id = $1;

-- name: LedgerInsertCategory :one
INSERT INTO categories (id, household_id, kind, name, color, icon, is_fixed, sort_order, created_by)
VALUES (sqlc.arg('id'), sqlc.arg('household_id'), sqlc.arg('kind'), sqlc.arg('name'), sqlc.arg('color'),
        sqlc.arg('icon'), sqlc.arg('is_fixed'),
        coalesce(sqlc.narg('sort_order')::int,
                 (SELECT coalesce(max(x.sort_order) + 10, 10) FROM categories x
                   WHERE x.household_id = sqlc.arg('household_id') AND x.kind = sqlc.arg('kind')
                     AND x.deleted_at IS NULL)),
        sqlc.narg('created_by'))
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: LedgerCategoryInUse :one
-- Transactions, budgets or subscriptions point at the category (deleted transactions and
-- subscriptions too: Undo can bring them back). Deleting it then archives it.
SELECT (EXISTS (SELECT 1 FROM transactions t WHERE t.category_id = sqlc.arg('id'))
        OR EXISTS (SELECT 1 FROM budgets b WHERE b.category_id = sqlc.arg('id') AND b.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM recurring_transactions r WHERE r.category_id = sqlc.arg('id')))::bool AS in_use;

-- name: LedgerUpdateCategory :one
UPDATE categories
   SET name        = sqlc.arg('name'),
       color       = sqlc.arg('color'),
       icon        = sqlc.arg('icon'),
       is_fixed    = sqlc.arg('is_fixed'),
       sort_order  = sqlc.arg('sort_order'),
       archived_at = CASE WHEN sqlc.arg('archived')::bool THEN coalesce(archived_at, now()) END
 WHERE id = sqlc.arg('id')
   AND household_id = sqlc.arg('household_id')
   AND row_version = sqlc.arg('row_version')
   AND deleted_at IS NULL
RETURNING *;

-- name: LedgerArchiveCategory :exec
UPDATE categories SET archived_at = coalesce(archived_at, now())
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;

-- name: LedgerSoftDeleteCategory :exec
UPDATE categories SET deleted_at = now()
 WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL;
