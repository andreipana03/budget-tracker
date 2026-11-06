// Package insights computes the Insights screen from daily spending: the bars of a
// period, the "so far vs. the same point last time" headline, the average, the
// projection and the highlights. Everything is int64 minor units of the home
// currency; floats appear only in the ratios handed to the API.
//
// Calendar days are midnight-UTC time.Time values, as in package budget.
package insights

import (
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/budget"
)

// Period is the segmented control on Insights.
type Period string

const (
	Week      Period = "week"
	Month     Period = "month"
	SixMonths Period = "six_months"
	Year      Period = "year"
)

// Span is a half-open range of days [Start, EndBefore).
type Span struct {
	Start, EndBefore time.Time
}

// Contains reports whether day is inside the span.
func (s Span) Contains(day time.Time) bool {
	return !day.Before(s.Start) && day.Before(s.EndBefore)
}

// Layout is what a period covers for a given today.
type Layout struct {
	Period Period
	Range  Span
	Bars   []Span
	// Current is the index of the bar containing today.
	Current int
	// Monthly is true for six_months and year (one bar per budget month).
	Monthly bool
	// SoFar is the current unit (week or budget month) up to and including today;
	// Previous is the unit before it up to the same point; PreviousUnit is all of it.
	SoFar, Previous, PreviousUnit Span
	// ComparedTo is the first day of the previous unit.
	ComparedTo time.Time
	// Month is the current budget period (week aside, the current unit).
	Month budget.Period
}

// Plan lays out period p around today for a household whose budget months start on startDay.
//
//   - week: Monday–Sunday containing today, 7 daily bars, compared with last week.
//   - month: the current budget period, one bar per day, compared with the previous budget month.
//   - six_months / year: 6 / 12 budget-month bars ending with the current month,
//     headline compared with the previous budget month (as in the mockup).
func Plan(p Period, today time.Time, startDay int) Layout {
	cur := budget.MonthContaining(today, startDay)
	month := budget.PeriodOf(cur, startDay)
	l := Layout{Period: p, Month: month}

	switch p {
	case Week:
		monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
		l.Range = Span{monday, monday.AddDate(0, 0, 7)}
		l.Bars = dailyBars(l.Range)
		lastMonday := monday.AddDate(0, 0, -7)
		l.SoFar = Span{monday, today.AddDate(0, 0, 1)}
		l.Previous = Span{lastMonday, today.AddDate(0, 0, -6)}
		l.PreviousUnit = Span{lastMonday, monday}
		l.ComparedTo = lastMonday
	default:
		switch p {
		case Month:
			l.Range = Span{month.Start, month.EndBefore}
			l.Bars = dailyBars(l.Range)
		default:
			n := 6
			if p == Year {
				n = 12
			}
			l.Monthly = true
			for i := n - 1; i >= 0; i-- {
				m := budget.PeriodOf(cur.Add(-i), startDay)
				l.Bars = append(l.Bars, Span{m.Start, m.EndBefore})
			}
			l.Range = Span{l.Bars[0].Start, l.Bars[n-1].EndBefore}
		}
		prev := budget.PeriodOf(cur.Add(-1), startDay)
		offset := budget.DaysBetween(month.Start, today)
		end := prev.Start.AddDate(0, 0, offset+1)
		if end.After(prev.EndBefore) {
			end = prev.EndBefore
		}
		l.SoFar = Span{month.Start, today.AddDate(0, 0, 1)}
		l.Previous = Span{prev.Start, end}
		l.PreviousUnit = Span{prev.Start, prev.EndBefore}
		l.ComparedTo = prev.Start
	}

	l.Current = -1
	for i, b := range l.Bars {
		if b.Contains(today) {
			l.Current = i
		}
	}
	return l
}

func dailyBars(s Span) []Span {
	var bars []Span
	for d := s.Start; d.Before(s.EndBefore); d = d.AddDate(0, 0, 1) {
		bars = append(bars, Span{d, d.AddDate(0, 0, 1)})
	}
	return bars
}

// Fetch is the span of days whose spending the computations need: the range plus the
// previous unit.
func (l Layout) Fetch() Span {
	s := l.Range
	if l.PreviousUnit.Start.Before(s.Start) {
		s.Start = l.PreviousUnit.Start
	}
	return s
}

// Spend is the posted expenses of one category on one day, in the home currency.
type Spend struct {
	Day      time.Time
	Category uuid.UUID
	Amount   int64
}

// Order ranks categories for ties (their sort order); lower comes first.
type Order func(uuid.UUID) int

// Sum adds up the spending inside s.
func Sum(spends []Spend, s Span) int64 {
	var total int64
	for _, sp := range spends {
		if s.Contains(sp.Day) {
			total += sp.Amount
		}
	}
	return total
}

func sumBy(spends []Spend, s Span) map[uuid.UUID]int64 {
	m := map[uuid.UUID]int64{}
	for _, sp := range spends {
		if s.Contains(sp.Day) {
			m[sp.Category] += sp.Amount
		}
	}
	return m
}

// BarTotals is the spending of every bar.
func (l Layout) BarTotals(spends []Spend) []int64 {
	out := make([]int64, len(l.Bars))
	for i, b := range l.Bars {
		out[i] = Sum(spends, b)
	}
	return out
}

// Average is the mean of the bars before the current one that have spending, rounded
// half away from zero; nil when fewer than 2 such bars.
func Average(bars []int64, current int) *int64 {
	if current < 0 {
		current = len(bars)
	}
	var sum, n int64
	for _, v := range bars[:current] {
		if v > 0 {
			sum += v
			n++
		}
	}
	if n < 2 {
		return nil
	}
	avg := budget.RoundHalfAway(sum, n)
	return &avg
}

