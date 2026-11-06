package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
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
	return nil, apierr.NotImplemented()
}

// recentTransactions returns the household's latest posted transactions, newest first.
func (s *Server) recentTransactions(ctx context.Context, q *store.Queries, h householdInfo, limit int) ([]gen.Transaction, error) {
	return nil, apierr.NotImplemented()
}

// activeSubscriptions returns active subscriptions (expense and income), soonest first,
// with amountHomeMinor, monthlyHomeMinor and daysUntilDue filled in for today.
func (s *Server) activeSubscriptions(ctx context.Context, q *store.Queries, h householdInfo) ([]gen.Subscription, error) {
	return nil, apierr.NotImplemented()
}

// totalsOfSubscriptions sums the active expense subscriptions.
func (s *Server) totalsOfSubscriptions(ctx context.Context, q *store.Queries, h householdInfo) (subscriptionTotals, error) {
	return subscriptionTotals{}, apierr.NotImplemented()
}
