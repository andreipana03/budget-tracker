-- Integrity tests for the schema. Each one tries something the database must refuse
-- (or checks something it must do) and prints PASS, or stops with an error at the first FAIL.
-- Runs inside a transaction that is rolled back, so it never leaves data behind.
-- Run with `make db-test` after `make migrate`.

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
BEGIN;

-- Helpers -------------------------------------------------------------------------
CREATE FUNCTION pg_temp.expect_error(p_name text, p_sql text, p_sqlstate text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_sqlstate THEN
            RETURN 'PASS  ' || p_name;
        END IF;
        RAISE EXCEPTION 'FAIL  % (expected SQLSTATE %, got %: %)', p_name, p_sqlstate, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'FAIL  % (expected SQLSTATE %, but the statement succeeded)', p_name, p_sqlstate;
END
$$;

CREATE FUNCTION pg_temp.expect(p_name text, p_ok boolean) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FAIL  %', p_name;
    END IF;
    RETURN 'PASS  ' || p_name;
END
$$;

-- Fixtures: two users, each with their own household -------------------------------
INSERT INTO users (id, email) VALUES
    ('00000000-0000-7000-8000-00000000a001', 'ana@example.test'),
    ('00000000-0000-7000-8000-00000000b001', 'bogdan@example.test');
INSERT INTO households (id) VALUES
    ('00000000-0000-7000-8000-00000000a002'),
    ('00000000-0000-7000-8000-00000000b002');
INSERT INTO household_members (household_id, user_id) VALUES
    ('00000000-0000-7000-8000-00000000a002', '00000000-0000-7000-8000-00000000a001'),
    ('00000000-0000-7000-8000-00000000b002', '00000000-0000-7000-8000-00000000b001');
-- Fixed opening date: the fixtures below are dated November 2026, and anything dated
-- before an account's opening balance doesn't count toward it.
INSERT INTO accounts (id, household_id, name, currency, opening_balance_on) VALUES
    ('00000000-0000-7000-8000-00000000a101', '00000000-0000-7000-8000-00000000a002', 'ING Card', 'RON', '2026-10-01'),
    ('00000000-0000-7000-8000-00000000a102', '00000000-0000-7000-8000-00000000a002', 'Revolut',  'EUR', '2026-10-01'),
    ('00000000-0000-7000-8000-00000000b101', '00000000-0000-7000-8000-00000000b002', 'BT Card',  'RON', '2026-10-01');
INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate) VALUES
    ('BNR', 'RON', 'EUR', '2020-01-06', 4.7800),
    ('BNR', 'RON', 'USD', '2020-01-06', 4.2700);

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM categories WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND system_key = 'groceries')   AS a_groceries,
       (SELECT id FROM categories WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND system_key = 'scholarship') AS a_scholarship,
       (SELECT id FROM categories WHERE household_id = '00000000-0000-7000-8000-00000000b002' AND system_key = 'groceries')   AS b_groceries;

-- A valid expense, used as the template for the failing variants below.
CREATE FUNCTION pg_temp.tx(p_overrides text DEFAULT '') RETURNS text
LANGUAGE sql AS $$
    SELECT format($f$
        INSERT INTO transactions (household_id, kind, title, occurred_on, category_id, account_id, account_currency,
                                  amount_minor, currency, account_amount_minor, home_currency, home_amount_minor, fx_rate, fx_rate_date)
        SELECT household_id, kind::entry_kind, title, occurred_on, category_id, account_id, account_currency,
               amount_minor, currency, account_amount_minor, home_currency, home_amount_minor, fx_rate, fx_rate_date
          FROM (SELECT '00000000-0000-7000-8000-00000000a002'::uuid AS household_id, 'expense' AS kind, 'Lidl' AS title,
                       '2026-11-18'::date AS occurred_on, (SELECT a_groceries FROM fx) AS category_id,
                       '00000000-0000-7000-8000-00000000a101'::uuid AS account_id, 'RON' AS account_currency,
                       6430::bigint AS amount_minor, 'RON' AS currency, 6430::bigint AS account_amount_minor,
                       'RON' AS home_currency, 6430::bigint AS home_amount_minor, 1::numeric AS fx_rate, NULL::date AS fx_rate_date) base
          %s $f$, p_overrides)
$$;

-- Ids and defaults -------------------------------------------------------------------
SELECT pg_temp.expect('uuid_generate_v7 produces version 7, RFC 9562 variant',
    (SELECT bool_and(substr(u::text, 15, 1) = '7' AND substr(u::text, 20, 1) IN ('8', '9', 'a', 'b'))
       FROM (SELECT uuid_generate_v7() AS u FROM generate_series(1, 200)) s));
