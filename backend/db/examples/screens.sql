-- Reference queries for the main screens, written against the dev seed.
-- Not read by sqlc (only db/queries/ is). Copy them into db/queries/ with sqlc
-- annotations when you build the endpoints; replace the literals with $1, $2, …
--   household: '019a0000-0000-7000-8000-000000000002'   month: '2026-11-01'   today: '2026-11-18'

-- 1. Budgets for a month: limit, spent and status per category (Home › Budgets, Budgets screen)
WITH period AS (
    SELECT h.id AS household_id,
           ('2026-11-01'::date + (h.month_start_day - 1))                             AS starts_on,
           (('2026-11-01'::date + interval '1 month')::date + (h.month_start_day - 1)) AS ends_before
      FROM households h
     WHERE h.id = '019a0000-0000-7000-8000-000000000002'
), limits AS (
    SELECT c.id AS category_id, c.name, c.color, c.icon, c.is_fixed, c.sort_order,
           coalesce(single.amount_minor, ongoing.amount_minor) AS limit_minor
      FROM categories c
      JOIN period p ON p.household_id = c.household_id
      LEFT JOIN LATERAL (
            SELECT b.amount_minor FROM budgets b
             WHERE b.category_id = c.id AND b.scope = 'single_month'
               AND b.month = '2026-11-01' AND b.deleted_at IS NULL
           ) single ON true
      LEFT JOIN LATERAL (
            SELECT b.amount_minor FROM budgets b
             WHERE b.category_id = c.id AND b.scope = 'ongoing'
               AND b.month <= '2026-11-01' AND b.deleted_at IS NULL
             ORDER BY b.month DESC LIMIT 1
           ) ongoing ON true
     WHERE c.kind = 'expense' AND c.deleted_at IS NULL AND c.archived_at IS NULL
), spent AS (
    SELECT t.category_id, sum(t.home_amount_minor)::bigint AS spent_minor
      FROM transactions t
      JOIN period p ON p.household_id = t.household_id
     WHERE t.kind = 'expense' AND t.status = 'posted' AND t.deleted_at IS NULL
       AND t.occurred_on >= p.starts_on AND t.occurred_on < p.ends_before
     GROUP BY t.category_id
)
SELECT l.name, l.is_fixed, l.limit_minor, coalesce(s.spent_minor, 0) AS spent_minor,
       l.limit_minor - coalesce(s.spent_minor, 0) AS left_minor
  FROM limits l
  LEFT JOIN spent s USING (category_id)
 WHERE l.limit_minor IS NOT NULL
 ORDER BY l.sort_order;

