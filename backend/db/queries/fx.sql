-- Reference data and exchange-rate helpers (migrations 00004, 00011).
-- Converted amounts are returned as numeric so a missing rate (NULL) survives the scan;
-- they're always whole numbers.

-- name: LedgerListCurrencies :many
SELECT * FROM currencies ORDER BY code;

-- name: LedgerGetCurrency :one
SELECT * FROM currencies WHERE code = $1;

-- name: LedgerFxQuote :one
-- The rate from → to on a day and the BNR date it comes from (NULLs when missing),
-- plus the amount converted exactly (fx_convert_minor rounds half away from zero).
SELECT q.rate,
       q.rate_date,
       fx_convert_minor(sqlc.arg('amount_minor')::bigint, sqlc.arg('from_currency')::text,
                        sqlc.arg('to_currency')::text, sqlc.arg('on_date')::date)::numeric AS amount_minor
  FROM (SELECT 1) one
  LEFT JOIN LATERAL fx_quote(sqlc.arg('from_currency')::text, sqlc.arg('to_currency')::text,
                             sqlc.arg('on_date')::date) q ON true;

-- name: LedgerFreezeAmounts :one
-- The frozen values a transaction stores (DB doc § 6): the amount in the account's
-- currency and in the home currency, with the home rate and its BNR date.
-- A NULL amount or rate means a rate is missing and the API must refuse.
SELECT fx_convert_minor(sqlc.arg('amount_minor')::bigint, sqlc.arg('currency')::text,
                        sqlc.arg('account_currency')::text, sqlc.arg('on_date')::date)::numeric AS account_amount_minor,
       fx_convert_minor(sqlc.arg('amount_minor')::bigint, sqlc.arg('currency')::text,
                        sqlc.arg('home_currency')::text, sqlc.arg('on_date')::date)::numeric    AS home_amount_minor,
       q.rate      AS fx_rate,
       q.rate_date AS fx_rate_date
  FROM (SELECT 1) one
  LEFT JOIN LATERAL fx_quote(sqlc.arg('currency')::text, sqlc.arg('home_currency')::text,
                             sqlc.arg('on_date')::date) q ON true;
