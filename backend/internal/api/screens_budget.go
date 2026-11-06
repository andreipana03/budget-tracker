package api

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Shared by the Budgets, Home, months and Insights handlers: building a BudgetMonth
// from the household's categories, budget rows and spending.

func screensCategoryRef(id uuid.UUID, name, color, icon string, fixed bool) gen.CategoryRef {
	return gen.CategoryRef{
		Id:      id,
		Kind:    gen.EntryKindExpense,
		Name:    name,
		Color:   gen.CategoryColor(color),
		Icon:    icon,
		IsFixed: fixed,
	}
}

// screensMinorUnits is the number of minor units of a currency (RON 2, JPY 0).
func (s *Server) screensMinorUnits(ctx context.Context, q *store.Queries, code string) (int, error) {
	n, err := q.ScreensCurrencyMinorUnits(ctx, code)
	if err != nil {
		return 0, fmt.Errorf("currency %s: %w", code, err)
	}
	return int(n), nil
}

// screensBudgetSetup is what limit resolution needs, read once for any number of months.
type screensBudgetSetup struct {
	categories []store.ScreensExpenseCategoriesRow // active expense categories, in sort order
	rows       map[uuid.UUID][]budget.Row          // live budgets rows per category
	firstMonth *budget.Month                       // earliest budgets row
}

func (s *Server) screensLoadBudgetSetup(ctx context.Context, q *store.Queries, h householdInfo) (screensBudgetSetup, error) {
	cats, err := q.ScreensExpenseCategories(ctx, h.ID)
	if err != nil {
		return screensBudgetSetup{}, fmt.Errorf("load categories: %w", err)
	}
	rows, err := q.ScreensBudgetRows(ctx, h.ID)
	if err != nil {
		return screensBudgetSetup{}, fmt.Errorf("load budgets: %w", err)
	}
	setup := screensBudgetSetup{categories: cats, rows: map[uuid.UUID][]budget.Row{}}
	for _, r := range rows {
		m := budget.CalendarMonth(r.Month)
		setup.rows[r.CategoryID] = append(setup.rows[r.CategoryID],
			budget.Row{Scope: budget.Scope(r.Scope), Month: m, Amount: r.AmountMinor})
		if setup.firstMonth == nil || m.Before(*setup.firstMonth) {
			setup.firstMonth = &m
		}
	}
	return setup, nil
}

// limit is the category's limit in month m.
func (b screensBudgetSetup) limit(category uuid.UUID, m budget.Month) budget.Limit {
	return budget.ResolveLimit(b.rows[category], m)
}

// budgetTotal is the sum of all limits in month m; nil when no category has one.
func (b screensBudgetSetup) budgetTotal(m budget.Month) *int64 {
	var total *int64
	for _, c := range b.categories {
		if l := b.limit(c.ID, m); l.Amount != nil {
			total = ptr(deref(total) + *l.Amount)
		}
	}
	return total
}

// screensSpentByCategory is posted expenses per category within a period.
func (s *Server) screensSpentByCategory(ctx context.Context, q *store.Queries, h householdInfo, p budget.Period) (map[uuid.UUID]int64, error) {
	rows, err := q.ScreensSpentByCategory(ctx, store.ScreensSpentByCategoryParams{
		HouseholdID: h.ID, StartsOn: p.Start, EndsBefore: p.EndBefore,
	})
	if err != nil {
		return nil, fmt.Errorf("load spending: %w", err)
	}
	spent := make(map[uuid.UUID]int64, len(rows))
	for _, r := range rows {
		spent[r.CategoryID] = r.SpentMinor
	}
	return spent, nil
}

// screensMonth is a computed budget month: the API object plus the lines behind it.
type screensMonth struct {
	API   gen.BudgetMonth
	Clock budget.Clock
	// Budgeted holds every line with a limit (fixed and flexible) with its API form.
	Budgeted []screensLine
}

type screensLine struct {
	Line budget.Line
	API  gen.BudgetLine
}

// screensBudgetMonth computes GET /budgets for month m.
func (s *Server) screensBudgetMonth(ctx context.Context, q *store.Queries, h householdInfo, m budget.Month) (screensMonth, error) {
	setup, err := s.screensLoadBudgetSetup(ctx, q, h)
	if err != nil {
		return screensMonth{}, err
	}
	period := h.Period(m)
	spent, err := s.screensSpentByCategory(ctx, q, h, period)
	if err != nil {
		return screensMonth{}, err
	}
	minor, err := s.screensMinorUnits(ctx, q, h.HomeCurrency)
	if err != nil {
		return screensMonth{}, err
	}
	return screensBuildMonth(h, m, setup, spent, minor), nil
}

