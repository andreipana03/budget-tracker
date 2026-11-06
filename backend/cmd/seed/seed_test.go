package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

// The only test that touches the admin-test user. Dates are in 2030–2031 so the
// sample rates it inserts don't meet other tests' rates (1990, 2033).

type seedCounts struct {
	transactions, pending, transfers, subscriptions, budgets, accounts int64
	homeSum                                                            int64
}

func countSeed(t *testing.T, pool *pgxpool.Pool) seedCounts {
	t.Helper()
	var c seedCounts
	err := pool.QueryRow(context.Background(), `
		SELECT (SELECT count(*) FROM transactions t WHERE t.household_id = m.household_id),
		       (SELECT count(*) FROM transactions t WHERE t.household_id = m.household_id AND t.status = 'pending'),
		       (SELECT count(*) FROM transfers t WHERE t.household_id = m.household_id),
		       (SELECT count(*) FROM recurring_transactions r WHERE r.household_id = m.household_id),
		       (SELECT count(*) FROM budgets b WHERE b.household_id = m.household_id),
		       (SELECT count(*) FROM accounts a WHERE a.household_id = m.household_id),
		       (SELECT coalesce(sum(home_amount_minor), 0) FROM transactions t WHERE t.household_id = m.household_id)::bigint
		  FROM users u JOIN household_members m ON m.user_id = u.id
		 WHERE u.username = 'admin-test'`).Scan(&c.transactions, &c.pending, &c.transfers, &c.subscriptions, &c.budgets, &c.accounts, &c.homeSum)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	return c
}

