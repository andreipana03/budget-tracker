package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

// ---------------------------------------------------------------- helpers

type screensTAuth struct{ p Principal }

func (a screensTAuth) Authenticate(context.Context, *http.Request) (Principal, error) {
	return a.p, nil
}

// screensTRouter serves the API as p, with "now" fixed.
func screensTRouter(t *testing.T, pool *pgxpool.Pool, now time.Time, p Principal) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := NewServer(Deps{Pool: pool, Logger: logger, Clock: clock.Fixed{T: now}})
	return NewRouter(srv, logger, RouterOptions{Authenticator: screensTAuth{p}})
}

// screensTDo sends a request and decodes a 200 body into out. It returns the status
// and, for errors, the decoded error body.
func screensTDo(t *testing.T, h http.Handler, method, path string, body, out any) (int, gen.Error) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var e gen.Error
	if rec.Code == http.StatusOK && out != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("%s %s: decode: %v\n%s", method, path, err, rec.Body.String())
		}
	} else if rec.Code != http.StatusOK {
		_ = json.Unmarshal(rec.Body.Bytes(), &e)
	}
	return rec.Code, e
}

func screensTGet(t *testing.T, h http.Handler, path string, out any) {
	t.Helper()
	if code, e := screensTDo(t, h, http.MethodGet, path, nil, out); code != http.StatusOK {
		t.Fatalf("GET %s = %d %+v", path, code, e)
	}
}

type screensTHousehold struct {
	t       *testing.T
	pool    *pgxpool.Pool
	p       Principal
	account uuid.UUID
	cats    map[string]uuid.UUID // by system_key
}

