-- +goose Up
-- Currencies and the daily exchange rates published by the National Bank of Romania (BNR).

CREATE TABLE currencies (
    code        text PRIMARY KEY,
    name        text NOT NULL,
    -- Digits after the decimal point (ISO 4217): RON 2, JPY 0. Amounts are stored in these minor units.
    minor_units smallint NOT NULL,
    CONSTRAINT currencies_code_format CHECK (code ~ '^[A-Z]{3}$'),
    CONSTRAINT currencies_minor_units_range CHECK (minor_units BETWEEN 0 AND 4)
);

INSERT INTO currencies (code, name, minor_units) VALUES
    ('RON', 'Romanian Leu', 2),
    ('EUR', 'Euro', 2),
    ('USD', 'US Dollar', 2),
    ('GBP', 'Pound Sterling', 2),
    ('CHF', 'Swiss Franc', 2),
    ('HUF', 'Hungarian Forint', 2),
    ('PLN', 'Polish Złoty', 2),
    ('CZK', 'Czech Koruna', 2),
    ('MDL', 'Moldovan Leu', 2),
    ('RSD', 'Serbian Dinar', 2),
    ('UAH', 'Ukrainian Hryvnia', 2),
    ('TRY', 'Turkish Lira', 2),
    ('SEK', 'Swedish Krona', 2),
    ('NOK', 'Norwegian Krone', 2),
    ('DKK', 'Danish Krone', 2),
    ('CAD', 'Canadian Dollar', 2),
    ('AUD', 'Australian Dollar', 2),
    ('CNY', 'Chinese Yuan', 2),
    ('JPY', 'Japanese Yen', 0);

-- One row per currency per day. A backend job saves BNR's daily file (bnr.ro/nbrfxrates.xml),
-- published on banking days around 13:00 Bucharest time. Weekends and holidays have no row:
-- use the latest rate on or before the date you need.
CREATE TABLE fx_rates (
    source         text NOT NULL DEFAULT 'BNR',
    base_currency  text NOT NULL REFERENCES currencies (code),
    quote_currency text NOT NULL REFERENCES currencies (code),
    rate_date      date NOT NULL,
    -- Units of base for ONE unit of quote: 1 EUR = 4.9765 RON is (RON, EUR, 4.9765).
    -- BNR quotes some currencies per 100 units (HUF, JPY): store those divided by 100.
    rate           numeric(20, 10) NOT NULL,
    fetched_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, base_currency, quote_currency, rate_date),
    CONSTRAINT fx_rates_rate_positive CHECK (rate > 0),
    CONSTRAINT fx_rates_distinct_currencies CHECK (base_currency <> quote_currency)
);

-- +goose StatementBegin
-- How many p_to you get for one p_from on p_on, using the latest BNR rates on or before that day.
-- Crosses through RON, so it works for any pair BNR publishes (EUR → USD, USD → RON, …).
-- Returns NULL when a rate is missing; the API must then refuse to guess.
CREATE FUNCTION fx_rate_on(p_from text, p_to text, p_on date) RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    WITH ron_per_unit AS (
        SELECT c.code,
               CASE WHEN c.code = 'RON' THEN 1::numeric
                    ELSE (SELECT r.rate
                            FROM fx_rates r
                           WHERE r.source = 'BNR'
                             AND r.base_currency = 'RON'
                             AND r.quote_currency = c.code
                             AND r.rate_date <= p_on
                           ORDER BY r.rate_date DESC
                           LIMIT 1)
               END AS rate
          FROM (VALUES (p_from), (p_to)) AS c (code)
    )
    SELECT CASE WHEN p_from = p_to THEN 1::numeric
                ELSE round((SELECT rate FROM ron_per_unit WHERE code = p_from)
                         / (SELECT rate FROM ron_per_unit WHERE code = p_to), 10)
           END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION fx_rate_on(text, text, date);
DROP TABLE fx_rates;
DROP TABLE currencies;
