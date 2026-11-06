-- +goose Up
-- Exact currency conversion for the API. Everything stays numeric (never float) and
-- rounds half away from zero, as docs/database/postgres-schema-and-business-rules.md § 3 requires.

-- +goose StatementBegin
-- The rate fx_rate_on() uses for p_from → p_to on p_on, and the BNR day it comes from
-- (the latest banking day on or before p_on). Same currency: rate 1, no date.
-- Missing rate: both NULL, and the API must refuse rather than guess.
CREATE FUNCTION fx_quote(p_from text, p_to text, p_on date, OUT rate numeric, OUT rate_date date)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT q.rate,
           CASE WHEN p_from = p_to OR q.rate IS NULL THEN NULL
                ELSE (SELECT max(r.rate_date)
                        FROM fx_rates r
                       WHERE r.source = 'BNR'
                         AND r.base_currency = 'RON'
                         AND r.quote_currency IN (p_from, p_to)
                         AND r.rate_date <= p_on)
           END
      FROM (SELECT fx_rate_on(p_from, p_to, p_on) AS rate) q
$$;
-- +goose StatementEnd

-- +goose StatementBegin
-- p_amount minor units of p_from, in minor units of p_to on p_on:
-- round(amount × rate × 10^(minor_units(to) − minor_units(from))). 9,99 € → 4975 bani at 4.98.
-- NULL when the rate is missing.
CREATE FUNCTION fx_convert_minor(p_amount bigint, p_from text, p_to text, p_on date) RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN p_from = p_to THEN p_amount
                ELSE round(p_amount
                           * fx_rate_on(p_from, p_to, p_on)
                           * power(10::numeric, (SELECT minor_units FROM currencies WHERE code = p_to)
                                              - (SELECT minor_units FROM currencies WHERE code = p_from)))::bigint
           END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION fx_convert_minor(bigint, text, text, date);
DROP FUNCTION fx_quote(text, text, date);