SELECT pg_temp.expect('uuid_generate_v7 ids sort by creation time',
    (SELECT uuid_generate_v7()) < (SELECT uuid_generate_v7() FROM pg_sleep(0.002)));
SELECT pg_temp.expect('a new household gets 8 expense and 5 income categories',
    (SELECT count(*) FILTER (WHERE kind = 'expense') = 8 AND count(*) FILTER (WHERE kind = 'income') = 5
       FROM categories WHERE household_id = '00000000-0000-7000-8000-00000000a002'));
SELECT pg_temp.expect('only Housing & Bills is fixed by default',
    (SELECT array_agg(system_key) = ARRAY['housing'] FROM categories
      WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND is_fixed));

-- Users and sign-in ------------------------------------------------------------------
SELECT pg_temp.expect_error('email must be stored lowercased',
    $$INSERT INTO users (email) VALUES ('Ana.Pop@Example.test')$$, '23514');
SELECT pg_temp.expect_error('email is unique',
    $$INSERT INTO users (email) VALUES ('ana@example.test')$$, '23505');
SELECT pg_temp.expect_error('passwords must be argon2id hashes',
    $$UPDATE users SET password_hash = 'plain-text' WHERE email = 'ana@example.test'$$, '23514');
INSERT INTO user_identities (user_id, provider, provider_subject, email, email_verified)
VALUES ('00000000-0000-7000-8000-00000000a001', 'google', '1084', 'ana@example.test', true);
SELECT pg_temp.expect_error('a Google account links to one user only',
    $$INSERT INTO user_identities (user_id, provider, provider_subject) VALUES ('00000000-0000-7000-8000-00000000b001', 'google', '1084')$$, '23505');
SELECT pg_temp.expect_error('a user links at most one Google account',
    $$INSERT INTO user_identities (user_id, provider, provider_subject) VALUES ('00000000-0000-7000-8000-00000000a001', 'google', '9999')$$, '23505');
INSERT INTO sessions (user_id, refresh_token_hash, platform, auth_method, expires_at)
VALUES ('00000000-0000-7000-8000-00000000a001', sha256('web-token'), 'web', 'password', now() + interval '90 days'),
       ('00000000-0000-7000-8000-00000000a001', sha256('ios-token'), 'ios', 'google', now() + interval '90 days');
SELECT pg_temp.expect('one user can be signed in on web and iPhone at once',
    (SELECT count(*) = 2 FROM sessions WHERE user_id = '00000000-0000-7000-8000-00000000a001' AND revoked_at IS NULL));
SELECT pg_temp.expect_error('refresh tokens are stored as SHA-256 hashes, never raw',
    $$INSERT INTO sessions (user_id, refresh_token_hash, platform, auth_method, expires_at)
      VALUES ('00000000-0000-7000-8000-00000000a001', 'raw-token'::bytea, 'web', 'password', now() + interval '1 day')$$, '23514');

-- Transactions -----------------------------------------------------------------------
DO $$ BEGIN EXECUTE pg_temp.tx(); END $$;
SELECT pg_temp.expect('a valid expense is accepted', EXISTS (SELECT 1 FROM transactions WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND title = 'Lidl'));
SELECT pg_temp.expect_error('a category from another household is refused',
    replace(pg_temp.tx(), '(SELECT a_groceries FROM fx)', '(SELECT b_groceries FROM fx)'), '23503');
SELECT pg_temp.expect_error('an expense cannot use an income category',
    replace(pg_temp.tx(), '(SELECT a_groceries FROM fx)', '(SELECT a_scholarship FROM fx)'), '23503');
SELECT pg_temp.expect_error('an account from another household is refused',
    replace(pg_temp.tx(), '00000000-0000-7000-8000-00000000a101', '00000000-0000-7000-8000-00000000b101'), '23503');
