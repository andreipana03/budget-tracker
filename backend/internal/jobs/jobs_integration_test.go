package jobs

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

// Integration tests against TEST_DATABASE_URL. They never touch other tests' rows:
// BNR rates use 1998–1999 (others use 1990 and 2033), the missing-rate case 1985,
// and the subscription and cleanup jobs are scoped to the test's own household/user.
// They don't run in parallel with each other (the jobs share advisory locks).

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func bucharestTime(y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, bucharest)
}

func date(s string) time.Time {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return d
}

// --- BNR ---

// fakeBNR serves yearly and daily files built from cubes and counts the requests.
type fakeBNR struct {
	mu       sync.Mutex
	hits     map[string]int
	years    map[int]string
	daily    string
	failNext bool
}

func cubeXML(day string, rates ...string) string {
	return `<Cube date="` + day + `">` + strings.Join(rates, "") + `</Cube>`
}

func dataSet(cubes ...string) string {
	return `<?xml version="1.0" encoding="utf-8"?><DataSet xmlns="https://www.bnr.ro/xsd"><Header><Publisher>National Bank of Romania</Publisher></Header><Body><OrigCurrency>RON</OrigCurrency>` +
		strings.Join(cubes, "") + `</Body></DataSet>`
}

func (f *fakeBNR) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hits[r.URL.Path]++
	if f.failNext {
		f.failNext = false
		http.Error(w, "busy", http.StatusServiceUnavailable)
		return
	}
	var body string
	var year int
	if r.URL.Path == "/nbrfxrates.xml" {
		body = f.daily
	} else if _, err := fmt.Sscanf(r.URL.Path, "/files/xml/years/nbrfxrates%d.xml", &year); err == nil {
		body = f.years[year]
	}
	if body == "" {
		// BNR answers unknown paths with a redirect to an HTML page; a 404 is enough here.
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/xml")
	_, _ = io.WriteString(w, body)
}

func (f *fakeBNR) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[path]
}

func rateOn(t *testing.T, pool *pgxpool.Pool, code, day string) string {
	t.Helper()
	var v *string
	err := pool.QueryRow(context.Background(),
		`SELECT rate::text FROM fx_rates WHERE source = 'BNR' AND base_currency = 'RON' AND quote_currency = $1 AND rate_date = $2`,
		code, date(day)).Scan(&v)
	if err == pgx.ErrNoRows {
		return ""
	}
	if err != nil {
		t.Fatal(err)
	}
	return *v
}

func metadata(t *testing.T, pool *pgxpool.Pool, key string) string {
	t.Helper()
	var v string
	err := pool.QueryRow(context.Background(), `SELECT value FROM app_metadata WHERE key = $1`, key).Scan(&v)
	if err != nil && err != pgx.ErrNoRows {
		t.Fatal(err)
	}
	return v
}