-- 2. Home hero: left to spend, daily amount and pace (docs/design/ui-design-system-and-screen-specs.md § 3)
WITH period AS (
    SELECT h.id AS household_id,
           ('2026-11-01'::date + (h.month_start_day - 1))                             AS starts_on,
           (('2026-11-01'::date + interval '1 month')::date + (h.month_start_day - 1)) AS ends_before,
           '2026-11-18'::date                                                          AS today
      FROM households h
     WHERE h.id = '019a0000-0000-7000-8000-000000000002'
), lines AS (
    SELECT c.is_fixed,
           coalesce(single.amount_minor, ongoing.amount_minor) AS limit_minor,
           coalesce((SELECT sum(t.home_amount_minor)
                       FROM transactions t
                      WHERE t.category_id = c.id AND t.kind = 'expense' AND t.status = 'posted'
                        AND t.deleted_at IS NULL
                        AND t.occurred_on >= p.starts_on AND t.occurred_on < p.ends_before), 0) AS spent_minor
      FROM categories c
      JOIN period p ON p.household_id = c.household_id
      LEFT JOIN LATERAL (SELECT b.amount_minor FROM budgets b
                          WHERE b.category_id = c.id AND b.scope = 'single_month'
                            AND b.month = '2026-11-01' AND b.deleted_at IS NULL) single ON true
      LEFT JOIN LATERAL (SELECT b.amount_minor FROM budgets b
                          WHERE b.category_id = c.id AND b.scope = 'ongoing'
                            AND b.month <= '2026-11-01' AND b.deleted_at IS NULL
                          ORDER BY b.month DESC LIMIT 1) ongoing ON true
     WHERE c.kind = 'expense' AND c.deleted_at IS NULL AND c.archived_at IS NULL
), totals AS (
    SELECT sum(limit_minor)                                AS budget_minor,
           sum(spent_minor)                                AS spent_minor,
           sum(limit_minor) FILTER (WHERE is_fixed)        AS fixed_limit_minor,
           sum(limit_minor) FILTER (WHERE NOT is_fixed)    AS flex_limit_minor,
           sum(spent_minor) FILTER (WHERE NOT is_fixed)    AS flex_spent_minor
      FROM lines
     WHERE limit_minor IS NOT NULL
), clock AS (
    SELECT (today - starts_on + 1)::numeric / (ends_before - starts_on) AS elapsed,
           ends_before - today                                          AS days_left_including_today
      FROM period
)
SELECT t.budget_minor,
       t.spent_minor,
       t.budget_minor - t.spent_minor                                                AS left_minor,
       round((t.flex_limit_minor - t.flex_spent_minor) / c.days_left_including_today) AS per_day_minor,
       c.days_left_including_today,
       round(t.flex_limit_minor * c.elapsed - t.flex_spent_minor)                     AS under_pace_minor,
       round((t.fixed_limit_minor + t.flex_limit_minor * c.elapsed) / t.budget_minor, 4) AS pace_marker_x
  FROM totals t, clock c;

-- 3. Account balances for the sidebar, with the ≈ total in the home currency
SELECT a.name, b.currency, b.balance_minor,
       round(b.balance_minor * fx_rate_on(b.currency, h.home_currency, '2026-11-18'))::bigint AS balance_home_minor
  FROM account_balances b
  JOIN accounts a   ON a.id = b.account_id
  JOIN households h ON h.id = b.household_id
 WHERE b.household_id = '019a0000-0000-7000-8000-000000000002' AND a.archived_at IS NULL
 ORDER BY a.sort_order;

-- 4. Subscriptions: monthly cost in the home currency at today's rate
SELECT count(*) AS active,
       round(sum(r.amount_minor * fx_rate_on(r.currency, h.home_currency, '2026-11-18')
                 * CASE r.frequency WHEN 'weekly' THEN 52.0 / 12 WHEN 'monthly' THEN 1 WHEN 'yearly' THEN 1.0 / 12 END
                 / r.interval_count))::bigint AS per_month_minor
  FROM recurring_transactions r
  JOIN households h ON h.id = r.household_id
 WHERE r.household_id = '019a0000-0000-7000-8000-000000000002'
   AND r.kind = 'expense' AND r.is_active AND r.deleted_at IS NULL;

-- 5. Activity search (uses transactions_search_trgm_idx)
SELECT occurred_on, title, amount_minor, currency
  FROM transactions
 WHERE household_id = '019a0000-0000-7000-8000-000000000002'
   AND deleted_at IS NULL
   AND (title || ' ' || coalesce(note, '')) ILIKE '%' || 'glovo' || '%'
 ORDER BY occurred_on DESC, occurred_at DESC;

-- 6. Sync: everything that changed after the version a device last saw (here 40)
SELECT 'transaction' AS entity, id, row_version, deleted_at IS NOT NULL AS deleted
  FROM transactions WHERE household_id = '019a0000-0000-7000-8000-000000000002' AND row_version > 40
UNION ALL
SELECT 'transfer', id, row_version, deleted_at IS NOT NULL
  FROM transfers WHERE household_id = '019a0000-0000-7000-8000-000000000002' AND row_version > 40
ORDER BY row_version;
