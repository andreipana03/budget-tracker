// Command seed creates the admin-test account with six budget months of realistic
// demo data ending today (Europe/Bucharest). Run it with `make db-seed` (after
// `make migrate`); it is safe to run again. Never in production.
//
//	admin-test@budget-tracker.test (username admin-test) / AdminTest@123
//
// Flags: -today YYYY-MM-DD to end the history on another day, -offline to skip BNR
// and use sample exchange rates.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/budget"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(os.Args[1:], logger, os.Stdout); err != nil {
		logger.Error("seed failed", "error", err)
		os.Exit(1)
	}
}

func run(args []string, logger *slog.Logger, out io.Writer) error {
	fs := flag.NewFlagSet("seed", flag.ContinueOnError)
	todayFlag := fs.String("today", "", "last day of the history, YYYY-MM-DD (default: today in Europe/Bucharest)")
	offline := fs.Bool("offline", false, "don't fetch BNR rates; insert sample rates instead")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if env := strings.TrimSpace(os.Getenv("APP_ENV")); env == "production" {
		return errors.New("refusing to seed demo data with APP_ENV=production")
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	now := time.Now()
	today := budget.Today(now, bucharest)
	if *todayFlag != "" {
		t, err := time.Parse(time.DateOnly, *todayFlag)
		if err != nil {
			return fmt.Errorf("-today: want YYYY-MM-DD, got %q", *todayFlag)
		}
		today = t
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()

	s, err := Run(ctx, pool, Options{
		Today: today, Now: now, Offline: *offline, BNRBaseURL: os.Getenv("BNR_BASE_URL"), Logger: logger,
	})
	if err != nil {
		return err
	}
	printSummary(out, s)
	return nil
}

func printSummary(w io.Writer, s Summary) {
	lei := func(minor int64) string { return money(minor) + " lei" }
	fmt.Fprintf(w, "\nadmin-test seeded: %s / %s (username %s)\n", adminEmail, adminPassword, adminUsername)
	fmt.Fprintf(w, "  history:       %s → %s (budget months %s … %s)\n", s.First.First().Format(time.DateOnly),
		s.Today.Format(time.DateOnly), s.First, s.Month)
	fmt.Fprintf(w, "  rates:         %s\n", s.Rates)
	fmt.Fprintf(w, "  transactions:  %d posted, %d pending · %d transfers · %d subscriptions · %d budget rows\n",
		s.Counts.Posted, s.Counts.Pending, s.Counts.Transfers, s.Counts.Subscriptions, s.Counts.Budgets)
	fmt.Fprintf(w, "  balances:     ")
	for _, b := range s.Balances {
		unit := "lei"
		if b.Currency != "RON" {
			unit = b.Currency
		}
		fmt.Fprintf(w, " %s %s %s (opening %s) ·", b.Name, money(b.BalanceMinor), unit, money(b.OpeningBalanceMinor))
	}
	fmt.Fprintln(w)
	c := s.Clock
	fmt.Fprintf(w, "  %s, day %d of %d: budget %s · spent %s · left %s · total %s\n", s.Month, c.ElapsedDays, c.Days(),
		lei(s.Totals.Budget), lei(s.Totals.Spent), lei(s.Totals.Left), s.Totals.Status)
	for _, l := range s.Lines {
		fmt.Fprintf(w, "    %-11s %9s / %9s  %s\n", l.Key, money(l.Spent), money(l.Limit), l.Status)
	}
	for _, warning := range s.Warnings {
		fmt.Fprintf(w, "  note: %s\n", warning)
	}
}

// money formats minor units the Romanian way: 2.104,37.
func money(minor int64) string {
	sign := ""
	if minor < 0 {
		sign, minor = "-", -minor
	}
	units := fmt.Sprint(minor / 100)
	var b strings.Builder
	for i, r := range units {
		if i > 0 && (len(units)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return fmt.Sprintf("%s%s,%02d", sign, b.String(), minor%100)
}