func cleanBNR(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	clean := func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM fx_rates WHERE rate_date BETWEEN '1998-01-01' AND '1999-12-31'`)
		_, _ = pool.Exec(ctx, `DELETE FROM app_metadata WHERE key IN ($1, $2)`, keyBNRLastFetched, keyBNRLastBackfill)
	}
	clean()
	t.Cleanup(clean)
}

func TestBNRJob(t *testing.T) {
	pool := testdb.Pool(t)
	cleanBNR(t, pool)
	ctx := context.Background()

	fake := &fakeBNR{hits: map[string]int{}, years: map[int]string{
		1998: dataSet(
			cubeXML("1998-01-05", `<Rate currency="EUR">4.0000</Rate>`), // before the 400-day window
			cubeXML("1998-12-30", `<Rate currency="EUR">4.4000</Rate><Rate currency="USD">3.9000</Rate>`)),
		1999: dataSet(
			cubeXML("1999-03-10", `<Rate currency="EUR">4.5123</Rate><Rate currency="HUF" multiplier="100">1.4662</Rate>`,
				`<Rate currency="JPY" multiplier="100">3.0197</Rate><Rate currency="XAU">624.9110</Rate>`),
			cubeXML("1999-03-12", `<Rate currency="EUR">4.5200</Rate>`)),
	}, daily: dataSet(cubeXML("1999-03-15", `<Rate currency="EUR">4.5300</Rate><Rate currency="USD">4.0100</Rate>`))}
	srv := httptest.NewServer(fake)
	defer srv.Close()

	// A sample row like dev_seed.sql's: the real rate must replace it.
	if _, err := pool.Exec(ctx, `INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate) VALUES ('BNR', 'RON', 'EUR', '1999-03-10', 9.9999)`); err != nil {
		t.Fatal(err)
	}

	now := bucharestTime(1999, time.March, 15, 14, 0) // Monday after 13:30
	r := New(Options{Pool: pool, Logger: quiet, BNRBaseURL: srv.URL, Clock: clock.Func(func() time.Time { return now })})

	// 1. Nothing fetched yet → backfill from the yearly files (400 days: 1998 and 1999).
	if err := r.RunBNR(ctx); err != nil {
		t.Fatal(err)
	}
	if fake.count("/files/xml/years/nbrfxrates1998.xml") != 1 || fake.count("/files/xml/years/nbrfxrates1999.xml") != 1 || fake.count("/nbrfxrates.xml") != 0 {
		t.Errorf("requests after backfill: %v", fake.hits)
	}
	for _, c := range []struct{ code, day, want string }{
		{"EUR", "1999-03-10", "4.5123000000"}, // sample overwritten
		{"HUF", "1999-03-10", "0.0146620000"}, // divided by the multiplier
		{"JPY", "1999-03-10", "0.0301970000"},
		{"XAU", "1999-03-10", ""}, // not in currencies
		{"USD", "1998-12-30", "3.9000000000"},
		{"EUR", "1998-01-05", ""}, // outside the window
		{"EUR", "1999-03-12", "4.5200000000"},
	} {
		if got := rateOn(t, pool, c.code, c.day); got != c.want {
			t.Errorf("%s on %s: %q, want %q", c.code, c.day, got, c.want)
		}
	}
	if got := metadata(t, pool, keyBNRLastFetched); got != "1999-03-12" {
		t.Errorf("last fetched %q", got)
	}
	if got := metadata(t, pool, keyBNRLastBackfill); got != "1999-03-15" {
		t.Errorf("last backfill %q", got)
	}

	// 2. Recent days are in → today's daily file (Monday, after 13:30).
	if err := r.RunBNR(ctx); err != nil {
		t.Fatal(err)
	}
	if fake.count("/nbrfxrates.xml") != 1 || rateOn(t, pool, "USD", "1999-03-15") != "4.0100000000" {
		t.Errorf("daily: hits %v, USD %q", fake.hits, rateOn(t, pool, "USD", "1999-03-15"))
	}
	if got := metadata(t, pool, keyBNRLastFetched); got != "1999-03-15" {
		t.Errorf("last fetched after daily %q", got)
	}

	// 3. Today is in: nothing more to fetch.
	if err := r.RunBNR(ctx); err != nil {
		t.Fatal(err)
	}
	// 4. Next morning before 13:30: nothing either.
	now = bucharestTime(1999, time.March, 16, 10, 0)
	if err := r.RunBNR(ctx); err != nil {
		t.Fatal(err)
	}
	if fake.count("/nbrfxrates.xml") != 1 || fake.count("/files/xml/years/nbrfxrates1999.xml") != 1 {
		t.Errorf("unexpected requests: %v", fake.hits)
	}

	// 5. After 13:30 BNR is down: the error is returned (logged by the scheduler), nothing changes.
	now = bucharestTime(1999, time.March, 16, 14, 0)
	fake.failNext = true
	if err := r.RunBNR(ctx); err == nil {
		t.Error("want an error when BNR is down")
	}
	if got := metadata(t, pool, keyBNRLastFetched); got != "1999-03-15" {
		t.Errorf("marker moved on failure: %q", got)
	}
	// The next tick retries; BNR still shows yesterday's file (not published yet).
	if err := r.RunBNR(ctx); err != nil {
		t.Fatal(err)
	}
	if fake.count("/nbrfxrates.xml") != 3 || metadata(t, pool, keyBNRLastFetched) != "1999-03-15" {
		t.Errorf("retry: hits %v, marker %q", fake.hits, metadata(t, pool, keyBNRLastFetched))
	}

	// 6. Saturday: no daily fetch.
	now = bucharestTime(1999, time.March, 20, 15, 0)
	fake.daily = dataSet(cubeXML("1999-03-19", `<Rate currency="EUR">4.5400</Rate>`))
	if _, err := pool.Exec(ctx, `UPDATE app_metadata SET value = '1999-03-19' WHERE key = $1`, keyBNRLastFetched); err != nil {
		t.Fatal(err)
	}
	if err := r.RunBNR(ctx); err != nil {
		t.Fatal(err)
	}
	if fake.count("/nbrfxrates.xml") != 3 {
		t.Errorf("fetched on a Saturday: %v", fake.hits)
	}

	// BackfillRates (the seed's entry point) stores exactly the requested range.
	if _, err := pool.Exec(ctx, `DELETE FROM fx_rates WHERE rate_date BETWEEN '1998-01-01' AND '1999-12-31'`); err != nil {
		t.Fatal(err)
	}
	n, err := BackfillRates(ctx, pool, srv.Client(), srv.URL, date("1999-03-01"), date("1999-03-11"))
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 || rateOn(t, pool, "EUR", "1999-03-10") != "4.5123000000" || rateOn(t, pool, "EUR", "1999-03-12") != "" {
		t.Errorf("BackfillRates stored %d rows", n)
	}
	if _, err := BackfillRates(ctx, pool, srv.Client(), srv.URL, date("1997-03-01"), date("1997-03-11")); err == nil {
		t.Error("want an error for a year BNR doesn't have")
	}
}

// --- Subscriptions ---

type subEnv struct {
	t      *testing.T
	pool   *pgxpool.Pool
	f      testdb.Fixture
	ron    uuid.UUID
	fun    uuid.UUID
	now    time.Time
	runner *Runner
}

func newSubEnv(t *testing.T) *subEnv {
	t.Helper()
	pool := testdb.Pool(t)
	f := testdb.NewHousehold(t, pool)
	e := &subEnv{t: t, pool: pool, f: f}
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `INSERT INTO accounts (household_id, name, type, currency, opening_balance_on)
		VALUES ($1, 'ING', 'bank', 'RON', '1980-01-01') RETURNING id`, f.HouseholdID).Scan(&e.ron); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT id FROM categories WHERE household_id = $1 AND system_key = 'fun'`, f.HouseholdID).Scan(&e.fun); err != nil {
		t.Fatal(err)
	}
	e.runner = New(Options{Pool: pool, Logger: quiet, Clock: clock.Func(func() time.Time { return e.now })})
	e.runner.householdScope = &f.HouseholdID
	return e
}

