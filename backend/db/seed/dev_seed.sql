-- Demo data for local development: November 2026 exactly as in the design mockups
-- (DesignAssets/screenshots). Load it with `make db-seed` after `make migrate`.
--
--   Sign in:  demo@budget-tracker.test / budget-demo-2026
--   "Today":  Wednesday 18 November 2026
--   Expect:   2.000 lei budgeted · 1.234,29 spent · 765,71 left · about 55 lei a day
--             ING Card 2.140,30 lei · Cash 186,00 lei · Revolut 312,45 € · subscriptions ≈ 162,87 lei/month
--
-- Safe to run again: it deletes the demo user first, which removes all of their data.
-- The exchange rates below are SAMPLE values, not real BNR rates. Never load this in production.

BEGIN;

DELETE FROM users WHERE email = 'demo@budget-tracker.test';

-- Sample "BNR" rates for every banking day from 26 Oct to 18 Nov 2026.
INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate)
SELECT 'BNR', 'RON', q.code, d::date, q.rate
  FROM generate_series('2026-10-26'::date, '2026-11-18'::date, interval '1 day') AS d
 CROSS JOIN (VALUES ('EUR', 4.9800::numeric), ('USD', 4.6200), ('GBP', 5.7600)) AS q (code, rate)
 WHERE extract(isodow FROM d) < 6
ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, email_verified_at, password_hash, password_changed_at, display_name, locale, region)
VALUES ('019a0000-0000-7000-8000-000000000001', 'demo@budget-tracker.test', '2026-09-01 10:00+03',
        '$argon2id$v=19$m=65536,t=3,p=2$HGvjAyqjq8l+6HsY1sB3kg$bXEAhQ7w+ycWiaZI/U/S24vmfW/liSvQXWzjI0SwpCI',
        '2026-09-01 10:00+03', 'Demo Student', 'en', 'RO');

-- Creating the household also creates its 13 default categories (trigger).
INSERT INTO households (id, name, home_currency, timezone)
VALUES ('019a0000-0000-7000-8000-000000000002', 'Personal', 'RON', 'Europe/Bucharest');

INSERT INTO household_members (household_id, user_id, role)
VALUES ('019a0000-0000-7000-8000-000000000002', '019a0000-0000-7000-8000-000000000001', 'owner');

INSERT INTO accounts (id, household_id, name, type, currency, opening_balance_minor, opening_balance_on, sort_order, created_by) VALUES
    ('019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000002', 'ING Card', 'bank', 'RON', 142033, '2026-11-01', 10, '019a0000-0000-7000-8000-000000000001'),
    ('019a0000-0000-7000-8000-000000000102', '019a0000-0000-7000-8000-000000000002', 'Cash',     'cash', 'RON',   4051, '2026-11-01', 20, '019a0000-0000-7000-8000-000000000001'),
    ('019a0000-0000-7000-8000-000000000103', '019a0000-0000-7000-8000-000000000002', 'Revolut',  'bank', 'EUR',  32244, '2026-11-01', 30, '019a0000-0000-7000-8000-000000000001');

-- Monthly limits. Groceries was 550 from September and was raised to 600 from November;
-- Eating Out gets a one-off 400 for December (holidays).
INSERT INTO budgets (household_id, category_id, scope, month, amount_minor, created_by)
SELECT '019a0000-0000-7000-8000-000000000002', c.id, b.scope::budget_scope, b.month::date, b.amount, '019a0000-0000-7000-8000-000000000001'
  FROM (VALUES
        ('groceries',  'ongoing',      '2026-09-01', 55000),
        ('groceries',  'ongoing',      '2026-11-01', 60000),
        ('eating_out', 'ongoing',      '2026-09-01', 30000),
        ('eating_out', 'single_month', '2026-12-01', 40000),
        ('housing',    'ongoing',      '2026-09-01', 35000),
        ('transport',  'ongoing',      '2026-09-01', 12000),
        ('fun',        'ongoing',      '2026-09-01', 20000),
        ('shopping',   'ongoing',      '2026-09-01', 25000),
        ('education',  'ongoing',      '2026-09-01', 10000),
        ('other',      'ongoing',      '2026-09-01',  8000)
       ) AS b (system_key, scope, month, amount)
  JOIN categories c ON c.household_id = '019a0000-0000-7000-8000-000000000002' AND c.system_key = b.system_key;

-- Subscriptions (and the monthly allowance, which repeats too).
INSERT INTO recurring_transactions (id, household_id, kind, title, amount_minor, currency, account_id, account_currency,
                                    category_id, frequency, starts_on, next_due_on, created_by)