// Headline compares the current unit so far with the previous one at the same point.
type Headline struct {
	Current  int64
	Previous *int64   // nil when the previous unit has no spending at all
	Change   *float64 // (current − previous) / previous; nil without previous data
}

// HeadlineOf computes the headline.
func (l Layout) HeadlineOf(spends []Spend) Headline {
	h := Headline{Current: Sum(spends, l.SoFar)}
	if Sum(spends, l.PreviousUnit) == 0 {
		return h
	}
	prev := Sum(spends, l.Previous)
	h.Previous = &prev
	if prev > 0 {
		r := float64(h.Current-prev) / float64(prev)
		h.Change = &r
	}
	return h
}

// CategoryTotal is one category's spending over a span.
type CategoryTotal struct {
	Category uuid.UUID
	Spent    int64
	Share    float64
}

// ByCategory is the spending per category over the range, largest first (ties by order),
// with each one's share of the total. Categories without spending are left out.
func (l Layout) ByCategory(spends []Spend, order Order) []CategoryTotal {
	by := sumBy(spends, l.Range)
	var total int64
	out := make([]CategoryTotal, 0, len(by))
	for id, v := range by {
		if v == 0 {
			continue
		}
		total += v
		out = append(out, CategoryTotal{Category: id, Spent: v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Spent != out[j].Spent {
			return out[i].Spent > out[j].Spent
		}
		return before(order, out[i].Category, out[j].Category)
	})
	for i := range out {
		out[i].Share = float64(out[i].Spent) / float64(total)
	}
	return out
}

func before(order Order, a, b uuid.UUID) bool {
	oa, ob := order(a), order(b)
	if oa != ob {
		return oa < ob
	}
	return a.String() < b.String()
}

// Change is the "biggest change" highlight.
type Change struct {
	Category          uuid.UUID
	Current, Previous int64
	Ratio             float64
	Spark             []int64 // the category's spending per bar of the range
}

// BiggestChange finds the category whose spending moved the most between the previous
// unit and the current one (both up to the same point). A candidate needs a change of
// at least 10%, at least 20 major units, and at least 10 major units the previous time.
// minorUnits is the home currency's. Nil when no category qualifies.
func (l Layout) BiggestChange(spends []Spend, minorUnits int, order Order) *Change {
	unit := budget.Pow10(minorUnits)
	cur, prev := sumBy(spends, l.SoFar), sumBy(spends, l.Previous)
	var best *Change
	var bestDiff int64
	for id, p := range prev {
		c := cur[id]
		diff := c - p
		abs := diff
		if abs < 0 {
			abs = -abs
		}
		if p < 10*unit || abs < 20*unit || 10*abs < p {
			continue
		}
		if best == nil || abs > bestDiff || (abs == bestDiff && before(order, id, best.Category)) {
			best = &Change{Category: id, Current: c, Previous: p, Ratio: float64(diff) / float64(p)}
			bestDiff = abs
		}
	}
	if best == nil {
		return nil
	}
	best.Spark = make([]int64, len(l.Bars))
	for _, sp := range spends {
		if sp.Category != best.Category {
			continue
		}
		for i, b := range l.Bars {
			if b.Contains(sp.Day) {
				best.Spark[i] += sp.Amount
			}
		}
	}
	return best
}

// Day is the "biggest day" highlight.
type Day struct {
	Date  time.Time
	Spent int64
	// Top is the one category that was at least half of the day, otherwise the top two.
	Top []uuid.UUID
}

// BiggestDay is the day in the range with the most spending (ties: the most recent).
// Nil when nothing was spent in the range.
func (l Layout) BiggestDay(spends []Spend, order Order) *Day {
	days := map[time.Time]int64{}
	for _, sp := range spends {
		if l.Range.Contains(sp.Day) {
			days[sp.Day] += sp.Amount
		}
	}
	var best *Day
	for d, v := range days {
		if v <= 0 {
			continue
		}
		if best == nil || v > best.Spent || (v == best.Spent && d.After(best.Date)) {
			best = &Day{Date: d, Spent: v}
		}
	}
	if best == nil {
		return nil
	}
	by := sumBy(spends, Span{best.Date, best.Date.AddDate(0, 0, 1)})
	ids := make([]uuid.UUID, 0, len(by))
	for id, v := range by {
		if v > 0 {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool {
		if by[ids[i]] != by[ids[j]] {
			return by[ids[i]] > by[ids[j]]
		}
		return before(order, ids[i], ids[j])
	})
	if 2*by[ids[0]] >= best.Spent || len(ids) == 1 {
		best.Top = ids[:1]
	} else {
		best.Top = ids[:2]
	}
	return best
}

// MinProjectionDays is how many days of the month must have passed (today included)
// before the current month bar gets a projection.
const MinProjectionDays = 3

// Project estimates the current month's total: fixed costs count in full (whichever is
// larger, what was spent or the limits), flexible spending is extrapolated at its pace so
// far. Without a budget, pass all spending as flexible and 0 for the fixed amounts.
// Nil outside the current month or before MinProjectionDays.
func Project(fixedSpent, fixedLimits, flexSpent int64, c budget.Clock) *int64 {
	if c.State != budget.StateCurrent || c.ElapsedDays < MinProjectionDays {
		return nil
	}
	v := max(fixedSpent, fixedLimits) + budget.RoundHalfAway(flexSpent*int64(c.Days()), int64(c.ElapsedDays))
	return &v
}