// sub inserts a subscription on the RON account in the Fun category.
func (e *subEnv) sub(title string, amount int64, currency, freq, startsOn string, extra string) uuid.UUID {
	e.t.Helper()
	var id uuid.UUID
	q := `INSERT INTO recurring_transactions (household_id, title, amount_minor, currency, account_id, account_currency,
	        category_id, frequency, starts_on, next_due_on, created_by` + extraCols(extra) + `)
	      VALUES ($1, $2, $3, $4, $5, 'RON', $6, $7, $8, $8, $9` + extraVals(extra) + `) RETURNING id`
	if err := e.pool.QueryRow(context.Background(), q, e.f.HouseholdID, title, amount, currency, e.ron, e.fun, freq,
		date(startsOn), e.f.UserID).Scan(&id); err != nil {
		e.t.Fatalf("insert subscription %s: %v", title, err)
	}
	return id
}

func extraCols(extra string) string {
	if extra == "" {
		return ""
	}
	return ", " + strings.SplitN(extra, "=", 2)[0]
}

func extraVals(extra string) string {
	if extra == "" {
		return ""
	}
	return ", " + strings.SplitN(extra, "=", 2)[1]
}

func (e *subEnv) run() {
	e.t.Helper()
	if err := e.runner.RunSubscriptions(context.Background()); err != nil {
		e.t.Fatal(err)
	}
}

// occurrences lists a subscription's transactions as "date status".
func (e *subEnv) occurrences(id uuid.UUID) []string {
	e.t.Helper()
	rows, err := e.pool.Query(context.Background(), `
		SELECT recurring_occurrence_on::text || ' ' || status::text FROM transactions
		 WHERE recurring_id = $1 AND occurred_on = recurring_occurrence_on ORDER BY recurring_occurrence_on`, id)
	if err != nil {
		e.t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		e.t.Fatal(err)
	}
	return out
}

