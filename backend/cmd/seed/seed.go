package main

import (
	"cmp"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/jobs"
	"github.com/andreipana03/budget-tracker/backend/internal/signup"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// The admin-test account.
const (
	adminEmail       = "admin-test@budget-tracker.test"
	adminUsername    = "admin-test"
	adminPassword    = "AdminTest@123"
	adminDisplayName = "Admin Test"
)

var bucharest = func() *time.Location {
	loc, err := time.LoadLocation("Europe/Bucharest")
	if err != nil {
		panic(err)
	}
	return loc
}()

// Options for one seed run.
type Options struct {
	// Today is the last day of the history (a calendar day, midnight UTC).
	Today time.Time
	// Now is the real time; today's transactions are never later than it.
	Now time.Time
	// Offline skips BNR and uses sample rates.
	Offline    bool
	BNRBaseURL string
	HTTPClient *http.Client
	Logger     *slog.Logger
}

// Line is one budgeted category of the current month.
type Line struct {
	Key    string
	Limit  int64
	Spent  int64
	Fixed  bool
	Status budget.Status
}

// Summary is what the seed created.
type Summary struct {
	UserID      uuid.UUID
	HouseholdID uuid.UUID
	Today       time.Time
	First       budget.Month
	Rates       string
	Counts      store.SeedCountsRow
	Balances    []store.SeedAccountBalancesRow
	Month       budget.Month
	Clock       budget.Clock
	Lines       []Line
	Totals      budget.Totals
	Warnings    []string
}

// Run recreates the admin-test user with six months of data ending on o.Today.
func Run(ctx context.Context, pool *pgxpool.Pool, o Options) (Summary, error) {
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	if o.Now.IsZero() {
		o.Now = time.Now()
	}
	today := budget.DayOf(o.Today)
	p := buildPlan(today)
	s := Summary{Today: today, First: p.first, Month: p.cur, Warnings: p.warnings}

	// Rates first (committed on their own): real BNR rates when online, else samples.
	ratesFrom := p.first.First().AddDate(0, 0, -10)
	s.Rates = "sample"
	if !o.Offline {
		// The yearly files cover ~400 days anyway; store all of them, like the job's backfill.
		from := today.AddDate(0, 0, -400)
		if ratesFrom.Before(from) {
			from = ratesFrom
		}
		n, err := jobs.BackfillRates(ctx, pool, o.HTTPClient, o.BNRBaseURL, from, today)
		if err != nil {
			o.Logger.Warn("BNR backfill failed; using sample rates", "error", err)
		} else {
			s.Rates = fmt.Sprintf("BNR (%d rows)", n)
		}
	}

	hash, err := auth.HashPassword(adminPassword)
	if err != nil {
		return s, err
	}

	err = dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		if s.Rates == "sample" {
			n, err := sampleRates(ctx, q, ratesFrom, today)
			if err != nil {
				return fmt.Errorf("sample rates: %w", err)
			}
			s.Rates = fmt.Sprintf("sample (%d new rows)", n)
		}
		return seed(ctx, tx, q, p, o, hash, &s)
	})
	return s, err
}