SELECT r.id::uuid, '019a0000-0000-7000-8000-000000000002', r.kind::entry_kind, r.title, r.amount, r.currency, a.id, a.currency,
       c.id, r.frequency::recurrence_frequency, r.starts_on::date, r.next_due_on::date, '019a0000-0000-7000-8000-000000000001'
  FROM (VALUES
        ('019a0000-0000-7000-8000-000000000201', 'expense', 'Netflix',        3999, 'RON', '019a0000-0000-7000-8000-000000000101', 'fun',       'monthly', '2026-09-21', '2026-11-21'),
        ('019a0000-0000-7000-8000-000000000202', 'expense', 'Digi Mobile',    2500, 'RON', '019a0000-0000-7000-8000-000000000101', 'housing',   'monthly', '2026-10-25', '2026-11-25'),
        ('019a0000-0000-7000-8000-000000000203', 'expense', 'Metrorex Pass',  5000, 'RON', '019a0000-0000-7000-8000-000000000101', 'transport', 'monthly', '2026-10-01', '2026-12-01'),
        ('019a0000-0000-7000-8000-000000000204', 'expense', 'Google One',      999, 'RON', '019a0000-0000-7000-8000-000000000101', 'other',     'monthly', '2026-10-02', '2026-12-02'),
        ('019a0000-0000-7000-8000-000000000205', 'expense', 'Spotify',        1299, 'RON', '019a0000-0000-7000-8000-000000000101', 'fun',       'monthly', '2026-10-15', '2026-12-15'),
        ('019a0000-0000-7000-8000-000000000206', 'expense', 'Duolingo Super', 5999, 'EUR', '019a0000-0000-7000-8000-000000000103', 'education', 'yearly',  '2026-03-03', '2027-03-03'),
        ('019a0000-0000-7000-8000-000000000207', 'income',  'Allowance',    120000, 'RON', '019a0000-0000-7000-8000-000000000101', 'allowance', 'monthly', '2026-10-01', '2026-12-01')
       ) AS r (id, kind, title, amount, currency, account_id, system_key, frequency, starts_on, next_due_on)
  JOIN accounts a ON a.id = r.account_id::uuid
  JOIN categories c ON c.household_id = '019a0000-0000-7000-8000-000000000002' AND c.system_key = r.system_key;

-- November's transactions. Amounts in the currency paid; the lei value and rate are
-- frozen with the sample BNR rate of the day, exactly as the API will do it.
INSERT INTO transactions (household_id, kind, title, note, occurred_on, occurred_at, category_id, account_id, account_currency,
                          amount_minor, currency, account_amount_minor, home_currency, home_amount_minor, fx_rate, fx_rate_date,
                          recurring_id, recurring_occurrence_on, created_by)