func (e *subEnv) nextDue(id uuid.UUID) string {
	e.t.Helper()
	var d string
	if err := e.pool.QueryRow(context.Background(), `SELECT next_due_on::text FROM recurring_transactions WHERE id = $1`, id).Scan(&d); err != nil {
		e.t.Fatal(err)
	}
	return d
}

func eq(t *testing.T, what string, got, want any) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("%s: got %v, want %v", what, got, want)
	}
}

func TestSubscriptionsJob(t *testing.T) {
	e := newSubEnv(t)
	ctx := context.Background()

	netflix := e.sub("Netflix", 3999, "RON", "monthly", "2032-01-15", "")
	monthEnd := e.sub("Rent", 25000, "RON", "monthly", "2032-01-31", "")
	paused := e.sub("Paused", 1000, "RON", "monthly", "2032-01-10", "is_active=false")
	deleted := e.sub("Deleted", 1000, "RON", "monthly", "2032-01-10", "deleted_at=now()")
	ending := e.sub("Gym", 9000, "RON", "monthly", "2032-01-05", "ends_on='2032-02-20'")
	weekly := e.sub("Laundry", 800, "RON", "weekly", "2031-01-01", "")

	e.now = bucharestTime(2032, time.June, 1, 0, 30) // just after midnight in Bucharest
	e.run()

	eq(t, "netflix", e.occurrences(netflix), []string{"2032-01-15 pending", "2032-02-15 pending", "2032-03-15 pending", "2032-04-15 pending", "2032-05-15 pending"})
	eq(t, "netflix next", e.nextDue(netflix), "2032-06-15")
	// Starts on the 31st: the last day of shorter months, back to the 31st when it can.
	eq(t, "month end", e.occurrences(monthEnd), []string{"2032-01-31 pending", "2032-02-29 pending", "2032-03-31 pending", "2032-04-30 pending", "2032-05-31 pending"})
	eq(t, "month end next", e.nextDue(monthEnd), "2032-06-30")
	eq(t, "paused", len(e.occurrences(paused)), 0)
	eq(t, "deleted", len(e.occurrences(deleted)), 0)
	eq(t, "ends_on", e.occurrences(ending), []string{"2032-01-05 pending", "2032-02-05 pending"})
	eq(t, "ends_on next", e.nextDue(ending), "2032-03-05")
	// At most 12 per run.
	eq(t, "weekly catch-up", len(e.occurrences(weekly)), 12)
	eq(t, "weekly next", e.nextDue(weekly), "2031-03-26")

	// The copied fields and frozen amounts of one occurrence.
	var title, kind, status, cur, home string
	var amount, accountAmount, homeAmount int64
	var rate string
	var rateDate *time.Time
	var createdBy *uuid.UUID
	if err := e.pool.QueryRow(ctx, `
		SELECT title, kind::text, status::text, currency, home_currency, amount_minor, account_amount_minor, home_amount_minor,
		       fx_rate::text, fx_rate_date, created_by
		  FROM transactions WHERE recurring_id = $1 AND recurring_occurrence_on = '2032-02-15'`, netflix).
		Scan(&title, &kind, &status, &cur, &home, &amount, &accountAmount, &homeAmount, &rate, &rateDate, &createdBy); err != nil {
		t.Fatal(err)
	}
	if title != "Netflix" || kind != "expense" || status != "pending" || cur != "RON" || home != "RON" ||
		amount != 3999 || accountAmount != 3999 || homeAmount != 3999 || rate != "1.0000000000" || rateDate != nil ||
		createdBy == nil || *createdBy != e.f.UserID {
		t.Errorf("occurrence: %s %s %s %s→%s %d/%d/%d rate %s %v by %v", title, kind, status, cur, home, amount, accountAmount, homeAmount, rate, rateDate, createdBy)
	}

	// Running again is harmless; a confirmed or skipped occurrence is never recreated.
	if _, err := e.pool.Exec(ctx, `UPDATE transactions SET status = 'skipped' WHERE recurring_id = $1 AND recurring_occurrence_on = '2032-05-15'`, netflix); err != nil {
		t.Fatal(err)
	}
	var before int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM transactions WHERE household_id = $1`, e.f.HouseholdID).Scan(&before)
	e.run()
	var after int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM transactions WHERE household_id = $1`, e.f.HouseholdID).Scan(&after)
	eq(t, "second run adds only the weekly catch-up", after-before, 12)
	eq(t, "netflix unchanged", e.occurrences(netflix)[4], "2032-05-15 skipped")
	eq(t, "netflix next unchanged", e.nextDue(netflix), "2032-06-15")

	// next_due_on ≤ an already-created occurrence (e.g. the user moved it back): the
	// conflict is ignored and the date still advances.
	if _, err := e.pool.Exec(ctx, `UPDATE recurring_transactions SET next_due_on = '2032-04-15' WHERE id = $1`, netflix); err != nil {
		t.Fatal(err)
	}
	e.run()
	eq(t, "netflix after rewind", len(e.occurrences(netflix)), 5)
	eq(t, "netflix next after rewind", e.nextDue(netflix), "2032-06-15")
}