func runSeed(t *testing.T, pool *pgxpool.Pool, today time.Time) Summary {
	t.Helper()
	s, err := Run(context.Background(), pool, Options{
		Today: today, Now: today.AddDate(1, 0, 0), Offline: true,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("seed %s: %v", today.Format(time.DateOnly), err)
	}
	return s
}

// statuses computes the current month's statuses straight from SQL (the budget
// query of db/examples/screens.sql #1) and package budget.
func statuses(t *testing.T, pool *pgxpool.Pool, today time.Time) (map[string]budget.Status, budget.Totals) {
	t.Helper()
	m := budget.CalendarMonth(today)
	period := budget.PeriodOf(m, 1)
	clock := budget.ClockOf(period, today)
	rows, err := pool.Query(context.Background(), `
		WITH hh AS (SELECT m.household_id FROM users u JOIN household_members m ON m.user_id = u.id WHERE u.username = 'admin-test')
		SELECT c.system_key, c.is_fixed,
		       coalesce(single.amount_minor, ongoing.amount_minor) AS limit_minor,
		       coalesce((SELECT sum(t.home_amount_minor) FROM transactions t
		                  WHERE t.category_id = c.id AND t.kind = 'expense' AND t.status = 'posted' AND t.deleted_at IS NULL
		                    AND t.occurred_on >= $2 AND t.occurred_on < $3), 0)::bigint
		  FROM categories c
		  JOIN hh ON hh.household_id = c.household_id
		  LEFT JOIN LATERAL (SELECT b.amount_minor FROM budgets b WHERE b.category_id = c.id AND b.scope = 'single_month'
		                        AND b.month = $1 AND b.deleted_at IS NULL) single ON true
		  LEFT JOIN LATERAL (SELECT b.amount_minor FROM budgets b WHERE b.category_id = c.id AND b.scope = 'ongoing'
		                        AND b.month <= $1 AND b.deleted_at IS NULL ORDER BY b.month DESC LIMIT 1) ongoing ON true
		 WHERE c.kind = 'expense' AND c.deleted_at IS NULL`, m.First(), period.Start, period.EndBefore)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]budget.Status{}
	var lines []budget.Line
	for rows.Next() {
		var key string
		var fixed bool
		var limit *int64
		var spent int64
		if err := rows.Scan(&key, &fixed, &limit, &spent); err != nil {
			t.Fatal(err)
		}
		if limit == nil {
			continue
		}
		l := budget.Line{Limit: limit, Spent: spent, Fixed: fixed}
		out[key] = l.Status(clock)
		lines = append(lines, l)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out, budget.ComputeTotals(lines, clock, 2)
}

func TestSeed(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE username = 'admin-test' OR email = 'admin-test@budget-tracker.test'`)
		_, _ = pool.Exec(context.Background(), `DELETE FROM fx_rates WHERE rate_date BETWEEN '2030-07-01' AND '2031-05-31'`)
	})

	today := budget.Date(2031, time.March, 18)
	s := runSeed(t, pool, today)
	if testing.Verbose() {
		printSummary(os.Stdout, s)
	}

	// The user: verified, username admin-test, and the password works.
	var username, hash string
	var verified *time.Time
	if err := pool.QueryRow(ctx, `SELECT username, password_hash, email_verified_at FROM users WHERE email = $1`, adminEmail).
		Scan(&username, &hash, &verified); err != nil {
		t.Fatalf("admin-test user: %v", err)
	}
	if ok, err := auth.VerifyPassword("AdminTest@123", hash); err != nil || !ok {
		t.Errorf("password AdminTest@123 doesn't verify: %v", err)
	}
	if username != "admin-test" || verified == nil {
		t.Errorf("username %q, verified %v", username, verified)
	}

	// Current month: Eating Out over, Shopping ahead, the rest and the total on track.
	got, totals := statuses(t, pool, today)
	for key, want := range map[string]budget.Status{
		"eating_out": budget.StatusOver, "shopping": budget.StatusAhead, "groceries": budget.StatusOnTrack,
		"housing": budget.StatusOnTrack, "transport": budget.StatusOnTrack, "fun": budget.StatusOnTrack,
		"education": budget.StatusOnTrack, "other": budget.StatusOnTrack,
	} {
		if got[key] != want {
			t.Errorf("%s: %s, want %s", key, got[key], want)
		}
	}
	if totals.Budget != 200000 || totals.Status != budget.StatusOnTrack {
		t.Errorf("total: budget %d, status %s; want 200000 on track", totals.Budget, totals.Status)
	}
	if len(s.Warnings) > 0 {
		t.Errorf("warnings: %v", s.Warnings)
	}

	c := countSeed(t, pool)
	if c.pending != 1 {
		t.Errorf("pending transactions: %d, want 1", c.pending)
	}
	var pendingOn time.Time
	if err := pool.QueryRow(ctx, `
		SELECT t.occurred_on FROM transactions t JOIN household_members m USING (household_id)
		  JOIN users u ON u.id = m.user_id
		 WHERE u.username = 'admin-test' AND t.status = 'pending' AND t.recurring_id IS NOT NULL
		   AND t.recurring_occurrence_on = t.occurred_on`).Scan(&pendingOn); err != nil {
		t.Fatalf("pending occurrence: %v", err)
	}
	if !pendingOn.Equal(today.AddDate(0, 0, -1)) && !pendingOn.Equal(today) {
		t.Errorf("pending on %s, want yesterday or today", pendingOn.Format(time.DateOnly))
	}

	// Subscriptions: ≥ 2 expense charges in the next 7 days; every subscription is due
	// after today, has posted occurrences, and its next date is the next occurrence.
	var dueSoon, behind, withoutHistory int
	if err := pool.QueryRow(ctx, `
		WITH r AS (SELECT r.* FROM recurring_transactions r JOIN household_members m USING (household_id)
		             JOIN users u ON u.id = m.user_id WHERE u.username = 'admin-test')
		SELECT (SELECT count(*) FROM r WHERE kind = 'expense' AND next_due_on > $1 AND next_due_on <= $1::date + 7),
		       (SELECT count(*) FROM r WHERE next_due_on <= $1),
		       (SELECT count(*) FROM r WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.recurring_id = r.id AND t.status = 'posted'))`,
		today).Scan(&dueSoon, &behind, &withoutHistory); err != nil {
		t.Fatal(err)
	}
	if dueSoon < 2 || behind != 0 || withoutHistory != 0 {
		t.Errorf("subscriptions: %d due within 7 days (want ≥ 2), %d not advanced, %d without posted history", dueSoon, behind, withoutHistory)
	}

	// Six budget months of history, nothing after today, amounts frozen like the API.
	var months, future, badFreeze int
	if err := pool.QueryRow(ctx, `
		WITH t AS (SELECT t.* FROM transactions t JOIN household_members m USING (household_id)
		             JOIN users u ON u.id = m.user_id WHERE u.username = 'admin-test')
		SELECT (SELECT count(DISTINCT date_trunc('month', occurred_on)) FROM t),
		       (SELECT count(*) FROM t WHERE occurred_on > $1 OR occurred_on < $2),
		       (SELECT count(*) FROM t LEFT JOIN LATERAL fx_quote(t.currency, t.home_currency, t.occurred_on) q ON true
		         WHERE t.home_amount_minor <> fx_convert_minor(t.amount_minor, t.currency, t.home_currency, t.occurred_on)
		            OR t.account_amount_minor <> fx_convert_minor(t.amount_minor, t.currency, t.account_currency, t.occurred_on)
		            OR t.fx_rate <> q.rate OR t.fx_rate_date IS DISTINCT FROM q.rate_date
		            OR t.created_by IS NULL)`,
		today, budget.Date(2030, time.October, 1)).Scan(&months, &future, &badFreeze); err != nil {
		t.Fatal(err)
	}
	if months != 6 || future != 0 || badFreeze != 0 {
		t.Errorf("history: %d months (want 6), %d outside Oct 2030 – today, %d with wrong frozen amounts", months, future, badFreeze)
	}

	// Balances near ING ≈ 2.100 lei, Cash ≈ 180 lei, Revolut ≈ 300 €, all openings ≥ 0.
	want := map[string][2]int64{"ING Card": {200000, 220000}, "Cash": {15000, 21000}, "Revolut": {27000, 33000}}
	for _, b := range s.Balances {
		r, ok := want[b.Name]
		if !ok || b.BalanceMinor < r[0] || b.BalanceMinor > r[1] || b.OpeningBalanceMinor < 0 {
			t.Errorf("account %s: balance %d (opening %d)", b.Name, b.BalanceMinor, b.OpeningBalanceMinor)
		}
	}
	if len(s.Balances) != 3 {
		t.Errorf("accounts: %d, want 3", len(s.Balances))
	}

	// Running it again gives the same data.
	runSeed(t, pool, today)
	if again := countSeed(t, pool); again != c {
		t.Errorf("second run: %+v, first %+v", again, c)
	}
}

// Early and late in a month the plan can't satisfy everything; the seed still
// works, keeps the categories' story and says what it couldn't do.
func TestSeedEdgesOfMonth(t *testing.T) {
	pool := testdb.Pool(t)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE username = 'admin-test' OR email = 'admin-test@budget-tracker.test'`)
		_, _ = pool.Exec(context.Background(), `DELETE FROM fx_rates WHERE rate_date BETWEEN '2030-07-01' AND '2031-05-31'`)
	})
	for _, today := range []time.Time{budget.Date(2031, time.April, 1), budget.Date(2031, time.April, 3), budget.Date(2031, time.April, 12), budget.Date(2031, time.April, 30)} {
		s := runSeed(t, pool, today)
		got, totals := statuses(t, pool, today)
		if got["eating_out"] != budget.StatusOver {
			t.Errorf("%s: eating out %s", today.Format(time.DateOnly), got["eating_out"])
		}
		for _, key := range []string{"groceries", "housing", "transport", "fun", "education", "other"} {
			if got[key] != budget.StatusOnTrack {
				t.Errorf("%s: %s %s", today.Format(time.DateOnly), key, got[key])
			}
		}
		if today.Day() == 12 && (got["shopping"] != budget.StatusAhead || totals.Status != budget.StatusOnTrack) {
			t.Errorf("%s: shopping %s, total %s", today.Format(time.DateOnly), got["shopping"], totals.Status)
		}
		if today.Day() <= 3 && (got["shopping"] != budget.StatusAhead || len(s.Warnings) == 0) {
			t.Errorf("%s: shopping %s, warnings %v", today.Format(time.DateOnly), got["shopping"], s.Warnings)
		}
		if c := countSeed(t, pool); c.pending != 1 {
			t.Errorf("%s: %d pending", today.Format(time.DateOnly), c.pending)
		}
	}
}
