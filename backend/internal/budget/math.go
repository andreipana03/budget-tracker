package budget

import (
	"sort"
	"time"
)

// RoundHalfAway divides num by den (den ≠ 0) and rounds half away from zero, the
// rounding the DB doc requires everywhere money is divided.
func RoundHalfAway(num, den int64) int64 {
	if den < 0 {
		num, den = -num, -den
	}
	if num >= 0 {
		return (2*num + den) / (2 * den)
	}
	return -((-2*num + den) / (2 * den))
}

// Pow10 is 10^n for the small n of currencies' minor units (0–4).
func Pow10(n int) int64 {
	p := int64(1)
	for range n {
		p *= 10
	}
	return p
}

// State says where a budget month sits relative to the household's today.
type State string

const (
	StatePast    State = "past"
	StateCurrent State = "current"
	StateFuture  State = "future"
)

// Clock is how far into a budget period "today" is. Elapsed is ElapsedDays / Days,
// kept as two integers so every derived amount is exact.
type Clock struct {
	Period Period
	Today  time.Time
	State  State
	// ElapsedDays counts the days from the start through the end of today: Days for
	// past months, 0 for future ones.
	ElapsedDays int
	// DaysLeft counts today and the days after it (0 for past months).
	DaysLeft int
}

// ClockOf places today against period p.
func ClockOf(p Period, today time.Time) Clock {
	c := Clock{Period: p, Today: today}
	switch {
	case today.Before(p.Start):
		c.State = StateFuture
	case !today.Before(p.EndBefore):
		c.State = StatePast
		c.ElapsedDays = p.Days()
	default:
		c.State = StateCurrent
		c.ElapsedDays = DaysBetween(p.Start, today) + 1
		c.DaysLeft = DaysBetween(today, p.EndBefore)
	}
	return c
}

// Days is the period's length.
func (c Clock) Days() int { return c.Period.Days() }

// Elapsed is ElapsedDays / Days, for the API (the only place it becomes a float).
func (c Clock) Elapsed() float64 { return float64(c.ElapsedDays) / float64(c.Days()) }

// Scope is the kind of budget row.
type Scope string

const (
	ScopeOngoing     Scope = "ongoing"
	ScopeSingleMonth Scope = "single_month"
)

// Row is one live (not deleted) budgets row of a category.
type Row struct {
	Scope  Scope
	Month  Month
	Amount *int64 // nil on an ongoing row = no limit from this month on
}

// Limit is the limit that applies to a category in a month.
type Limit struct {
	Amount *int64 // nil = no limit
	Scope  Scope  // the row that decided it; "" when no row applies
}

// ResolveLimit applies DB doc § 7: the single_month row for m if there is one, else
// the latest ongoing row with month ≤ m (whose NULL amount means "no limit").
func ResolveLimit(rows []Row, m Month) Limit {
	var latest *Row
	for i := range rows {
		r := &rows[i]
		switch r.Scope {
		case ScopeSingleMonth:
			if r.Month == m && r.Amount != nil {
				return Limit{Amount: r.Amount, Scope: ScopeSingleMonth}
			}
		case ScopeOngoing:
			if !m.Before(r.Month) && (latest == nil || latest.Month.Before(r.Month)) {
				latest = r
			}
		}
	}
	if latest == nil || latest.Amount == nil {
		return Limit{}
	}
	return Limit{Amount: latest.Amount, Scope: ScopeOngoing}
}

// Status of a budget line or of the month total.
type Status string

const (
	StatusOver    Status = "over"
	StatusAhead   Status = "ahead"
	StatusOnTrack Status = "on_track"
)

// Line is one expense category in a month.
type Line struct {
	Limit     *int64 // nil = no budget
	Spent     int64
	Fixed     bool
	SortOrder int
}

// HasLimit reports whether the line is budgeted.
func (l Line) HasLimit() bool { return l.Limit != nil }