SELECT '019a0000-0000-7000-8000-000000000002', v.kind::entry_kind, v.title, v.note, v.d::date,
       (v.d || ' ' || v.t)::timestamp AT TIME ZONE 'Europe/Bucharest',
       c.id, a.id, a.currency,
       v.amount, v.currency,
       CASE WHEN v.currency = a.currency THEN v.amount
            ELSE round(v.amount * fx_rate_on(v.currency, a.currency, v.d::date))::bigint END,
       'RON',
       CASE WHEN v.currency = 'RON' THEN v.amount
            ELSE round(v.amount * fx_rate_on(v.currency, 'RON', v.d::date))::bigint END,
       CASE WHEN v.currency = 'RON' THEN 1 ELSE fx_rate_on(v.currency, 'RON', v.d::date) END,
       CASE WHEN v.currency = 'RON' THEN NULL
            ELSE (SELECT max(r.rate_date) FROM fx_rates r
                   WHERE r.source = 'BNR' AND r.base_currency = 'RON' AND r.quote_currency = v.currency AND r.rate_date <= v.d::date) END,
       v.recurring_id::uuid,
       CASE WHEN v.recurring_id IS NULL THEN NULL ELSE v.d::date END,
       '019a0000-0000-7000-8000-000000000001'
  FROM (VALUES
        -- kind,     title,             note,                     day,          time,    category,       account,                                amount, currency, recurring
        ('income',  'Allowance',       'From Mom & Dad',          '2026-11-01', '09:00', 'allowance',    '019a0000-0000-7000-8000-000000000101', 120000, 'RON', '019a0000-0000-7000-8000-000000000207'),
        ('expense', 'Metrorex Pass',   NULL,                      '2026-11-01', '08:00', 'transport',    '019a0000-0000-7000-8000-000000000101',   5000, 'RON', '019a0000-0000-7000-8000-000000000203'),
        ('expense', 'Dorm Rent',       'Room 214, Grozăvești',    '2026-11-01', '10:00', 'housing',      '019a0000-0000-7000-8000-000000000101',  25000, 'RON', NULL),
        ('expense', 'Google One',      NULL,                      '2026-11-02', '09:00', 'other',        '019a0000-0000-7000-8000-000000000101',    999, 'RON', '019a0000-0000-7000-8000-000000000204'),
        ('expense', 'Origo Coffee',    NULL,                      '2026-11-03', '08:40', 'eating_out',   '019a0000-0000-7000-8000-000000000102',   2600, 'RON', NULL),
        ('expense', 'Enel',            'Share of the dorm bill',  '2026-11-05', '18:20', 'housing',      '019a0000-0000-7000-8000-000000000101',   4500, 'RON', NULL),
        ('expense', 'Glovo',           NULL,                      '2026-11-06', '20:15', 'eating_out',   '019a0000-0000-7000-8000-000000000101',   3850, 'RON', NULL),
        ('expense', 'Cinema City',     NULL,                      '2026-11-07', '19:30', 'fun',          '019a0000-0000-7000-8000-000000000101',   2225, 'RON', NULL),
        ('expense', 'Carrefour',       NULL,                      '2026-11-08', '11:10', 'groceries',    '019a0000-0000-7000-8000-000000000101',   8630, 'RON', NULL),
        ('expense', 'Laundry',         NULL,                      '2026-11-09', '16:00', 'other',        '019a0000-0000-7000-8000-000000000102',    851, 'RON', NULL),
        ('expense', 'KFC',             NULL,                      '2026-11-10', '13:05', 'eating_out',   '019a0000-0000-7000-8000-000000000101',   3150, 'RON', NULL),
        ('expense', 'Decathlon',       NULL,                      '2026-11-13', '12:30', 'shopping',     '019a0000-0000-7000-8000-000000000101',   4000, 'RON', NULL),
        ('expense', 'Starbucks',       NULL,                      '2026-11-13', '15:10', 'eating_out',   '019a0000-0000-7000-8000-000000000101',   2600, 'RON', NULL),
        ('expense', 'Caru'' cu Bere',  'Birthday dinner',         '2026-11-13', '20:45', 'eating_out',   '019a0000-0000-7000-8000-000000000101',  14860, 'RON', NULL),
        ('expense', 'Spotify',         NULL,                      '2026-11-15', '08:00', 'fun',          '019a0000-0000-7000-8000-000000000101',   1299, 'RON', '019a0000-0000-7000-8000-000000000205'),
        ('expense', 'Kaufland',        NULL,                      '2026-11-15', '19:10', 'groceries',    '019a0000-0000-7000-8000-000000000101',   5820, 'RON', NULL),
        ('income',  'Scholarship',     'Merit scholarship',       '2026-11-16', '09:00', 'scholarship',  '019a0000-0000-7000-8000-000000000101',  85000, 'RON', NULL),
        ('expense', 'H&M',             NULL,                      '2026-11-16', '15:20', 'shopping',     '019a0000-0000-7000-8000-000000000101',  12990, 'RON', NULL),
        ('expense', 'Cărturești',      NULL,                      '2026-11-16', '17:45', 'education',    '019a0000-0000-7000-8000-000000000101',   3600, 'RON', NULL),
        ('expense', 'Mega Image',      NULL,                      '2026-11-17', '18:02', 'groceries',    '019a0000-0000-7000-8000-000000000101',   3760, 'RON', NULL),
        ('expense', 'Glovo',           NULL,                      '2026-11-17', '20:31', 'eating_out',   '019a0000-0000-7000-8000-000000000101',   4290, 'RON', NULL),
        ('expense', 'Steam',           'Autumn sale',             '2026-11-17', '21:14', 'fun',          '019a0000-0000-7000-8000-000000000103',    999, 'EUR', NULL),
        ('expense', 'Copy Center',     'Seminar handouts',        '2026-11-18', '09:12', 'education',    '019a0000-0000-7000-8000-000000000102',    600, 'RON', NULL),
        ('expense', 'Origo Coffee',    NULL,                      '2026-11-18', '10:05', 'eating_out',   '019a0000-0000-7000-8000-000000000102',   1400, 'RON', NULL),
        ('expense', 'Lidl',            NULL,                      '2026-11-18', '13:42', 'groceries',    '019a0000-0000-7000-8000-000000000101',   6430, 'RON', NULL)
       ) AS v (kind, title, note, d, t, system_key, account_id, amount, currency, recurring_id)
  JOIN accounts a ON a.id = v.account_id::uuid
  JOIN categories c ON c.household_id = '019a0000-0000-7000-8000-000000000002' AND c.system_key = v.system_key;

-- ATM withdrawal: money moves from ING to Cash; it is not spending.
INSERT INTO transfers (household_id, from_account_id, from_currency, from_amount_minor, to_account_id, to_currency, to_amount_minor,
                       occurred_on, occurred_at, note, created_by)
VALUES ('019a0000-0000-7000-8000-000000000002',
        '019a0000-0000-7000-8000-000000000101', 'RON', 20000,
        '019a0000-0000-7000-8000-000000000102', 'RON', 20000,
        '2026-11-04', '2026-11-04 17:30+02', 'ATM withdrawal', '019a0000-0000-7000-8000-000000000001');

COMMIT;