// screensBuildMonth assembles the BudgetMonth from already loaded data.
func screensBuildMonth(h householdInfo, m budget.Month, setup screensBudgetSetup, spent map[uuid.UUID]int64, minorUnits int) screensMonth {
	period := h.Period(m)
	clock := budget.ClockOf(period, h.Today)

	out := screensMonth{Clock: clock}
	api := gen.BudgetMonth{
		Period: gen.BudgetPeriod{
			Month:        m.String(),
			StartsOn:     apiDate(period.Start),
			EndsBefore:   apiDate(period.EndBefore),
			DaysInPeriod: period.Days(),
			State:        gen.BudgetPeriodState(clock.State),
			Today:        apiDate(h.Today),
			Elapsed:      clock.Elapsed(),
			DaysLeft:     clock.DaysLeft,
		},
		HomeCurrency: h.HomeCurrency,
		Segments:     []gen.PaceSegment{},
		Flexible:     []gen.BudgetLine{},
		Fixed:        []gen.BudgetLine{},
		Unbudgeted:   []gen.BudgetLine{},
	}

	all := make([]budget.Line, 0, len(setup.categories))
	var fixedSegs, flexSegs []gen.PaceSegment
	for _, c := range setup.categories {
		ref := screensCategoryRef(c.ID, c.Name, c.Color, c.Icon, c.IsFixed)
		lim := setup.limit(c.ID, m)
		line := budget.Line{Limit: lim.Amount, Spent: spent[c.ID], Fixed: c.IsFixed, SortOrder: int(c.SortOrder)}
		all = append(all, line)
		apiLine := gen.BudgetLine{
			Category:   ref,
			LimitMinor: line.Limit,
			SpentMinor: line.Spent,
			LeftMinor:  line.Left(),
			Status:     gen.BudgetStatus(line.Status(clock)),
			UsedRatio:  line.UsedRatio(),
		}
		if lim.Scope != "" {
			apiLine.Scope = ptr(gen.BudgetLineScope(lim.Scope))
		}
		if !line.HasLimit() {
			api.Unbudgeted = append(api.Unbudgeted, apiLine)
			continue
		}
		out.Budgeted = append(out.Budgeted, screensLine{Line: line, API: apiLine})
		if amount := line.SegmentAmount(); amount > 0 {
			seg := gen.PaceSegment{Category: ref, AmountMinor: amount}
			if c.IsFixed {
				fixedSegs = append(fixedSegs, seg)
			} else {
				flexSegs = append(flexSegs, seg)
			}
		}
	}
	api.Segments = append(append(api.Segments, fixedSegs...), flexSegs...)

	// Flexible lines by usage (over first); fixed lines in sort order, as Budgeted already is.
	for _, l := range screensRankByUsage(out.Budgeted) {
		if !l.Line.Fixed {
			api.Flexible = append(api.Flexible, l.API)
		}
	}
	for _, l := range out.Budgeted {
		if l.Line.Fixed {
			api.Fixed = append(api.Fixed, l.API)
		}
	}

	t := budget.ComputeTotals(all, clock, minorUnits)
	api.HasBudget = t.HasBudget
	api.Totals = gen.BudgetTotals{
		BudgetMinor:     t.Budget,
		SpentMinor:      t.Spent,
		LeftMinor:       t.Left,
		FixedLimitMinor: t.FixedLimit,
		FlexLimitMinor:  t.FlexLimit,
		FlexSpentMinor:  t.FlexSpent,
		PerDayMinor:     t.PerDay,
		UnderPaceMinor:  t.UnderPace,
		PaceMarker:      t.PaceMarker,
		Status:          gen.BudgetStatus(t.Status),
	}
	out.API = api
	return out
}

// screensRankByUsage orders budgeted lines by usedRatio, highest first, ties in sort order.
func screensRankByUsage(lines []screensLine) []screensLine {
	ranked := append([]screensLine(nil), lines...)
	// Insertion sort keeps it stable and exact (budget.MoreUsed cross-multiplies).
	for i := 1; i < len(ranked); i++ {
		for j := i; j > 0 && budget.MoreUsed(ranked[j].Line, ranked[j-1].Line); j-- {
			ranked[j], ranked[j-1] = ranked[j-1], ranked[j]
		}
	}
	return ranked
}