SELECT pg_temp.expect_error('account_currency must be the account''s real currency',
    replace(pg_temp.tx(), '''RON'' AS account_currency', '''EUR'' AS account_currency'), '23503');
SELECT pg_temp.expect_error('amounts must be positive (direction comes from kind)',
    replace(pg_temp.tx(), '6430::bigint AS amount_minor', '0::bigint AS amount_minor'), '23514');
SELECT pg_temp.expect_error('a lei transaction must have home amount = amount and rate 1',
    replace(pg_temp.tx(), '6430::bigint AS home_amount_minor', '6431::bigint AS home_amount_minor'), '23514');
SELECT pg_temp.expect_error('a foreign-currency transaction must record which BNR date its rate is from',
    replace(replace(replace(pg_temp.tx(),
        '00000000-0000-7000-8000-00000000a101', '00000000-0000-7000-8000-00000000a102'),
        '''RON'' AS account_currency', '''EUR'' AS account_currency'),
        '''RON'' AS currency', '''EUR'' AS currency'), '23514');
SELECT pg_temp.expect_error('same currency as the account means the same amount',
    replace(pg_temp.tx(), '6430::bigint AS account_amount_minor', '6000::bigint AS account_amount_minor'), '23514');
SELECT pg_temp.expect_error('an account''s currency cannot change once it has transactions',
    $$UPDATE accounts SET currency = 'EUR' WHERE id = '00000000-0000-7000-8000-00000000a101'$$, '23503');

-- Subscriptions ------------------------------------------------------------------------
INSERT INTO recurring_transactions (id, household_id, title, amount_minor, currency, account_id, account_currency,
                                    category_id, frequency, starts_on, next_due_on)
SELECT '00000000-0000-7000-8000-00000000a201', '00000000-0000-7000-8000-00000000a002', 'Netflix', 3999, 'RON',
       '00000000-0000-7000-8000-00000000a101', 'RON', a_groceries, 'monthly', '2026-09-21', '2026-11-21' FROM fx;
DO $$ BEGIN EXECUTE replace(replace(pg_temp.tx(), 'Lidl', 'Netflix'), '6430', '3999'); END $$;
UPDATE transactions SET status = 'pending', recurring_id = '00000000-0000-7000-8000-00000000a201', recurring_occurrence_on = '2026-11-21'
 WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND title = 'Netflix';
SELECT pg_temp.expect_error('the due-date job can''t create the same occurrence twice',
    $$UPDATE transactions SET recurring_id = '00000000-0000-7000-8000-00000000a201', recurring_occurrence_on = '2026-11-21'
       WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND title = 'Lidl'$$, '23505');
SELECT pg_temp.expect('pending transactions don''t count in the balance',
    (SELECT balance_minor = -6430 FROM account_balances WHERE account_id = '00000000-0000-7000-8000-00000000a101'));
DELETE FROM recurring_transactions WHERE id = '00000000-0000-7000-8000-00000000a201';
SELECT pg_temp.expect('deleting a subscription keeps its transactions (and their household)',
    (SELECT recurring_id IS NULL AND household_id = '00000000-0000-7000-8000-00000000a002'
       FROM transactions WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND title = 'Netflix'));

-- Transfers ------------------------------------------------------------------------------
SELECT pg_temp.expect_error('a transfer needs two different accounts',
    $$INSERT INTO transfers (household_id, from_account_id, from_currency, from_amount_minor, to_account_id, to_currency, to_amount_minor, occurred_on)
      VALUES ('00000000-0000-7000-8000-00000000a002', '00000000-0000-7000-8000-00000000a101', 'RON', 100, '00000000-0000-7000-8000-00000000a101', 'RON', 100, '2026-11-04')$$, '23514');
SELECT pg_temp.expect_error('a transfer can''t reach another household''s account',
    $$INSERT INTO transfers (household_id, from_account_id, from_currency, from_amount_minor, to_account_id, to_currency, to_amount_minor, occurred_on)
      VALUES ('00000000-0000-7000-8000-00000000a002', '00000000-0000-7000-8000-00000000a101', 'RON', 100, '00000000-0000-7000-8000-00000000b101', 'RON', 100, '2026-11-04')$$, '23503');
INSERT INTO transfers (household_id, from_account_id, from_currency, from_amount_minor, to_account_id, to_currency, to_amount_minor, occurred_on)
VALUES ('00000000-0000-7000-8000-00000000a002', '00000000-0000-7000-8000-00000000a101', 'RON', 49800,
        '00000000-0000-7000-8000-00000000a102', 'EUR', 9950, '2026-11-04');
SELECT pg_temp.expect('a lei → € exchange moves both balances in their own currency',
    (SELECT array_agg(balance_minor ORDER BY currency) = ARRAY[9950::bigint, -56230::bigint]
       FROM account_balances WHERE household_id = '00000000-0000-7000-8000-00000000a002'));

-- Budgets --------------------------------------------------------------------------------
SELECT pg_temp.expect_error('income categories can''t have a budget',
    $$INSERT INTO budgets (household_id, category_id, scope, month, amount_minor)
      SELECT '00000000-0000-7000-8000-00000000a002', a_scholarship, 'ongoing', '2026-11-01', 1000 FROM fx$$, '23503');
SELECT pg_temp.expect_error('a budget month is written as its 1st day',
    $$INSERT INTO budgets (household_id, category_id, scope, month, amount_minor)
      SELECT '00000000-0000-7000-8000-00000000a002', a_groceries, 'ongoing', '2026-11-15', 60000 FROM fx$$, '23514');
INSERT INTO budgets (household_id, category_id, scope, month, amount_minor)
SELECT '00000000-0000-7000-8000-00000000a002', a_groceries, 'ongoing', '2026-11-01', 60000 FROM fx;
SELECT pg_temp.expect_error('one ongoing limit per category per month',
    $$INSERT INTO budgets (household_id, category_id, scope, month, amount_minor)
      SELECT '00000000-0000-7000-8000-00000000a002', a_groceries, 'ongoing', '2026-11-01', 70000 FROM fx$$, '23505');
SELECT pg_temp.expect_error('a single-month override needs an amount',
    $$INSERT INTO budgets (household_id, category_id, scope, month, amount_minor)
      SELECT '00000000-0000-7000-8000-00000000a002', a_groceries, 'single_month', '2026-12-01', NULL FROM fx$$, '23514');

-- Categories -----------------------------------------------------------------------------
SELECT pg_temp.expect_error('category names are unique per household, ignoring case',
    $$INSERT INTO categories (household_id, kind, name, color, icon) VALUES ('00000000-0000-7000-8000-00000000a002', 'expense', 'groceries', 'mint', 'basket')$$, '23505');
SELECT pg_temp.expect_error('category colors come from the design palette',
    $$INSERT INTO categories (household_id, kind, name, color, icon) VALUES ('00000000-0000-7000-8000-00000000a002', 'expense', 'Pets', '#FF0000', 'dog')$$, '23514');
SELECT pg_temp.expect_error('only expense categories can be fixed',
    $$UPDATE categories SET is_fixed = true WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND system_key = 'salary'$$, '23514');

-- Exchange rates -------------------------------------------------------------------------
SELECT pg_temp.expect('fx_rate_on converts EUR → RON with the latest BNR rate',
    fx_rate_on('EUR', 'RON', '2020-01-08') = 4.78);
SELECT pg_temp.expect('fx_rate_on crosses through RON (EUR → USD)',
    fx_rate_on('EUR', 'USD', '2020-01-06') = round(4.78 / 4.27, 10));
SELECT pg_temp.expect('fx_rate_on returns NULL instead of guessing',
    fx_rate_on('EUR', 'RON', '2019-12-31') IS NULL);

-- Sync ----------------------------------------------------------------------------------
SELECT pg_temp.expect('every change takes the household''s next sync version',
    (SELECT max(v) = (SELECT change_seq FROM households WHERE id = '00000000-0000-7000-8000-00000000a002')
       FROM (SELECT row_version AS v FROM transactions WHERE household_id = '00000000-0000-7000-8000-00000000a002'
             UNION ALL SELECT row_version FROM categories WHERE household_id = '00000000-0000-7000-8000-00000000a002'
             UNION ALL SELECT row_version FROM budgets WHERE household_id = '00000000-0000-7000-8000-00000000a002'
             UNION ALL SELECT row_version FROM transfers WHERE household_id = '00000000-0000-7000-8000-00000000a002'
             UNION ALL SELECT row_version FROM accounts WHERE household_id = '00000000-0000-7000-8000-00000000a002') s));
CREATE TEMP TABLE before_delete AS SELECT row_version FROM transactions WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND title = 'Lidl';
UPDATE transactions SET deleted_at = now() WHERE household_id = '00000000-0000-7000-8000-00000000a002' AND title = 'Lidl';
SELECT pg_temp.expect('a soft delete gets a new sync version, so other devices learn about it',
    (SELECT t.row_version > b.row_version FROM transactions t, before_delete b WHERE t.household_id = '00000000-0000-7000-8000-00000000a002' AND t.title = 'Lidl'));
SELECT pg_temp.expect('households don''t share version counters',
    (SELECT change_seq FROM households WHERE id = '00000000-0000-7000-8000-00000000b002') = 14);

-- Usernames ------------------------------------------------------------------------------
SELECT pg_temp.expect('a user without a username gets one from their email',
    (SELECT username = 'ana' FROM users WHERE id = '00000000-0000-7000-8000-00000000a001'));
INSERT INTO users (email) VALUES ('ana@other.test'), ('ana.pop+x@example.test'), ('ab@example.test');
SELECT pg_temp.expect('a taken username gets a number',
    (SELECT username = 'ana2' FROM users WHERE email = 'ana@other.test'));
SELECT pg_temp.expect('generated usernames keep only a–z, 0–9, dot, underscore and hyphen',
    (SELECT username = 'ana.popx' FROM users WHERE email = 'ana.pop+x@example.test'));
SELECT pg_temp.expect('a local part shorter than 3 characters becomes "user"',
    (SELECT username = 'user' FROM users WHERE email = 'ab@example.test'));
INSERT INTO users (email, username) VALUES ('tester@example.test', 'schema-test-chosen-name');
SELECT pg_temp.expect('a chosen username is kept as given',
    (SELECT username = 'schema-test-chosen-name' FROM users WHERE email = 'tester@example.test'));
SELECT pg_temp.expect_error('usernames are stored lowercased',
    $$UPDATE users SET username = 'Ana' WHERE email = 'ana@other.test'$$, '23514');
SELECT pg_temp.expect_error('usernames are at least 3 characters',
    $$UPDATE users SET username = 'an' WHERE email = 'ana@other.test'$$, '23514');
SELECT pg_temp.expect_error('usernames can''t contain spaces or @',
    $$UPDATE users SET username = 'ana pop@x' WHERE email = 'ana@other.test'$$, '23514');
SELECT pg_temp.expect_error('usernames are unique',
    $$UPDATE users SET username = 'ana' WHERE email = 'ana@other.test'$$, '23505');

-- Exchange-rate helpers --------------------------------------------------------------------
INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate)
VALUES ('BNR', 'RON', 'JPY', '2020-01-06', 0.0310);
SELECT pg_temp.expect('fx_convert_minor converts and rounds to the target''s minor units',
    fx_convert_minor(999, 'EUR', 'RON', '2020-01-07') = 4775);
SELECT pg_temp.expect('fx_convert_minor rounds half away from zero',
    fx_convert_minor(50, 'USD', 'RON', '2020-01-07') = 214);
SELECT pg_temp.expect('fx_convert_minor respects currencies without decimals (1.000 ¥ → 31,00 lei)',
    fx_convert_minor(1000, 'JPY', 'RON', '2020-01-07') = 3100);
SELECT pg_temp.expect('fx_convert_minor leaves same-currency amounts alone',
    fx_convert_minor(1234, 'EUR', 'EUR', '2020-01-07') = 1234);
SELECT pg_temp.expect('fx_convert_minor is NULL when a rate is missing',
    fx_convert_minor(100, 'CHF', 'RON', '2020-01-07') IS NULL
    AND fx_convert_minor(100, 'EUR', 'RON', '2019-12-31') IS NULL);
SELECT pg_temp.expect('fx_quote gives the rate and the BNR day it comes from',
    (SELECT rate = 4.78 AND rate_date = '2020-01-06' FROM fx_quote('EUR', 'RON', '2020-01-12')));
SELECT pg_temp.expect('fx_quote: same currency is rate 1 with no date; missing is NULL',
    (SELECT rate = 1 AND rate_date IS NULL FROM fx_quote('RON', 'RON', '2020-01-12'))
    AND (SELECT rate IS NULL AND rate_date IS NULL FROM fx_quote('CHF', 'RON', '2020-01-12')));

-- Deleting an account (GDPR / App Store) ------------------------------------------------
DELETE FROM users WHERE id = '00000000-0000-7000-8000-00000000a001';
SELECT pg_temp.expect('deleting a user removes their household and all its data',
    NOT EXISTS (SELECT 1 FROM households WHERE id = '00000000-0000-7000-8000-00000000a002')
    AND NOT EXISTS (SELECT 1 FROM transactions WHERE household_id = '00000000-0000-7000-8000-00000000a002')
    AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id = '00000000-0000-7000-8000-00000000a001')
    AND NOT EXISTS (SELECT 1 FROM user_identities WHERE user_id = '00000000-0000-7000-8000-00000000a001'));
SELECT pg_temp.expect('other users are untouched',
    EXISTS (SELECT 1 FROM accounts WHERE household_id = '00000000-0000-7000-8000-00000000b002'));

ROLLBACK;
\echo 'All schema tests passed.'