func TestSubscriptionsHouseholdToday(t *testing.T) {
	e := newSubEnv(t)
	if _, err := e.pool.Exec(context.Background(), `UPDATE households SET timezone = 'America/Los_Angeles' WHERE id = $1`, e.f.HouseholdID); err != nil {
		t.Fatal(err)
	}
	id := e.sub("Spotify", 1299, "RON", "monthly", "2032-05-10", "")
	e.now = time.Date(2032, time.May, 10, 5, 0, 0, 0, time.UTC) // 9 May, 22:00 in Los Angeles
	e.run()
	eq(t, "not due yet in LA", len(e.occurrences(id)), 0)
	e.now = time.Date(2032, time.May, 10, 8, 0, 0, 0, time.UTC) // 10 May, 01:00 in Los Angeles
	e.run()
	eq(t, "due in LA", e.occurrences(id), []string{"2032-05-10 pending"})
}

func TestSubscriptionsMissingRate(t *testing.T) {
	e := newSubEnv(t)
	ctx := context.Background()
	t.Cleanup(func() {
		_, _ = e.pool.Exec(context.Background(), `DELETE FROM fx_rates WHERE quote_currency = 'CHF' AND rate_date = '1985-01-09'`)
	})
	id := e.sub("Swiss app", 1000, "CHF", "monthly", "1985-01-10", "")
	ok := e.sub("Local", 500, "RON", "monthly", "1985-01-10", "")
	e.now = bucharestTime(1985, time.March, 1, 12, 0)

	e.run()
	eq(t, "no rate: nothing created", len(e.occurrences(id)), 0)
	eq(t, "no rate: not advanced", e.nextDue(id), "1985-01-10")
	eq(t, "other subscriptions still run", len(e.occurrences(ok)), 2)

	if _, err := e.pool.Exec(ctx, `INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate) VALUES ('BNR', 'RON', 'CHF', '1985-01-09', 1.23456)`); err != nil {
		t.Fatal(err)
	}
	e.run()
	eq(t, "rate in: created", e.occurrences(id), []string{"1985-01-10 pending", "1985-02-10 pending"})
	eq(t, "rate in: advanced", e.nextDue(id), "1985-03-10")
	var home, account int64
	var rate, rateDate string
	if err := e.pool.QueryRow(ctx, `SELECT home_amount_minor, account_amount_minor, fx_rate::text, fx_rate_date::text FROM transactions
		WHERE recurring_id = $1 AND recurring_occurrence_on = '1985-02-10'`, id).Scan(&home, &account, &rate, &rateDate); err != nil {
		t.Fatal(err)
	}
	// 10,00 CHF × 1.23456 = 12,3456 lei → 1235 bani (half away from zero).
	if home != 1235 || account != 1235 || rate != "1.2345600000" || rateDate != "1985-01-09" {
		t.Errorf("frozen: home %d account %d rate %s date %s", home, account, rate, rateDate)
	}
}

// --- Cleanup ---