// Status: over when spent > limit; ahead when flexible, in the current month and
// spent / limit > elapsed + 0.05; otherwise on track. Lines without a limit are on track.
func (l Line) Status(c Clock) Status {
	if l.Limit == nil {
		return StatusOnTrack
	}
	limit := *l.Limit
	if l.Spent > limit {
		return StatusOver
	}
	if !l.Fixed && c.State == StateCurrent && limit > 0 {
		// spent/limit > e/d + 1/20  ⇔  20·spent·d > limit·(20·e + d)
		d := int64(c.Days())
		if 20*l.Spent*d > limit*(20*int64(c.ElapsedDays)+d) {
			return StatusAhead
		}
	}
	return StatusOnTrack
}

// UsedRatio is spent / max(limit, 1); nil without a limit.
func (l Line) UsedRatio() *float64 {
	if l.Limit == nil {
		return nil
	}
	r := float64(l.Spent) / float64(max(*l.Limit, 1))
	return &r
}

// Left is limit − spent; nil without a limit.
func (l Line) Left() *int64 {
	if l.Limit == nil {
		return nil
	}
	v := *l.Limit - l.Spent
	return &v
}

// SegmentAmount is min(spent, limit), the line's share of the total pace bar.
func (l Line) SegmentAmount() int64 {
	if l.Limit == nil {
		return 0
	}
	return min(l.Spent, *l.Limit)
}

// MoreUsed orders budgeted lines by usedRatio, highest first, ties by sort order.
// The comparison is exact (cross-multiplied), never through floats.
func MoreUsed(a, b Line) bool {
	la, lb := max(deref(a.Limit), 1), max(deref(b.Limit), 1)
	x, y := a.Spent*lb, b.Spent*la
	if x != y {
		return x > y
	}
	return a.SortOrder < b.SortOrder
}

// SortByUsage sorts lines in place with MoreUsed (stable).
func SortByUsage(lines []Line) {
	sort.SliceStable(lines, func(i, j int) bool { return MoreUsed(lines[i], lines[j]) })
}

func deref(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// Totals are the month's pace numbers over the budgeted lines.
type Totals struct {
	Budget, Spent, Left   int64
	FixedLimit, FlexLimit int64
	FlexSpent             int64
	HasBudget             bool
	PerDay, UnderPace     *int64   // current month only
	PaceMarker            *float64 // current month only, and only when Budget > 0
	Status                Status
}

// ComputeTotals adds up the budgeted lines and works out the pace numbers
// (design doc § 3, DB doc § 7). minorUnits is the home currency's (RON 2, JPY 0): the
// daily amount is rounded to whole major units.
func ComputeTotals(lines []Line, c Clock, minorUnits int) Totals {
	var t Totals
	for _, l := range lines {
		if l.Limit == nil {
			continue
		}
		t.HasBudget = true
		t.Budget += *l.Limit
		t.Spent += l.Spent
		if l.Fixed {
			t.FixedLimit += *l.Limit
		} else {
			t.FlexLimit += *l.Limit
			t.FlexSpent += l.Spent
		}
	}
	t.Left = t.Budget - t.Spent

	if c.State == StateCurrent {
		days, elapsed := int64(c.Days()), int64(c.ElapsedDays)
		unit := Pow10(minorUnits)
		perDay := RoundHalfAway(t.FlexLimit-t.FlexSpent, int64(c.DaysLeft)*unit) * unit
		perDay = max(perDay, 0)
		t.PerDay = &perDay
		under := RoundHalfAway(t.FlexLimit*elapsed-t.FlexSpent*days, days)
		t.UnderPace = &under
		if t.Budget > 0 {
			// (fixed + flex·e/d) / total, as one division at the edge.
			m := float64(t.FixedLimit*days+t.FlexLimit*elapsed) / float64(t.Budget*days)
			t.PaceMarker = &m
		}
	}

	switch {
	case t.Spent > t.Budget:
		t.Status = StatusOver
	case t.UnderPace != nil && *t.UnderPace < 0:
		t.Status = StatusAhead
	default:
		t.Status = StatusOnTrack
	}
	return t
}