func seed(ctx context.Context, tx pgx.Tx, q *store.Queries, p *plan, o Options, hash string, s *Summary) error {
	// Deleting the user removes the household and everything in it.
	if _, err := q.SeedDeleteUser(ctx, store.SeedDeleteUserParams{Username: adminUsername, Email: adminEmail}); err != nil {
		return fmt.Errorf("delete admin-test: %w", err)
	}
	username, name := adminUsername, adminDisplayName
	res, err := signup.Create(ctx, tx, signup.Params{
		Email: adminEmail, Username: &username, PasswordHash: &hash, DisplayName: &name, EmailVerified: true, Now: o.Now,
	})
	if err != nil {
		return err
	}
	s.UserID, s.HouseholdID = res.UserID, res.HouseholdID
	hh, user := res.HouseholdID, &res.UserID
	start := p.first.First()

	// Accounts: signup's "Cash" account becomes the ING card; Cash and Revolut are new.
	accounts := map[string]uuid.UUID{acctING: res.AccountID}
	if err := q.SeedSetupAccount(ctx, store.SeedSetupAccountParams{
		ID: res.AccountID, Name: "ING Card", Type: store.AccountTypeBank, Currency: "RON", OpeningBalanceOn: start, SortOrder: 10,
	}); err != nil {
		return fmt.Errorf("set up ING Card: %w", err)
	}
	for _, a := range []struct {
		key, name, currency string
		typ                 store.AccountType
		order               int32
	}{
		{acctCash, "Cash", "RON", store.AccountTypeCash, 20},
		{acctRevolut, "Revolut", "EUR", store.AccountTypeBank, 30},
	} {
		id, err := q.SeedInsertAccount(ctx, store.SeedInsertAccountParams{
			HouseholdID: hh, Name: a.name, Type: a.typ, Currency: a.currency, OpeningBalanceOn: start, SortOrder: a.order, CreatedBy: user,
		})
		if err != nil {
			return fmt.Errorf("insert account %s: %w", a.name, err)
		}
		accounts[a.key] = id
	}

	cats, err := q.SeedCategories(ctx, hh)
	if err != nil {
		return err
	}
	category := map[string]uuid.UUID{}
	for _, c := range cats {
		category[*c.SystemKey] = c.ID
	}

	for _, b := range p.budgets {
		amount := b.amount
		if err := q.SeedInsertBudget(ctx, store.SeedInsertBudgetParams{
			HouseholdID: hh, CategoryID: category[b.cat], Scope: b.scope, Month: b.month.First(), AmountMinor: &amount, CreatedBy: user,
		}); err != nil {
			return fmt.Errorf("insert budget: %w", err)
		}
	}

	subIDs := make([]uuid.UUID, len(p.subs))
	for i, sub := range p.subs {
		id, err := q.SeedInsertSubscription(ctx, store.SeedInsertSubscriptionParams{
			HouseholdID: hh, Kind: sub.kind, Title: sub.title, Note: optional(sub.note), AmountMinor: sub.amount,
			Currency: sub.currency, AccountID: accounts[sub.acct], CategoryID: category[sub.cat],
			Frequency: store.RecurrenceFrequency(sub.freq), StartsOn: sub.startsOn, NextDueOn: sub.nextDue, CreatedBy: user,
		})
		if err != nil {
			return fmt.Errorf("insert subscription %s: %w", sub.title, err)
		}
		subIDs[i] = id
	}

	// Transactions in time order, so ids and row versions follow the story.
	txns := slices.Clone(p.txns)
	slices.SortStableFunc(txns, func(a, b txn) int {
		return cmp.Or(a.day.Compare(b.day), cmp.Compare(a.hour, b.hour), cmp.Compare(a.minute, b.minute))
	})
	for _, x := range txns {
		at := occurredAt(x.day, x.hour, x.minute, o.Now)
		in := store.SeedInsertTransactionParams{
			HouseholdID: hh, Kind: x.kind, Status: x.status, Title: x.title, Note: optional(x.note),
			OccurredOn: x.day, OccurredAt: &at, CategoryID: category[x.cat], AccountID: accounts[x.acct],
			AmountMinor: x.amount, Currency: x.currency, CreatedBy: user,
		}
		if x.sub > 0 {
			id, day := subIDs[x.sub-1], x.day
			in.RecurringID, in.RecurringOccurrenceOn = &id, &day
		}
		if _, err := q.SeedInsertTransaction(ctx, in); err != nil {
			return fmt.Errorf("insert %s on %s: %w", x.title, x.day.Format(time.DateOnly), err)
		}
	}
	for _, t := range p.transfers {
		at := occurredAt(t.day, t.hour, 30, o.Now)
		if err := q.SeedInsertTransfer(ctx, store.SeedInsertTransferParams{
			HouseholdID: hh, FromAccountID: accounts[t.from], ToAccountID: accounts[t.to], FromAmountMinor: t.amount,
			OccurredOn: t.day, OccurredAt: &at, Note: optional(t.note), CreatedBy: user,
		}); err != nil {
			return fmt.Errorf("insert transfer: %w", err)
		}
	}

	// Opening balances (on the first day of the history) chosen so today's balances
	// land on the targets.
	balances, err := q.SeedAccountBalances(ctx, hh)
	if err != nil {
		return err
	}
	for _, key := range []string{acctING, acctCash, acctRevolut} {
		id := accounts[key]
		for _, b := range balances {
			if b.ID != id {
				continue
			}
			opening := p.balanceTargets[key] - b.BalanceMinor
			if opening < 0 {
				s.Warnings = append(s.Warnings, fmt.Sprintf("%s: history spends more than the target balance; opening balance 0", b.Name))
				opening = 0
			}
			if err := q.SeedSetOpeningBalance(ctx, store.SeedSetOpeningBalanceParams{ID: id, OpeningBalanceMinor: opening}); err != nil {
				return err
			}
		}
	}
	if s.Balances, err = q.SeedAccountBalances(ctx, hh); err != nil {
		return err
	}
	if s.Counts, err = q.SeedCounts(ctx, hh); err != nil {
		return err
	}
	return currentMonth(ctx, q, p, s)
}

