-- Background jobs (package jobs): BNR exchange rates, subscriptions coming due, cleanup.
-- docs/database/postgres-schema-and-business-rules.md § 6 (BNR job), § 8 (daily job), § 10.

-- name: JobsTryLock :one
-- Transaction-level lock, released at commit or rollback. Never a session lock: the
-- pool hands connections to other requests.
SELECT pg_try_advisory_xact_lock(sqlc.arg(lock_key)::bigint) AS locked;

-- name: JobsLock :exec
-- Waits for the lock (used by BackfillRates, which the seed calls directly).
SELECT pg_advisory_xact_lock(sqlc.arg(lock_key)::bigint);

-- name: JobsGetMetadata :one
SELECT value FROM app_metadata WHERE key = $1;

-- name: JobsSetMetadata :exec
INSERT INTO app_metadata (key, value) VALUES (sqlc.arg(key), sqlc.arg(value))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- name: JobsSetMetadataMax :exec
-- Keeps the larger value; for ISO dates (YYYY-MM-DD) text order is date order.
INSERT INTO app_metadata (key, value) VALUES (sqlc.arg(key), sqlc.arg(value))
ON CONFLICT (key) DO UPDATE SET value = GREATEST(app_metadata.value, EXCLUDED.value);

-- name: JobsUpsertRates :execrows
-- One row per (currency, day). BNR quotes some currencies per `multiplier` units (HUF,
-- JPY per 100): the stored rate is per ONE unit, divided exactly in numeric. Rates are
-- passed as decimal strings inside a JSON array ([{"code","rate_date","rate","multiplier"}]),
-- never floats. Currencies we don't know are ignored.
-- Always overwrites: real rates replace the dev seed's sample rows.
INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate, fetched_at)
SELECT 'BNR', 'RON', r.code, r.rate_date, r.rate::numeric / r.multiplier, now()
  FROM jsonb_to_recordset(sqlc.arg(rows)::jsonb) AS r (code text, rate_date date, rate text, multiplier int)
  JOIN currencies c ON c.code = r.code
 WHERE r.code <> 'RON'
ON CONFLICT (source, base_currency, quote_currency, rate_date)
DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at;

-- name: JobsDueSubscriptions :many
-- Active subscriptions whose next occurrence is on or before their household's today
-- (in its time zone) and not past ends_on. Locked so an API edit waits for the job.
SELECT sqlc.embed(r),
       h.home_currency,
       (sqlc.arg(now)::timestamptz AT TIME ZONE h.timezone)::date AS today
  FROM recurring_transactions r
  JOIN households h ON h.id = r.household_id
 WHERE r.is_active
   AND r.deleted_at IS NULL
   AND r.next_due_on <= (sqlc.arg(now)::timestamptz AT TIME ZONE h.timezone)::date
   AND (r.ends_on IS NULL OR r.next_due_on <= r.ends_on)
   AND (sqlc.narg(household_id)::uuid IS NULL OR r.household_id = sqlc.narg(household_id)::uuid)
 ORDER BY r.household_id, r.next_due_on, r.id
   FOR UPDATE OF r;

-- name: JobsFreezeAmounts :one
-- The values a transaction freezes (DB doc § 6), exactly as the API computes them:
-- the amount in the account's and in the home currency, the home rate and its BNR day.
-- 0 means a rate is missing (or the amount rounds to nothing): the job must not insert.
SELECT coalesce(fx_convert_minor(sqlc.arg(amount_minor)::bigint, sqlc.arg(currency)::text,
                                 sqlc.arg(account_currency)::text, sqlc.arg(on_date)::date), 0)::bigint AS account_amount_minor,
       coalesce(fx_convert_minor(sqlc.arg(amount_minor)::bigint, sqlc.arg(currency)::text,
                                 sqlc.arg(home_currency)::text, sqlc.arg(on_date)::date), 0)::bigint    AS home_amount_minor,
       q.rate      AS fx_rate,
       q.rate_date AS fx_rate_date
  FROM (SELECT 1) one
  LEFT JOIN LATERAL fx_quote(sqlc.arg(currency)::text, sqlc.arg(home_currency)::text,
                             sqlc.arg(on_date)::date) q ON true;

-- name: JobsInsertOccurrence :execrows
-- The pending transaction for one occurrence. A second run (or an occurrence the user
-- already confirmed, skipped or entered by hand) hits the unique key and does nothing.
INSERT INTO transactions (household_id, kind, status, title, note, occurred_on, category_id, account_id,
                          account_currency, amount_minor, currency, account_amount_minor, home_currency,
                          home_amount_minor, fx_rate, fx_rate_date, recurring_id, recurring_occurrence_on, created_by)
VALUES (sqlc.arg(household_id), sqlc.arg(kind), 'pending', sqlc.arg(title), sqlc.narg(note), sqlc.arg(occurred_on),
        sqlc.arg(category_id), sqlc.arg(account_id), sqlc.arg(account_currency), sqlc.arg(amount_minor),
        sqlc.arg(currency), sqlc.arg(account_amount_minor), sqlc.arg(home_currency), sqlc.arg(home_amount_minor),
        sqlc.arg(fx_rate), sqlc.narg(fx_rate_date), sqlc.arg(recurring_id), sqlc.arg(occurred_on),
        sqlc.narg(created_by))
ON CONFLICT (recurring_id, recurring_occurrence_on) DO NOTHING;

-- name: JobsAdvanceSubscription :exec
UPDATE recurring_transactions
   SET next_due_on = sqlc.arg(next_due_on)
 WHERE id = sqlc.arg(id);

-- name: JobsDeleteExpiredChallenges :execrows
DELETE FROM webauthn_challenges
 WHERE expires_at < sqlc.arg(now)::timestamptz
   AND (sqlc.narg(user_id)::uuid IS NULL OR user_id = sqlc.narg(user_id)::uuid);

-- name: JobsDeleteOldVerificationTokens :execrows
-- Consumed or expired more than a week ago.
DELETE FROM verification_tokens
 WHERE (consumed_at < sqlc.arg(cutoff)::timestamptz OR expires_at < sqlc.arg(cutoff)::timestamptz)
   AND (sqlc.narg(user_id)::uuid IS NULL OR user_id = sqlc.narg(user_id)::uuid);

-- name: JobsDeleteOldSessions :execrows
-- Expired or revoked more than 30 days ago.
DELETE FROM sessions
 WHERE (expires_at < sqlc.arg(cutoff)::timestamptz OR revoked_at < sqlc.arg(cutoff)::timestamptz)
   AND (sqlc.narg(user_id)::uuid IS NULL OR user_id = sqlc.narg(user_id)::uuid);