// screensTNewHousehold creates a household (RON) with the given month start day, created
// on createdOn, with one RON account.
func screensTNewHousehold(t *testing.T, pool *pgxpool.Pool, startDay int, createdOn string) *screensTHousehold {
	t.Helper()
	ctx := context.Background()
	f := testdb.NewHousehold(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE households SET month_start_day = $2, created_at = $3::date + time '12:00' WHERE id = $1`,
		f.HouseholdID, startDay, createdOn); err != nil {
		t.Fatalf("update household: %v", err)
	}
	h := &screensTHousehold{t: t, pool: pool, p: Principal{UserID: f.UserID, HouseholdID: f.HouseholdID}, cats: map[string]uuid.UUID{}}
	if err := pool.QueryRow(ctx, `INSERT INTO accounts (household_id, name, currency) VALUES ($1, 'Card', 'RON') RETURNING id`,
		f.HouseholdID).Scan(&h.account); err != nil {
		t.Fatalf("insert account: %v", err)
	}
	rows, err := pool.Query(ctx, `SELECT system_key, id FROM categories WHERE household_id = $1`, f.HouseholdID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var id uuid.UUID
		if err := rows.Scan(&key, &id); err != nil {
			t.Fatal(err)
		}
		h.cats[key] = id
	}
	return h
}

// spend records an expense in RON (status posted unless given).
func (h *screensTHousehold) spend(day, category string, amount int64, status ...string) {
	h.t.Helper()
	st := "posted"
	if len(status) > 0 {
		st = status[0]
	}
	if _, err := h.pool.Exec(context.Background(), `
		INSERT INTO transactions (household_id, kind, status, title, occurred_on, category_id, account_id, account_currency,
		                          amount_minor, currency, account_amount_minor, home_currency, home_amount_minor)
		VALUES ($1, 'expense', $2::transaction_status, 'Test', $3::date, $4, $5, 'RON', $6, 'RON', $6, 'RON', $6)`,
		h.p.HouseholdID, st, day, h.cats[category], h.account, amount); err != nil {
		h.t.Fatalf("insert expense: %v", err)
	}
}

func (h *screensTHousehold) budget(category, scope, month string, amount *int64) {
	h.t.Helper()
	if _, err := h.pool.Exec(context.Background(), `
		INSERT INTO budgets (household_id, category_id, scope, month, amount_minor)
		VALUES ($1, $2, $3::budget_scope, $4::date, $5)`,
		h.p.HouseholdID, h.cats[category], scope, month+"-01", amount); err != nil {
		h.t.Fatalf("insert budget: %v", err)
	}
}

func screensTNoon(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 10, 0, 0, 0, time.UTC) // 12:00 or 13:00 in Bucharest
}

func screensTLine(t *testing.T, lines []gen.BudgetLine, name string) gen.BudgetLine {
	t.Helper()
	for _, l := range lines {
		if l.Category.Name == name {
			return l
		}
	}
	t.Fatalf("no line %q in %d lines", name, len(lines))
	return gen.BudgetLine{}
}

func screensTNames(lines []gen.BudgetLine) []string {
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = l.Category.Name
	}
	return out
}

func screensTEq[T comparable](t *testing.T, what string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

func screensTEqPtr[T comparable](t *testing.T, what string, got *T, want *T) {
	t.Helper()
	switch {
	case got == nil && want == nil:
	case got == nil || want == nil:
		t.Errorf("%s = %v, want %v", what, screensTShow(got), screensTShow(want))
	case *got != *want:
		t.Errorf("%s = %v, want %v", what, *got, *want)
	}
}

func screensTShow[T any](p *T) any {
	if p == nil {
		return "null"
	}
	return *p
}

func screensTNear(t *testing.T, what string, got *float64, want float64) {
	t.Helper()
	if got == nil || math.Abs(*got-want) > 1e-9 {
		t.Errorf("%s = %v, want %v", what, screensTShow(got), want)
	}
}

func screensTSlice[T comparable](t *testing.T, what string, got, want []T) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s = %v, want %v", what, got, want)
		return
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s = %v, want %v", what, got, want)
			return
		}
	}
}

// ---------------------------------------------------------------- golden: the design mockup

func screensTLoadSeed(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	sql, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "db", "seed", "dev_seed.sql"))
	if err != nil {
		t.Fatalf("read seed: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("load seed: %v", err)
	}
}

func TestScreensGoldenMockup(t *testing.T) {
	pool := testdb.Pool(t)
	screensTLoadSeed(t, pool)
	p := Principal{
		UserID:      uuid.MustParse("019a0000-0000-7000-8000-000000000001"),
		HouseholdID: uuid.MustParse("019a0000-0000-7000-8000-000000000002"),
	}
	r := screensTRouter(t, pool, screensTNoon(2026, 11, 18), p)

	var b gen.BudgetMonth
	screensTGet(t, r, "/budgets?month=2026-11", &b)
	tot := b.Totals
	screensTEq(t, "budget", tot.BudgetMinor, 200000)
	screensTEq(t, "spent", tot.SpentMinor, 123429)
	screensTEq(t, "left", tot.LeftMinor, 76571)
	screensTEqPtr(t, "perDay", tot.PerDayMinor, ptr(int64(5500)))
	screensTEqPtr(t, "underPace", tot.UnderPaceMinor, ptr(int64(5071)))
	screensTNear(t, "paceMarker", tot.PaceMarker, 0.67)
	screensTEq(t, "status", tot.Status, gen.BudgetStatusOnTrack)
	screensTEq(t, "daysLeft", b.Period.DaysLeft, 13)
	screensTEq(t, "elapsed", b.Period.Elapsed, 0.6)
	screensTEq(t, "state", b.Period.State, gen.BudgetPeriodStateCurrent)
	screensTEq(t, "hasBudget", b.HasBudget, true)

	eat := screensTLine(t, b.Flexible, "Eating Out")
	screensTEq(t, "eating out status", eat.Status, gen.BudgetStatusOver)
	screensTEq(t, "eating out spent", eat.SpentMinor, 32750)
	screensTEqPtr(t, "eating out limit", eat.LimitMinor, ptr(int64(30000)))
	screensTEqPtr(t, "eating out left", eat.LeftMinor, ptr(int64(-2750)))
	shop := screensTLine(t, b.Flexible, "Shopping")
	screensTEq(t, "shopping status", shop.Status, gen.BudgetStatusAhead)
	screensTEq(t, "shopping spent", shop.SpentMinor, 16990)
	screensTEqPtr(t, "shopping limit", shop.LimitMinor, ptr(int64(25000)))
	housing := screensTLine(t, b.Fixed, "Housing & Bills")
	screensTEq(t, "housing spent", housing.SpentMinor, 29500)
	screensTEqPtr(t, "housing limit", housing.LimitMinor, ptr(int64(35000)))
	screensTEq(t, "housing status", housing.Status, gen.BudgetStatusOnTrack)
	groceries := screensTLine(t, b.Flexible, "Groceries")
	if groceries.Scope == nil || *groceries.Scope != gen.BudgetLineScopeOngoing || *groceries.LimitMinor != 60000 {
		t.Errorf("groceries = %+v", groceries)
	}
	screensTSlice(t, "flexible order", screensTNames(b.Flexible),
		[]string{"Eating Out", "Shopping", "Fun", "Education", "Transport", "Groceries", "Other"})
	screensTEq(t, "unbudgeted", len(b.Unbudgeted), 0)
	// Segments: fixed first, then flexible in sort order; Eating Out capped at its limit.
	if len(b.Segments) != 8 || b.Segments[0].Category.Name != "Housing & Bills" || b.Segments[1].Category.Name != "Groceries" ||
		b.Segments[2].AmountMinor != 30000 {
		t.Errorf("segments = %+v", b.Segments)
	}

	wantAttention := []string{"Eating Out", "Housing & Bills", "Shopping", "Fun", "Education", "Transport", "Groceries", "Other"}
	var home gen.Home
	screensTGet(t, r, "/home?month=2026-11", &home)
	screensTSlice(t, "attention order", screensTNames(home.Attention), wantAttention)
	screensTEq(t, "home budget spent", home.Budget.Totals.SpentMinor, 123429)
	screensTEq(t, "pending", home.PendingCount, 0)
	screensTEq(t, "due soon", home.DueSoonCount, 2) // Netflix (21 Nov), Digi Mobile (25 Nov)
	screensTEq(t, "upcoming", len(home.Upcoming), 6)
	if len(home.Upcoming) > 0 {
		screensTEq(t, "first upcoming", home.Upcoming[0].Title, "Netflix")
	}
	screensTEq(t, "recent", len(home.Recent), 6)

	var months gen.MonthList
	screensTGet(t, r, "/months", &months)
	screensTEq(t, "current", months.Current, "2026-11")
	if len(months.Items) < 2 || months.Items[0].Month != "2026-12" {
		t.Fatalf("months = %+v", months.Items)
	}
	nov := months.Items[1]
	screensTEq(t, "months[1]", nov.Month, "2026-11")
	screensTEq(t, "november spent", nov.SpentMinor, 123429)
	screensTEqPtr(t, "november budget", nov.BudgetMinor, ptr(int64(200000)))
	screensTEqPtr(t, "december budget", months.Items[0].BudgetMinor, ptr(int64(210000))) // Eating Out 400 in December
	screensTEq(t, "last month", months.Items[len(months.Items)-1].Month, "2026-09")      // first budget row

	var ins gen.Insights
	screensTGet(t, r, "/insights", &ins)
	last := ins.Bars[len(ins.Bars)-1]
	screensTEq(t, "insights period", ins.Period, gen.InsightsPeriodSixMonths)
	screensTEq(t, "current bar", last.SpentMinor, 123429)
	screensTEq(t, "current bar is current", last.IsCurrent, true)
	screensTEqPtr(t, "projection", last.ProjectedMinor, ptr(int64(191548))) // 350 + 939,29 × 30/18
	screensTEqPtr(t, "no October data", ins.Headline.PreviousMinor, nil)
	screensTEq(t, "subscriptions active", ins.Subscriptions.ActiveCount, 6)
	screensTEq(t, "subscriptions per month", ins.Subscriptions.PerMonthMinor, 16287)
	if ins.Subscriptions.Next == nil || ins.Subscriptions.Next.Title != "Netflix" {
		t.Errorf("next subscription = %+v", ins.Subscriptions.Next)
	}
}

// ---------------------------------------------------------------- budgets

// Month start day 10, a single-month override, an ongoing row removing a limit, and
// past / current / future months.
func TestScreensBudgetsStartDay10(t *testing.T) {
	pool := testdb.Pool(t)
	h := screensTNewHousehold(t, pool, 10, "2026-08-15")
	h.budget("groceries", "ongoing", "2026-09", ptr(int64(60000)))
	h.budget("eating_out", "ongoing", "2026-09", ptr(int64(30000)))
	h.budget("eating_out", "single_month", "2026-11", ptr(int64(50000)))
	h.budget("housing", "ongoing", "2026-10", ptr(int64(100000)))
	h.budget("transport", "ongoing", "2026-09", ptr(int64(20000)))
	h.budget("transport", "ongoing", "2026-11", nil) // no limit from November on
	h.spend("2026-11-09", "groceries", 9999)         // October's period
	h.spend("2026-11-10", "groceries", 20000)
	h.spend("2026-11-24", "groceries", 10000)
	h.spend("2026-11-20", "groceries", 7777, "pending") // never counts
	h.spend("2026-11-12", "eating_out", 35000)
	h.spend("2026-11-10", "housing", 100000)
	h.spend("2026-11-15", "transport", 5000)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO transactions (household_id, kind, title, occurred_on, category_id, account_id, account_currency,
		                          amount_minor, currency, account_amount_minor, home_currency, home_amount_minor, deleted_at)
		VALUES ($1, 'expense', 'Deleted', '2026-11-11', $2, $3, 'RON', 1234, 'RON', 1234, 'RON', 1234, now())`,
		h.p.HouseholdID, h.cats["groceries"], h.account); err != nil {
		t.Fatal(err)
	}
	r := screensTRouter(t, pool, screensTNoon(2026, 11, 25), h.p)

	var b gen.BudgetMonth
	screensTGet(t, r, "/budgets", &b) // defaults to the current month: November (10 Nov – 9 Dec)
	per := b.Period
	screensTEq(t, "month", per.Month, "2026-11")
	screensTEq(t, "startsOn", per.StartsOn.String(), "2026-11-10")
	screensTEq(t, "endsBefore", per.EndsBefore.String(), "2026-12-10")
	screensTEq(t, "days", per.DaysInPeriod, 30)
	screensTEq(t, "daysLeft", per.DaysLeft, 15)
	screensTEq(t, "elapsed", per.Elapsed, 16.0/30)
	screensTEq(t, "today", per.Today.String(), "2026-11-25")
	tot := b.Totals
	screensTEq(t, "budget", tot.BudgetMinor, 210000)
	screensTEq(t, "spent", tot.SpentMinor, 165000)
	screensTEq(t, "left", tot.LeftMinor, 45000)
	screensTEq(t, "fixed", tot.FixedLimitMinor, 100000)
	screensTEq(t, "flex", tot.FlexLimitMinor, 110000)
	screensTEq(t, "flex spent", tot.FlexSpentMinor, 65000)
	screensTEqPtr(t, "perDay", tot.PerDayMinor, ptr(int64(3000)))
	screensTEqPtr(t, "underPace", tot.UnderPaceMinor, ptr(int64(-6333)))
	screensTNear(t, "paceMarker", tot.PaceMarker, 4760000.0/6300000)
	screensTEq(t, "status", tot.Status, gen.BudgetStatusAhead)

	screensTSlice(t, "flexible", screensTNames(b.Flexible), []string{"Eating Out", "Groceries"})
	eat := b.Flexible[0]
	screensTEq(t, "eating out", eat.Status, gen.BudgetStatusAhead)
	screensTEqPtr(t, "eating out scope", eat.Scope, ptr(gen.BudgetLineScopeSingleMonth))
	screensTNear(t, "eating out ratio", eat.UsedRatio, 0.7)
	screensTEq(t, "groceries", b.Flexible[1].Status, gen.BudgetStatusOnTrack)
	screensTEq(t, "groceries spent", b.Flexible[1].SpentMinor, 30000)
	screensTSlice(t, "fixed", screensTNames(b.Fixed), []string{"Housing & Bills"})
	screensTEq(t, "housing", b.Fixed[0].Status, gen.BudgetStatusOnTrack)
	screensTSlice(t, "unbudgeted", screensTNames(b.Unbudgeted), []string{"Transport", "Fun", "Shopping", "Education", "Other"})
	transport := b.Unbudgeted[0]
	if transport.SpentMinor != 5000 || transport.LimitMinor != nil || transport.Scope != nil || transport.UsedRatio != nil ||
		transport.LeftMinor != nil || transport.Status != gen.BudgetStatusOnTrack {
		t.Errorf("transport = %+v", transport)
	}
	if len(b.Segments) != 3 || b.Segments[0].Category.Name != "Housing & Bills" || b.Segments[1].Category.Name != "Groceries" ||
		b.Segments[2].AmountMinor != 35000 {
		t.Errorf("segments = %+v", b.Segments)
	}

	// October is over: no pace numbers.
	screensTGet(t, r, "/budgets?month=2026-10", &b)
	screensTEq(t, "past state", b.Period.State, gen.BudgetPeriodStatePast)
	screensTEq(t, "past elapsed", b.Period.Elapsed, 1.0)
	screensTEq(t, "past daysLeft", b.Period.DaysLeft, 0)
	screensTEq(t, "past budget", b.Totals.BudgetMinor, 210000)
	screensTEq(t, "past spent", b.Totals.SpentMinor, 9999)
	screensTEq(t, "past status", b.Totals.Status, gen.BudgetStatusOnTrack)
	if b.Totals.PerDayMinor != nil || b.Totals.UnderPaceMinor != nil || b.Totals.PaceMarker != nil {
		t.Errorf("past totals = %+v", b.Totals)
	}
	screensTEqPtr(t, "past eating out", screensTLine(t, b.Flexible, "Eating Out").LimitMinor, ptr(int64(30000)))

	// December: the override is gone, Transport still has no limit.
	screensTGet(t, r, "/budgets?month=2026-12", &b)
	screensTEq(t, "future state", b.Period.State, gen.BudgetPeriodStateFuture)
	screensTEq(t, "future elapsed", b.Period.Elapsed, 0.0)
	screensTEq(t, "future budget", b.Totals.BudgetMinor, 190000)
	screensTEq(t, "future spent", b.Totals.SpentMinor, 0)

	// Before any budget.
	screensTGet(t, r, "/budgets?month=2026-08", &b)
	screensTEq(t, "august hasBudget", b.HasBudget, false)
	screensTEq(t, "august unbudgeted", len(b.Unbudgeted), 8)

	if code, e := screensTDo(t, r, http.MethodGet, "/budgets?month=November", nil, nil); code != http.StatusBadRequest && code != http.StatusUnprocessableEntity {
		t.Errorf("bad month = %d %+v", code, e)
	}

	var months gen.MonthList
	screensTGet(t, r, "/months", &months)
	var got []string
	for _, it := range months.Items {
		got = append(got, it.Month)
	}
	screensTSlice(t, "months", got, []string{"2026-12", "2026-11", "2026-10", "2026-09", "2026-08"})
	screensTEq(t, "nov spent", months.Items[1].SpentMinor, 170000)
	screensTEqPtr(t, "nov budget", months.Items[1].BudgetMinor, ptr(int64(210000)))
	screensTEq(t, "oct spent", months.Items[2].SpentMinor, 9999)
	screensTEqPtr(t, "dec budget", months.Items[0].BudgetMinor, ptr(int64(190000)))
	screensTEqPtr(t, "sep budget", months.Items[3].BudgetMinor, ptr(int64(110000)))
	screensTEqPtr(t, "aug budget", months.Items[4].BudgetMinor, nil)
}

