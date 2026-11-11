package api

import (
	"context"
	"fmt"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Loaders the Home and Insights screens reuse from the ledger (transactions and
// subscriptions). They return fully converted API objects, so every screen shows a
// transaction or a subscription the same way.

// subscriptionTotals is the cost of active expense subscriptions in the home currency
// (DB doc § 8: weekly × 52/12, monthly × 1, yearly ÷ 12, ÷ interval_count, at today's rate).
type subscriptionTotals struct {
	PerMonthMinor int64
	PerYearMinor  int64
	ActiveCount   int
	// IsApproximate is true when any amount was converted from another currency.
	IsApproximate bool
}

// pendingTransactions returns subscription charges waiting for confirmation, oldest first.
func (s *Server) pendingTransactions(ctx context.Context, q *store.Queries, h householdInfo) ([]gen.Transaction, error) {
	rows, err := q.LedgerPendingTransactions(ctx, h.ID)
	if err != nil {
		return nil, fmt.Errorf("pending transactions: %w", err)
	}
	out := make([]gen.Transaction, 0, len(rows))
	for _, r := range rows {
		out = append(out, ledgerTransaction(r.Transaction, r.Category, r.Account))
	}
	return out, nil
}

// recentTransactions returns the household's latest posted transactions, newest first.
func (s *Server) recentTransactions(ctx context.Context, q *store.Queries, h householdInfo, limit int) ([]gen.Transaction, error) {
	rows, err := q.LedgerRecentTransactions(ctx, store.LedgerRecentTransactionsParams{HouseholdID: h.ID, RowLimit: int32(limit)})
	if err != nil {
		return nil, fmt.Errorf("recent transactions: %w", err)
	}
	out := make([]gen.Transaction, 0, len(rows))
	for _, r := range rows {
		out = append(out, ledgerTransaction(r.Transaction, r.Category, r.Account))
	}
	return out, nil
}

// activeSubscriptions returns active subscriptions (expense and income), soonest first,
// with amountHomeMinor, monthlyHomeMinor and daysUntilDue filled in for today.
func (s *Server) activeSubscriptions(ctx context.Context, q *store.Queries, h householdInfo) ([]gen.Subscription, error) {
	rows, err := s.ledgerSubRows(ctx, q, h, true)
	if err != nil {
		return nil, err
	}
	out := make([]gen.Subscription, 0, len(rows))
	for _, r := range rows {
		out = append(out, ledgerSubscription(r, h.Today))
	}
	return out, nil
}

// totalsOfSubscriptions sums the active expense subscriptions.
func (s *Server) totalsOfSubscriptions(ctx context.Context, q *store.Queries, h householdInfo) (subscriptionTotals, error) {
	rows, err := s.ledgerSubRows(ctx, q, h, true)
	if err != nil {
		return subscriptionTotals{}, err
	}
	return ledgerSubTotals(rows), nil
}

// ledgerSubRows loads the household's subscriptions (only active ones when activeOnly),
// soonest due first.
func (s *Server) ledgerSubRows(ctx context.Context, q *store.Queries, h householdInfo, activeOnly bool) ([]ledgerSubRow, error) {
	rows, err := q.LedgerListSubscriptions(ctx, store.LedgerListSubscriptionsParams{
		Today: h.Today, HouseholdID: h.ID, ActiveOnly: activeOnly,
	})
	if err != nil {
		return nil, fmt.Errorf("list subscriptions: %w", err)
	}
	out := make([]ledgerSubRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, ledgerSubRow{
			R: r.RecurringTransaction, A: r.Account, C: r.Category,
			HomeRate: r.HomeRate, FromMinor: r.CurrencyMinorUnits, HomeMinor: r.HomeMinorUnits,
			HomeCode: h.HomeCurrency,
		})
	}
	return out, nil
}
