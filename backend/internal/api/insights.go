package api

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/insights"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// GetInsights returns spending trends for a period (package insights has the rules).
// All amounts are posted expenses in the home currency.
func (s *Server) GetInsights(ctx context.Context, request gen.GetInsightsRequestObject) (gen.GetInsightsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	period := gen.InsightsPeriodSixMonths
	if request.Params.Period != nil {
		period = *request.Params.Period
	}
	if !period.Valid() {
		return nil, apierr.Validation(apierr.Field("period", "invalid", "Use week, month, six_months or year."))
	}
	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}

	// Category labels (archived ones too: their spending is history).
	cats, err := s.q.ScreensCategoryRefs(ctx, h.ID)
	if err != nil {
		return nil, fmt.Errorf("load categories: %w", err)
	}
	refs := make(map[uuid.UUID]store.ScreensCategoryRefsRow, len(cats))
	for _, c := range cats {
		refs[c.ID] = c
	}
	filter := request.Params.CategoryId
	if filter != nil {
		if c, ok := refs[*filter]; !ok || c.DeletedAt != nil {
			return nil, apierr.NotFound("category")
		}
	}
	ref := func(id uuid.UUID) gen.CategoryRef {
		c := refs[id]
		return screensCategoryRef(id, c.Name, c.Color, c.Icon, c.IsFixed)
	}
	order := insights.Order(func(id uuid.UUID) int {
		if c, ok := refs[id]; ok {
			return int(c.SortOrder)
		}
		return 1 << 30
	})

	layout := insights.Plan(insights.Period(period), h.Today, h.MonthStartDay)
	fetch := layout.Fetch()
	rows, err := s.q.ScreensDailySpending(ctx, store.ScreensDailySpendingParams{
		HouseholdID: h.ID, StartsOn: fetch.Start, EndsBefore: fetch.EndBefore, CategoryID: filter,
	})
	if err != nil {
		return nil, fmt.Errorf("load spending: %w", err)
	}
	spends := make([]insights.Spend, len(rows))
	for i, r := range rows {
		spends[i] = insights.Spend{Day: r.OccurredOn, Category: r.CategoryID, Amount: r.SpentMinor}
	}
	minor, err := s.screensMinorUnits(ctx, s.q, h.HomeCurrency)
	if err != nil {
		return nil, err
	}

	out := gen.Insights{
		Period:       period,
		HomeCurrency: h.HomeCurrency,
		StartsOn:     apiDate(layout.Range.Start),
		EndsBefore:   apiDate(layout.Range.EndBefore),
		Bars:         make([]gen.InsightsBar, len(layout.Bars)),
		ByCategory:   []gen.CategorySpend{},
	}

	totals := layout.BarTotals(spends)
	for i, b := range layout.Bars {
		out.Bars[i] = gen.InsightsBar{
			StartsOn:   apiDate(b.Start),
			EndsBefore: apiDate(b.EndBefore),
			SpentMinor: totals[i],
			IsCurrent:  i == layout.Current,
		}
	}
	if layout.Monthly && layout.Current >= 0 {
		projected, err := s.screensProjection(ctx, h, layout, spends, refs, filter)
		if err != nil {
			return nil, err
		}
		out.Bars[layout.Current].ProjectedMinor = projected
	}
	out.AverageMinor = insights.Average(totals, layout.Current)

	head := layout.HeadlineOf(spends)
	out.Headline = gen.InsightsHeadline{
		CurrentMinor:  head.Current,
		PreviousMinor: head.Previous,
		ChangeRatio:   head.Change,
		ComparedTo:    apiDate(layout.ComparedTo),
	}

	for _, c := range layout.ByCategory(spends, order) {
		out.ByCategory = append(out.ByCategory, gen.CategorySpend{Category: ref(c.Category), SpentMinor: c.Spent, Share: c.Share})
	}
	if ch := layout.BiggestChange(spends, minor, order); ch != nil {
		out.BiggestChange = &gen.BiggestChange{
			Category:      ref(ch.Category),
			CurrentMinor:  ch.Current,
			PreviousMinor: ch.Previous,
			ChangeRatio:   ch.Ratio,
			ComparedTo:    apiDate(layout.ComparedTo),
			Spark:         ch.Spark,
		}
	}
	if day := layout.BiggestDay(spends, order); day != nil {
		bd := &gen.BiggestDay{Date: apiDate(day.Date), SpentMinor: day.Spent, TopCategories: []gen.CategoryRef{}}
		for _, id := range day.Top {
			bd.TopCategories = append(bd.TopCategories, ref(id))
		}
		out.BiggestDay = bd
	}

	subTotals, err := s.totalsOfSubscriptions(ctx, s.q, h)
	if err != nil {
		return nil, err
	}
	out.Subscriptions = gen.SubscriptionsHighlight{
		PerMonthMinor: subTotals.PerMonthMinor,
		ActiveCount:   subTotals.ActiveCount,
		IsApproximate: subTotals.IsApproximate,
	}
	subs, err := s.activeSubscriptions(ctx, s.q, h)
	if err != nil {
		return nil, err
	}
	for i := range subs {
		if subs[i].Kind == gen.EntryKindExpense {
			out.Subscriptions.Next = &subs[i]
			break
		}
	}
	return gen.GetInsights200JSONResponse(out), nil
}

// screensProjection projects the current budget month: fixed costs in full
// (max of spent and limits), flexible spending at its pace so far. Without any budget
// this month, all spending counts as flexible.
func (s *Server) screensProjection(ctx context.Context, h householdInfo, layout insights.Layout, spends []insights.Spend,
	refs map[uuid.UUID]store.ScreensCategoryRefsRow, filter *uuid.UUID) (*int64, error) {
	clock := budget.ClockOf(layout.Month, h.Today)
	if clock.State != budget.StateCurrent || clock.ElapsedDays < insights.MinProjectionDays {
		return nil, nil
	}
	setup, err := s.screensLoadBudgetSetup(ctx, s.q, h)
	if err != nil {
		return nil, err
	}
	m := layout.Month.Month
	hasBudget := setup.budgetTotal(m) != nil
	var fixedLimits int64
	for _, c := range setup.categories {
		if c.IsFixed && (filter == nil || *filter == c.ID) {
			fixedLimits += deref(setup.limit(c.ID, m).Amount)
		}
	}
	var fixedSpent, flexSpent int64
	current := insights.Span{Start: layout.Month.Start, EndBefore: layout.Month.EndBefore}
	for _, sp := range spends {
		if !current.Contains(sp.Day) {
			continue
		}
		if hasBudget && refs[sp.Category].IsFixed {
			fixedSpent += sp.Amount
		} else {
			flexSpent += sp.Amount
		}
	}
	if !hasBudget {
		fixedLimits = 0
	}
	return insights.Project(fixedSpent, fixedLimits, flexSpent, clock), nil
}