func TestScreensSetBudgets(t *testing.T) {
	pool := testdb.Pool(t)
	h := screensTNewHousehold(t, pool, 1, "2026-09-01")
	other := screensTNewHousehold(t, pool, 1, "2026-09-01")
	h.budget("groceries", "ongoing", "2026-09", ptr(int64(60000)))
	h.spend("2026-11-05", "groceries", 15000)
	r := screensTRouter(t, pool, screensTNoon(2026, 11, 18), h.p)

	put := func(month, scope string, items ...gen.BudgetLimitInput) gen.BudgetMonth {
		t.Helper()
		var out gen.BudgetMonth
		code, e := screensTDo(t, r, http.MethodPut, "/budgets",
			gen.SetBudgetsRequest{Month: month, Scope: gen.SetBudgetsRequestScope(scope), Items: items}, &out)
		if code != http.StatusOK {
			t.Fatalf("PUT /budgets %s %s = %d %+v", month, scope, code, e)
		}
		return out
	}
	item := func(key string, amount *int64) gen.BudgetLimitInput {
		return gen.BudgetLimitInput{CategoryId: h.cats[key], AmountMinor: amount}
	}
	limitOf := func(month, name string) (*int64, *gen.BudgetLineScope) {
		t.Helper()
		var b gen.BudgetMonth
		screensTGet(t, r, "/budgets?month="+month, &b)
		for _, ls := range [][]gen.BudgetLine{b.Flexible, b.Fixed, b.Unbudgeted} {
			for _, l := range ls {
				if l.Category.Name == name {
					return l.LimitMinor, l.Scope
				}
			}
		}
		t.Fatalf("no %s in %s", name, month)
		return nil, nil
	}

	// Ongoing from December; November keeps 600 lei. The response is December's month.
	b := put("2026-12", "ongoing", item("groceries", ptr(int64(70000))), item("fun", ptr(int64(20000))))
	screensTEq(t, "response month", b.Period.Month, "2026-12")
	screensTEq(t, "response budget", b.Totals.BudgetMinor, 90000)
	l, _ := limitOf("2026-11", "Groceries")
	screensTEqPtr(t, "november groceries", l, ptr(int64(60000)))
	l, _ = limitOf("2027-03", "Groceries")
	screensTEqPtr(t, "march groceries", l, ptr(int64(70000)))

	// Editing an existing ongoing row updates it in place.
	put("2026-09", "ongoing", item("groceries", ptr(int64(65000))))
	l, _ = limitOf("2026-10", "Groceries")
	screensTEqPtr(t, "october groceries", l, ptr(int64(65000)))

	// Single-month override, set twice (upsert), then removed.
	b = put("2026-11", "single_month", item("groceries", ptr(int64(45000))))
	screensTEqPtr(t, "override in response", screensTLine(t, b.Flexible, "Groceries").LimitMinor, ptr(int64(45000)))
	put("2026-11", "single_month", item("groceries", ptr(int64(46000))))
	l, sc := limitOf("2026-11", "Groceries")
	screensTEqPtr(t, "override", l, ptr(int64(46000)))
	screensTEqPtr(t, "override scope", sc, ptr(gen.BudgetLineScopeSingleMonth))
	put("2026-11", "single_month", item("groceries", nil))
	l, sc = limitOf("2026-11", "Groceries")
	screensTEqPtr(t, "override removed", l, ptr(int64(65000)))
	screensTEqPtr(t, "scope after removal", sc, ptr(gen.BudgetLineScopeOngoing))

	// Ongoing null removes the limit from November on; December's row still applies after it.
	b = put("2026-11", "ongoing", item("groceries", nil))
	g := screensTLine(t, b.Unbudgeted, "Groceries")
	screensTEq(t, "unbudgeted groceries spent", g.SpentMinor, 15000)
	l, _ = limitOf("2026-12", "Groceries")
	screensTEqPtr(t, "december groceries", l, ptr(int64(70000)))
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM budgets WHERE household_id = $1 AND deleted_at IS NULL`,
		h.p.HouseholdID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	screensTEq(t, "live budget rows", count, 4) // groceries Sep, Nov (null), Dec; fun Dec

	// Validation.
	cases := []struct {
		name  string
		body  gen.SetBudgetsRequest
		field string
		code  string
	}{
		{"income category", gen.SetBudgetsRequest{Month: "2026-11", Scope: "ongoing",
			Items: []gen.BudgetLimitInput{item("scholarship", ptr(int64(100)))}}, "items[0].categoryId", "not_expense"},
		{"another household's category", gen.SetBudgetsRequest{Month: "2026-11", Scope: "ongoing",
			Items: []gen.BudgetLimitInput{item("fun", ptr(int64(1))), {CategoryId: other.cats["fun"], AmountMinor: ptr(int64(100))}}},
			"items[1].categoryId", "not_found"},
		{"bad month", gen.SetBudgetsRequest{Month: "2026-13", Scope: "ongoing",
			Items: []gen.BudgetLimitInput{item("fun", ptr(int64(1)))}}, "month", "invalid_format"},
		{"bad scope", gen.SetBudgetsRequest{Month: "2026-11", Scope: "forever",
			Items: []gen.BudgetLimitInput{item("fun", ptr(int64(1)))}}, "scope", "invalid"},
		{"duplicate", gen.SetBudgetsRequest{Month: "2026-11", Scope: "ongoing",
			Items: []gen.BudgetLimitInput{item("fun", ptr(int64(1))), item("fun", ptr(int64(2)))}}, "items[1].categoryId", "duplicate"},
		{"negative", gen.SetBudgetsRequest{Month: "2026-11", Scope: "ongoing",
			Items: []gen.BudgetLimitInput{item("fun", ptr(int64(-1)))}}, "items[0].amountMinor", "invalid"},
	}
	for _, c := range cases {
		code, e := screensTDo(t, r, http.MethodPut, "/budgets", c.body, nil)
		if code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d %+v", c.name, code, e)
			continue
		}
		found := false
		for _, f := range deref(e.Fields) {
			found = found || (f.Field == c.field && f.Code == c.code)
		}
		if !found {
			t.Errorf("%s: fields %+v, want %s/%s", c.name, deref(e.Fields), c.field, c.code)
		}
	}
	// Nothing from the rejected requests was written.
	l, _ = limitOf("2026-11", "Fun")
	screensTEqPtr(t, "fun after rejected writes", l, nil)

	// An archived category can't get a new budget.
	if _, err := pool.Exec(context.Background(), `UPDATE categories SET archived_at = now() WHERE id = $1`, h.cats["other"]); err != nil {
		t.Fatal(err)
	}
	if code, _ := screensTDo(t, r, http.MethodPut, "/budgets", gen.SetBudgetsRequest{Month: "2026-11", Scope: "ongoing",
		Items: []gen.BudgetLimitInput{item("other", ptr(int64(5)))}}, nil); code != http.StatusUnprocessableEntity {
		t.Errorf("archived category: %d", code)
	}

	// The other household sees none of this.
	var ob gen.BudgetMonth
	screensTGet(t, screensTRouter(t, pool, screensTNoon(2026, 11, 18), other.p), "/budgets?month=2026-12", &ob)
	screensTEq(t, "other household budget", ob.HasBudget, false)
}

// ---------------------------------------------------------------- insights

func screensTInsightsHousehold(t *testing.T, pool *pgxpool.Pool) *screensTHousehold {
	h := screensTNewHousehold(t, pool, 1, "2026-06-01")
	h.budget("housing", "ongoing", "2026-09", ptr(int64(110000)))
	h.budget("groceries", "ongoing", "2026-09", ptr(int64(50000)))
	for _, s := range []struct {
		day, cat string
		amount   int64
	}{
		{"2026-07-02", "fun", 8000},
		{"2026-09-15", "groceries", 40000},
		{"2026-10-01", "housing", 100000},
		{"2026-10-05", "groceries", 20000},
		{"2026-10-10", "eating_out", 5000},
		{"2026-10-25", "groceries", 10000},
		{"2026-11-01", "housing", 100000},
		{"2026-11-03", "groceries", 10000},
		{"2026-11-09", "eating_out", 2000},
		{"2026-11-11", "groceries", 4000},
		{"2026-11-13", "fun", 9000},
		{"2026-11-16", "eating_out", 30000},
		{"2026-11-17", "groceries", 5000},
	} {
		h.spend(s.day, s.cat, s.amount)
	}
	h.spend("2026-11-18", "groceries", 99999, "pending")
	return h
}

func screensTBars(ins gen.Insights) []int64 {
	out := make([]int64, len(ins.Bars))
	for i, b := range ins.Bars {
		out[i] = b.SpentMinor
	}
	return out
}

func TestScreensInsights(t *testing.T) {
	pool := testdb.Pool(t)
	h := screensTInsightsHousehold(t, pool)
	r := screensTRouter(t, pool, screensTNoon(2026, 11, 18), h.p) // Wednesday

	get := func(query string) gen.Insights {
		t.Helper()
		var ins gen.Insights
		code, e := screensTDo(t, r, http.MethodGet, "/insights"+query, nil, &ins)
		if code != http.StatusOK {
			t.Fatalf("GET /insights%s = %d %+v", query, code, e)
		}
		return ins
	}

	t.Run("six months", func(t *testing.T) {
		ins := get("")
		screensTEq(t, "range", ins.StartsOn.String()+" "+ins.EndsBefore.String(), "2026-06-01 2026-12-01")
		screensTSlice(t, "bars", screensTBars(ins), []int64{0, 8000, 0, 40000, 135000, 160000})
		screensTEq(t, "current", ins.Bars[5].IsCurrent && !ins.Bars[4].IsCurrent, true)
		screensTEqPtr(t, "projection", ins.Bars[5].ProjectedMinor, ptr(int64(210000))) // 1.100 + 600 × 30/18
		screensTEqPtr(t, "no projection on past bars", ins.Bars[4].ProjectedMinor, nil)
		screensTEqPtr(t, "average", ins.AverageMinor, ptr(int64(61000)))
		screensTEq(t, "headline current", ins.Headline.CurrentMinor, 160000)
		screensTEqPtr(t, "headline previous", ins.Headline.PreviousMinor, ptr(int64(125000)))
		screensTNear(t, "headline change", ins.Headline.ChangeRatio, 0.28)
		screensTEq(t, "comparedTo", ins.Headline.ComparedTo.String(), "2026-10-01")
		var cats []string
		var amounts []int64
		for _, c := range ins.ByCategory {
			cats = append(cats, c.Category.Name)
			amounts = append(amounts, c.SpentMinor)
		}
		screensTSlice(t, "by category", cats, []string{"Housing & Bills", "Groceries", "Eating Out", "Fun"})
		screensTSlice(t, "by category amounts", amounts, []int64{200000, 89000, 37000, 17000})
		screensTEq(t, "share", ins.ByCategory[0].Share, 200000.0/343000)
		ch := ins.BiggestChange
		if ch == nil {
			t.Fatal("no biggest change")
		}
		screensTEq(t, "change category", ch.Category.Name, "Eating Out")
		screensTEq(t, "change current", ch.CurrentMinor, 32000)
		screensTEq(t, "change previous", ch.PreviousMinor, 5000)
		screensTEq(t, "change ratio", ch.ChangeRatio, 5.4)
		screensTSlice(t, "spark", ch.Spark, []int64{0, 0, 0, 0, 5000, 32000})
		d := ins.BiggestDay
		if d == nil || d.Date.String() != "2026-11-01" || d.SpentMinor != 100000 || len(d.TopCategories) != 1 ||
			d.TopCategories[0].Name != "Housing & Bills" {
			t.Errorf("biggest day = %+v", d)
		}
	})

	t.Run("week", func(t *testing.T) {
		ins := get("?period=week")
		screensTEq(t, "range", ins.StartsOn.String()+" "+ins.EndsBefore.String(), "2026-11-16 2026-11-23")
		screensTSlice(t, "bars", screensTBars(ins), []int64{30000, 5000, 0, 0, 0, 0, 0})
		screensTEq(t, "current", ins.Bars[2].IsCurrent, true)
		for _, b := range ins.Bars {
			if b.ProjectedMinor != nil {
				t.Errorf("week bar with projection %+v", b)
			}
		}
		screensTEqPtr(t, "average", ins.AverageMinor, ptr(int64(17500)))
		screensTEq(t, "headline current", ins.Headline.CurrentMinor, 35000)
		screensTEqPtr(t, "headline previous", ins.Headline.PreviousMinor, ptr(int64(6000)))
		screensTNear(t, "headline change", ins.Headline.ChangeRatio, 29000.0/6000)
		screensTEq(t, "comparedTo", ins.Headline.ComparedTo.String(), "2026-11-09")
		if ch := ins.BiggestChange; ch == nil || ch.Category.Name != "Eating Out" || ch.CurrentMinor != 30000 ||
			ch.PreviousMinor != 2000 || ch.ChangeRatio != 14 || len(ch.Spark) != 7 || ch.Spark[0] != 30000 {
			t.Errorf("biggest change = %+v", ch)
		}
		if d := ins.BiggestDay; d == nil || d.Date.String() != "2026-11-16" || d.SpentMinor != 30000 {
			t.Errorf("biggest day = %+v", d)
		}
	})

	t.Run("month", func(t *testing.T) {
		ins := get("?period=month")
		screensTEq(t, "bars", len(ins.Bars), 30)
		screensTEq(t, "current", ins.Bars[17].IsCurrent, true)
		screensTEq(t, "first day", ins.Bars[0].SpentMinor, 100000)
		screensTEqPtr(t, "no projection on daily bars", ins.Bars[17].ProjectedMinor, nil)
		screensTEqPtr(t, "average", ins.AverageMinor, ptr(int64(22857))) // 1.600 / 7 days with spending
		screensTEq(t, "headline current", ins.Headline.CurrentMinor, 160000)
		screensTEqPtr(t, "headline previous", ins.Headline.PreviousMinor, ptr(int64(125000)))
	})

	t.Run("year", func(t *testing.T) {
		ins := get("?period=year")
		screensTEq(t, "range", ins.StartsOn.String()+" "+ins.EndsBefore.String(), "2025-12-01 2026-12-01")
		screensTEq(t, "bars", len(ins.Bars), 12)
		screensTEq(t, "current", ins.Bars[11].IsCurrent, true)
		screensTEqPtr(t, "average", ins.AverageMinor, ptr(int64(61000)))
	})

	t.Run("one category", func(t *testing.T) {
		ins := get("?categoryId=" + h.cats["groceries"].String())
		screensTSlice(t, "bars", screensTBars(ins), []int64{0, 0, 0, 40000, 30000, 19000})
		screensTEqPtr(t, "average", ins.AverageMinor, ptr(int64(35000)))
		screensTEqPtr(t, "projection", ins.Bars[5].ProjectedMinor, ptr(int64(31667))) // 190 × 30/18
		screensTEq(t, "headline current", ins.Headline.CurrentMinor, 19000)
		screensTEqPtr(t, "headline previous", ins.Headline.PreviousMinor, ptr(int64(20000)))
		screensTNear(t, "headline change", ins.Headline.ChangeRatio, -0.05)
		if len(ins.ByCategory) != 1 || ins.ByCategory[0].Share != 1 {
			t.Errorf("by category = %+v", ins.ByCategory)
		}
		if ins.BiggestChange != nil {
			t.Errorf("biggest change = %+v", ins.BiggestChange)
		}
	})

	t.Run("errors", func(t *testing.T) {
		other := screensTNewHousehold(t, pool, 1, "2026-06-01")
		for _, id := range []uuid.UUID{other.cats["groceries"], h.cats["scholarship"], uuid.Must(uuid.NewV7())} {
			code, e := screensTDo(t, r, http.MethodGet, "/insights?categoryId="+id.String(), nil, nil)
			if code != http.StatusNotFound {
				t.Errorf("categoryId %s: %d %+v", id, code, e)
			}
		}
		if code, _ := screensTDo(t, r, http.MethodGet, "/insights?period=decade", nil, nil); code != http.StatusBadRequest &&
			code != http.StatusUnprocessableEntity {
			t.Errorf("bad period: %d", code)
		}
	})
}

// A household with no spending at all.
func TestScreensInsightsEmpty(t *testing.T) {
	pool := testdb.Pool(t)
	h := screensTNewHousehold(t, pool, 1, "2026-11-01")
	r := screensTRouter(t, pool, screensTNoon(2026, 11, 18), h.p)
	var ins gen.Insights
	code, e := screensTDo(t, r, http.MethodGet, "/insights", nil, &ins)
	if code != http.StatusOK {
		t.Fatalf("GET /insights = %d %+v", code, e)
	}
	if ins.AverageMinor != nil || ins.Headline.PreviousMinor != nil || ins.Headline.ChangeRatio != nil ||
		ins.BiggestChange != nil || ins.BiggestDay != nil || len(ins.ByCategory) != 0 || ins.Subscriptions.Next != nil {
		t.Errorf("empty insights = %+v", ins)
	}
	screensTEqPtr(t, "projection with nothing spent", ins.Bars[5].ProjectedMinor, ptr(int64(0)))
}

func TestScreensHome(t *testing.T) {
	pool := testdb.Pool(t)
	h := screensTNewHousehold(t, pool, 1, "2026-11-01")
	h.budget("groceries", "ongoing", "2026-11", ptr(int64(10000)))
	h.budget("housing", "ongoing", "2026-11", ptr(int64(10000)))
	h.budget("fun", "ongoing", "2026-11", ptr(int64(0)))
	h.spend("2026-11-02", "groceries", 5000)
	h.spend("2026-11-03", "housing", 9000)
	h.spend("2026-11-04", "groceries", 4000, "pending") // waiting for confirmation: not spent
	r := screensTRouter(t, pool, screensTNoon(2026, 11, 18), h.p)

	var home gen.Home
	code, e := screensTDo(t, r, http.MethodGet, "/home", nil, &home)
	if code != http.StatusOK {
		t.Fatalf("GET /home = %d %+v", code, e)
	}
	screensTSlice(t, "attention", screensTNames(home.Attention), []string{"Housing & Bills", "Groceries", "Fun"})
	screensTEq(t, "spent", home.Budget.Totals.SpentMinor, 14000)
	screensTEq(t, "pending count", home.PendingCount, len(home.Pending))
	screensTEq(t, "recent", len(home.Recent) <= 6, true)
	screensTEq(t, "upcoming", len(home.Upcoming), 0)
}
