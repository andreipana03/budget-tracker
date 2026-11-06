package jobs

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/recurring"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// maxCatchUp is how many occurrences one run creates per subscription at most
// (a subscription created far in the past catches up over several runs).
const maxCatchUp = 12

// subscriptions creates the pending transactions of every subscription that has come
// due in its household's time zone, then advances next_due_on (DB doc § 8).
// Each subscription runs in its own savepoint, so one failure doesn't stop the others.
func (r *Runner) subscriptions(ctx context.Context, tx pgx.Tx, now time.Time) error {
	due, err := store.New(tx).JobsDueSubscriptions(ctx, store.JobsDueSubscriptionsParams{Now: now, HouseholdID: r.householdScope})
	if err != nil {
		return fmt.Errorf("list due subscriptions: %w", err)
	}
	var created, failed int64
	for _, row := range due {
		sp, err := tx.Begin(ctx)
		if err != nil {
			return fmt.Errorf("savepoint: %w", err)
		}
		n, err := r.dueSubscription(ctx, store.New(sp), row)
		if err != nil {
			_ = sp.Rollback(ctx)
			failed++
			r.logger.Error("subscription failed", "subscription_id", row.RecurringTransaction.ID, "error", err)
			continue
		}
		if err := sp.Commit(ctx); err != nil {
			return fmt.Errorf("release savepoint: %w", err)
		}
		created += n
	}
	if len(due) > 0 {
		r.logger.Info("subscriptions processed", "due", len(due), "created", created, "failed", failed)
	}
	return nil
}

// dueSubscription inserts the subscription's occurrences up to its household's today
// (and ends_on), at most maxCatchUp, and returns how many transactions it created.
// A missing exchange rate stops it before that occurrence, which stays next_due_on so
// a later run retries it.
func (r *Runner) dueSubscription(ctx context.Context, q *store.Queries, row store.JobsDueSubscriptionsRow) (int64, error) {
	s := row.RecurringTransaction
	freq, interval := recurring.Frequency(s.Frequency), int(s.IntervalCount)
	next := s.NextDueOn
	var created int64
	for range maxCatchUp {
		if next.After(row.Today) || (s.EndsOn != nil && next.After(*s.EndsOn)) {
			break
		}
		f, err := q.JobsFreezeAmounts(ctx, store.JobsFreezeAmountsParams{
			AmountMinor: s.AmountMinor, Currency: s.Currency, AccountCurrency: s.AccountCurrency,
			HomeCurrency: row.HomeCurrency, OnDate: next,
		})
		if err != nil {
			return 0, fmt.Errorf("freeze amounts: %w", err)
		}
		if f.AccountAmountMinor <= 0 || f.HomeAmountMinor <= 0 || !f.FxRate.Valid {
			r.logger.Warn("subscription waits for an exchange rate", "subscription_id", s.ID,
				"currency", s.Currency, "account_currency", s.AccountCurrency, "home_currency", row.HomeCurrency,
				"occurrence", next.Format(time.DateOnly))
			break
		}
		n, err := q.JobsInsertOccurrence(ctx, store.JobsInsertOccurrenceParams{
			HouseholdID: s.HouseholdID, Kind: s.Kind, Title: s.Title, Note: s.Note, OccurredOn: next,
			CategoryID: s.CategoryID, AccountID: s.AccountID, AccountCurrency: s.AccountCurrency,
			AmountMinor: s.AmountMinor, Currency: s.Currency, AccountAmountMinor: f.AccountAmountMinor,
			HomeCurrency: row.HomeCurrency, HomeAmountMinor: f.HomeAmountMinor, FxRate: f.FxRate,
			FxRateDate: f.FxRateDate, RecurringID: &s.ID, CreatedBy: s.CreatedBy,
		})
		if err != nil {
			return 0, fmt.Errorf("insert occurrence %s: %w", next.Format(time.DateOnly), err)
		}
		created += n
		// Always from starts_on (+ n × interval), never from the previous date, so the
		// 31st comes back after shorter months.
		next = recurring.NextOnOrAfter(s.StartsOn, freq, interval, next.AddDate(0, 0, 1))
	}
	if !next.Equal(s.NextDueOn) {
		if err := q.JobsAdvanceSubscription(ctx, store.JobsAdvanceSubscriptionParams{ID: s.ID, NextDueOn: next}); err != nil {
			return 0, fmt.Errorf("advance: %w", err)
		}
	}
	return created, nil
}