func TestCleanupJob(t *testing.T) {
	pool := testdb.Pool(t)
	f := testdb.NewHousehold(t, pool)
	ctx := context.Background()
	now := time.Now()
	ago := func(d time.Duration) time.Time { return now.Add(-d) }
	day := 24 * time.Hour

	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Challenges: expired, still valid.
	exec(`INSERT INTO webauthn_challenges (user_id, ceremony, session_data, expires_at, created_at) VALUES
		($1, 'registration', '{}', $2, $3), ($1, 'registration', '{"keep":true}', $4, $5)`,
		f.UserID, ago(time.Minute), ago(6*time.Minute), now.Add(4*time.Minute), ago(time.Minute))
	// Tokens: consumed 8 days ago, expired 8 days ago, consumed 2 days ago, valid.
	token := func(label string, created, expires time.Time, consumed *time.Time) {
		h := make([]byte, 32)
		copy(h, label+uuid.NewString())
		exec(`INSERT INTO verification_tokens (user_id, purpose, token_hash, email, expires_at, consumed_at, created_at)
			VALUES ($1, 'email_verification', $2, $3, $4, $5, $6)`, f.UserID, h, label, expires, consumed, created)
	}
	c8, c2 := ago(8*day), ago(2*day)
	token("old-consumed", ago(9*day), ago(8*day+time.Hour), &c8)
	token("old-expired", ago(10*day), ago(8*day), nil)
	token("recent-consumed", ago(3*day), now.Add(day), &c2)
	token("valid", ago(time.Hour), now.Add(23*time.Hour), nil)
	// Sessions: expired 31 days ago, revoked 31 days ago, revoked 5 days ago, active.
	session := func(label string, created, expires time.Time, revoked *time.Time) {
		h := make([]byte, 32)
		copy(h, label+uuid.NewString())
		exec(`INSERT INTO sessions (user_id, refresh_token_hash, platform, auth_method, device_name, created_at, expires_at, revoked_at)
			VALUES ($1, $2, 'web', 'password', $3, $4, $5, $6)`, f.UserID, h, label, created, expires, revoked)
	}
	r31, r5 := ago(31*day), ago(5*day)
	session("old-expired", ago(120*day), ago(31*day), nil)
	session("old-revoked", ago(40*day), now.Add(50*day), &r31)
	session("recent-revoked", ago(10*day), now.Add(80*day), &r5)
	session("active", ago(day), now.Add(89*day), nil)

	r := New(Options{Pool: pool, Logger: quiet, Clock: clock.Fixed{T: now}})
	r.userScope = &f.UserID
	if err := r.RunCleanup(ctx); err != nil {
		t.Fatal(err)
	}

	list := func(q string) []string {
		t.Helper()
		rows, err := pool.Query(ctx, q, f.UserID)
		if err != nil {
			t.Fatal(err)
		}
		out, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	eq(t, "challenges", list(`SELECT session_data::text FROM webauthn_challenges WHERE user_id = $1`), []string{`{"keep": true}`})
	eq(t, "tokens", list(`SELECT email FROM verification_tokens WHERE user_id = $1 ORDER BY email`), []string{"recent-consumed", "valid"})
	eq(t, "sessions", list(`SELECT device_name FROM sessions WHERE user_id = $1 ORDER BY device_name`), []string{"active", "recent-revoked"})
}

// --- Runner ---

func TestRunnerLockPanicAndShutdown(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	r := New(Options{Pool: pool, Logger: quiet})
	nobody := uuid.New()
	r.userScope, r.householdScope = &nobody, &nobody

	// Another instance holds the lock: the run is skipped.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, lockCleanup); err != nil {
		t.Fatal(err)
	}
	ran := false
	if err := r.run(ctx, "test", lockCleanup, func(context.Context, pgx.Tx, time.Time) error { ran = true; return nil }); err != nil || ran {
		t.Errorf("locked run: err %v, ran %v", err, ran)
	}
	_ = tx.Rollback(ctx)

	// A panic is recovered, returned as an error, and releases the lock.
	err = r.run(ctx, "test", lockCleanup, func(context.Context, pgx.Tx, time.Time) error { panic("boom") })
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Errorf("panic: %v", err)
	}
	if err := r.run(ctx, "test", lockCleanup, func(context.Context, pgx.Tx, time.Time) error { ran = true; return nil }); err != nil || !ran {
		t.Errorf("run after panic: err %v, ran %v", err, ran)
	}

	// Start runs the jobs and Wait returns once the context is done. BNR points at a
	// server that has nothing, so its run only logs an error.
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	r.bnrBase = srv.URL
	runCtx, cancel := context.WithCancel(ctx)
	r.Start(runCtx)
	time.Sleep(200 * time.Millisecond)
	cancel()
	done := make(chan struct{})
	go func() { r.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Wait didn't return after cancel")
	}
}
