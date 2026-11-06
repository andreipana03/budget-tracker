package api

import (
	"context"
	"fmt"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

const (
	screensHomeUpcoming = 6 // subscriptions on Home
	screensHomeRecent   = 6 // transactions on Home
	screensDueSoonDays  = 7
	// screensMaxMonths caps the month picker (a transaction typed with year 1999 shouldn't
	// produce hundreds of rows).
	screensMaxMonths = 120
)

// GetHome returns everything the Home screen shows for a budget month.
func (s *Server) GetHome(ctx context.Context, request gen.GetHomeRequestObject) (gen.GetHomeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}
	m, err := monthOrCurrent(h, request.Params.Month)
	if err != nil {
		return nil, err
	}
	month, err := s.screensBudgetMonth(ctx, s.q, h, m)
	if err != nil {
		return nil, err
	}

	home := gen.Home{
		Budget:    month.API,
		Attention: make([]gen.BudgetLine, 0, len(month.Budgeted)),
	}
	for _, l := range screensRankByUsage(month.Budgeted) {
		home.Attention = append(home.Attention, l.API)
	}

	pending, err := s.pendingTransactions(ctx, s.q, h)
	if err != nil {
		return nil, err
	}
	recent, err := s.recentTransactions(ctx, s.q, h, screensHomeRecent)
	if err != nil {
		return nil, err
	}
	subs, err := s.activeSubscriptions(ctx, s.q, h)
	if err != nil {
		return nil, err
	}
	home.Pending = screensNonNil(pending)
	home.PendingCount = len(pending)
	home.Recent = screensNonNil(recent)
	home.Upcoming = screensNonNil(subs[:min(len(subs), screensHomeUpcoming)])
	for _, sub := range subs {
		if sub.DaysUntilDue >= 0 && sub.DaysUntilDue <= screensDueSoonDays {
			home.DueSoonCount++
		}
	}
	return gen.GetHome200JSONResponse(home), nil
}

func screensNonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// ListMonths lists the budget months for the month picker, newest first: from next
// month back to the first month with data (first transaction, first budget row or the
// month the household was created, whichever is earliest).
func (s *Server) ListMonths(ctx context.Context, request gen.ListMonthsRequestObject) (gen.ListMonthsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}
	setup, err := s.screensLoadBudgetSetup(ctx, s.q, h)
	if err != nil {
		return nil, err
	}

	newest := h.CurrentMonth.Add(1)
	oldest := budget.MonthContaining(budget.Today(h.Row.CreatedAt, h.Location), h.MonthStartDay)
	if setup.firstMonth != nil && setup.firstMonth.Before(oldest) {
		oldest = *setup.firstMonth
	}
	first, err := s.q.ScreensFirstTransactionDay(ctx, h.ID)
	switch {
	case dbx.IsNoRows(err):
	case err != nil:
		return nil, fmt.Errorf("first transaction: %w", err)
	default:
		if m := budget.MonthContaining(first, h.MonthStartDay); m.Before(oldest) {
			oldest = m
		}
	}
	if newest.Before(oldest) {
		oldest = newest
	}
	if oldest.MonthsBetween(newest) >= screensMaxMonths {
		oldest = newest.Add(-(screensMaxMonths - 1))
	}

	rows, err := s.q.ScreensSpentByMonth(ctx, store.ScreensSpentByMonthParams{
		HouseholdID: h.ID,
		StartDay:    int32(h.MonthStartDay),
		FromDay:     h.Period(oldest).Start,
	})
	if err != nil {
		return nil, fmt.Errorf("spending by month: %w", err)
	}
	spent := make(map[budget.Month]int64, len(rows))
	for _, r := range rows {
		spent[budget.CalendarMonth(r.Month)] = r.SpentMinor
	}

	list := gen.MonthList{Current: h.CurrentMonth.String(), HomeCurrency: h.HomeCurrency}
	for m := newest; !m.Before(oldest); m = m.Add(-1) {
		list.Items = append(list.Items, gen.MonthSummary{
			Month:       m.String(),
			SpentMinor:  spent[m],
			BudgetMinor: setup.budgetTotal(m),
		})
	}
	return gen.ListMonths200JSONResponse(list), nil
}