// currentMonth reads the month's budget lines back from the database and computes
// the statuses with package budget, exactly as the API does.
func currentMonth(ctx context.Context, q *store.Queries, p *plan, s *Summary) error {
	period := budget.PeriodOf(p.cur, 1)
	s.Clock = budget.ClockOf(period, p.today)
	rows, err := q.SeedBudgetLines(ctx, store.SeedBudgetLinesParams{
		HouseholdID: s.HouseholdID, Month: p.cur.First(), StartsOn: period.Start, EndsBefore: period.EndBefore,
	})
	if err != nil {
		return err
	}
	var lines []budget.Line
	for _, r := range rows {
		if r.LimitMinor == nil {
			continue
		}
		l := budget.Line{Limit: r.LimitMinor, Spent: r.SpentMinor, Fixed: r.IsFixed, SortOrder: int(r.SortOrder)}
		lines = append(lines, l)
		s.Lines = append(s.Lines, Line{Key: deref(r.SystemKey), Limit: *r.LimitMinor, Spent: r.SpentMinor, Fixed: r.IsFixed, Status: l.Status(s.Clock)})
	}
	s.Totals = budget.ComputeTotals(lines, s.Clock, 2)

	// Check the plan held: the categories first, the total when it was possible.
	want := map[string]budget.Status{catEatingOut: budget.StatusOver, catShopping: budget.StatusAhead}
	for _, l := range s.Lines {
		w, ok := want[l.Key]
		if !ok {
			w = budget.StatusOnTrack
		}
		if l.Status != w && !(l.Key == catShopping && len(p.warnings) > 0) {
			s.Warnings = append(s.Warnings, fmt.Sprintf("%s is %s, planned %s", l.Key, l.Status, w))
		}
	}
	if p.expectTotalOnTrack && s.Totals.Status != budget.StatusOnTrack {
		s.Warnings = append(s.Warnings, fmt.Sprintf("the month total is %s, planned on track", s.Totals.Status))
	}
	return nil
}

// occurredAt is the moment of a transaction in Bucharest, never after now. Today's
// times are squeezed into the part of the day that has passed (from 07:00, or from
// midnight early in the morning), keeping their order.
func occurredAt(day time.Time, hour, minute int, now time.Time) time.Time {
	at := time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, bucharest)
	if !at.After(now) {
		return at
	}
	from := time.Date(day.Year(), day.Month(), day.Day(), 7, 0, 0, 0, bucharest)
	if !from.Before(now) {
		from = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, bucharest)
	}
	dayEnd := time.Date(day.Year(), day.Month(), day.Day(), 23, 59, 0, 0, bucharest)
	frac := float64(max(at.Sub(from), 0)) / float64(dayEnd.Sub(from))
	return from.Add(time.Duration(frac * float64(now.Sub(from)))).Truncate(time.Minute)
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
