package budget

import (
	"testing"
	"time"
)

func i64(v int64) *int64 { return &v }

func TestRoundHalfAway(t *testing.T) {
	cases := []struct{ num, den, want int64 }{
		{5, 2, 3}, {-5, 2, -3}, {4, 2, 2}, {7, 3, 2}, {8, 3, 3}, {-7, 3, -2}, {-8, 3, -3},
		{71071, 1300, 55}, {152130, 30, 5071}, {1, -2, -1}, {0, 7, 0}, {149, 100, 1}, {150, 100, 2},
	}
	for _, c := range cases {
		if got := RoundHalfAway(c.num, c.den); got != c.want {
			t.Errorf("RoundHalfAway(%d, %d) = %d, want %d", c.num, c.den, got, c.want)
		}
	}
}

func TestClockOf(t *testing.T) {
	p := PeriodOf(Month{2026, time.November}, 1)
	c := ClockOf(p, Date(2026, 11, 18))
	if c.State != StateCurrent || c.ElapsedDays != 18 || c.DaysLeft != 13 || c.Elapsed() != 0.6 {
		t.Fatalf("current: %+v elapsed %v", c, c.Elapsed())
	}
	c = ClockOf(p, Date(2026, 11, 30))
	if c.ElapsedDays != 30 || c.DaysLeft != 1 {
		t.Fatalf("last day: %+v", c)
	}
	c = ClockOf(p, Date(2026, 12, 1))
	if c.State != StatePast || c.ElapsedDays != 30 || c.DaysLeft != 0 || c.Elapsed() != 1 {
		t.Fatalf("past: %+v", c)
	}
	c = ClockOf(p, Date(2026, 10, 31))
	if c.State != StateFuture || c.ElapsedDays != 0 || c.DaysLeft != 0 || c.Elapsed() != 0 {
		t.Fatalf("future: %+v", c)
	}
	// Month start day 10: November = 10 Nov – 9 Dec.
	c = ClockOf(PeriodOf(Month{2026, time.November}, 10), Date(2026, 12, 9))
	if c.State != StateCurrent || c.ElapsedDays != 30 || c.DaysLeft != 1 {
		t.Fatalf("start day 10: %+v", c)
	}
}

func TestResolveLimit(t *testing.T) {
	sep, oct, nov, dec, jan := Month{2026, 9}, Month{2026, 10}, Month{2026, 11}, Month{2026, 12}, Month{2027, 1}
	rows := []Row{
		{Scope: ScopeOngoing, Month: nov, Amount: i64(60000)},
		{Scope: ScopeOngoing, Month: sep, Amount: i64(55000)},
		{Scope: ScopeSingleMonth, Month: dec, Amount: i64(40000)},
		{Scope: ScopeOngoing, Month: Month{2027, 2}, Amount: nil},
	}
	cases := []struct {
		m     Month
		want  *int64
		scope Scope
	}{
		{Month{2026, 8}, nil, ""},
		{sep, i64(55000), ScopeOngoing},
		{oct, i64(55000), ScopeOngoing},
		{nov, i64(60000), ScopeOngoing},
		{dec, i64(40000), ScopeSingleMonth},
		{jan, i64(60000), ScopeOngoing},
		{Month{2027, 2}, nil, ""},
		{Month{2027, 6}, nil, ""},
	}
	for _, c := range cases {
		got := ResolveLimit(rows, c.m)
		if (got.Amount == nil) != (c.want == nil) || (got.Amount != nil && *got.Amount != *c.want) || got.Scope != c.scope {
			t.Errorf("%s: got %v %q, want %v %q", c.m, deref(got.Amount), got.Scope, deref(c.want), c.scope)
		}
	}
	// A single-month override wins even over a "no limit" ongoing row.
	rows = append(rows, Row{Scope: ScopeSingleMonth, Month: Month{2027, 3}, Amount: i64(100)})
	if got := ResolveLimit(rows, Month{2027, 3}); deref(got.Amount) != 100 || got.Scope != ScopeSingleMonth {
		t.Errorf("override after removal: %+v", got)
	}
}

func TestLineStatus(t *testing.T) {
	cur := ClockOf(PeriodOf(Month{2026, 11}, 1), Date(2026, 11, 18)) // elapsed 0.6
	past := ClockOf(PeriodOf(Month{2026, 10}, 1), Date(2026, 11, 18))
	cases := []struct {
		name string
		line Line
		c    Clock
		want Status
	}{
		{"over", Line{Limit: i64(30000), Spent: 32750}, cur, StatusOver},
		{"ahead", Line{Limit: i64(25000), Spent: 16990}, cur, StatusAhead},
		{"exactly elapsed+5% is not ahead", Line{Limit: i64(100), Spent: 65}, cur, StatusOnTrack},
		{"just above", Line{Limit: i64(1000), Spent: 651}, cur, StatusAhead},
		{"fixed never ahead", Line{Limit: i64(35000), Spent: 29500, Fixed: true}, cur, StatusOnTrack},
		{"past month never ahead", Line{Limit: i64(25000), Spent: 24000}, past, StatusOnTrack},
		{"past over", Line{Limit: i64(25000), Spent: 25001}, past, StatusOver},
		{"limit 0 with spending", Line{Limit: i64(0), Spent: 1}, cur, StatusOver},
		{"limit 0 without spending", Line{Limit: i64(0)}, cur, StatusOnTrack},
		{"no limit", Line{Spent: 999999}, cur, StatusOnTrack},
	}
	for _, c := range cases {
		if got := c.line.Status(c.c); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
	if r := (Line{Limit: i64(0), Spent: 500}).UsedRatio(); *r != 500 {
		t.Errorf("used ratio with limit 0 = %v", *r)
	}
	if (Line{Spent: 5}).UsedRatio() != nil || (Line{Spent: 5}).Left() != nil {
		t.Error("no limit should give nil ratio and left")
	}
	if l := (Line{Limit: i64(30000), Spent: 32750}); *l.Left() != -2750 || l.SegmentAmount() != 30000 {
		t.Errorf("left %d segment %d", *l.Left(), l.SegmentAmount())
	}
}

// The design mockup's November (dev_seed.sql), today = 18 Nov.
func mockupLines() []Line {
	return []Line{
		{Limit: i64(60000), Spent: 24640, SortOrder: 10},
		{Limit: i64(30000), Spent: 32750, SortOrder: 20},
		{Limit: i64(35000), Spent: 29500, Fixed: true, SortOrder: 30},
		{Limit: i64(12000), Spent: 5000, SortOrder: 40},
		{Limit: i64(20000), Spent: 8499, SortOrder: 50},
		{Limit: i64(25000), Spent: 16990, SortOrder: 60},
		{Limit: i64(10000), Spent: 4200, SortOrder: 70},
		{Limit: i64(8000), Spent: 1850, SortOrder: 80},
	}
}

func TestComputeTotalsMockup(t *testing.T) {
	c := ClockOf(PeriodOf(Month{2026, 11}, 1), Date(2026, 11, 18))
	got := ComputeTotals(mockupLines(), c, 2)
	if got.Budget != 200000 || got.Spent != 123429 || got.Left != 76571 || got.FixedLimit != 35000 ||
		got.FlexLimit != 165000 || got.FlexSpent != 93929 || !got.HasBudget {
		t.Fatalf("sums: %+v", got)
	}
	if *got.PerDay != 5500 || *got.UnderPace != 5071 || *got.PaceMarker != 0.67 || got.Status != StatusOnTrack {
		t.Fatalf("pace: perDay %d underPace %d marker %v status %s", *got.PerDay, *got.UnderPace, *got.PaceMarker, got.Status)
	}

	lines := mockupLines()
	SortByUsage(lines)
	want := []int{20, 30, 60, 50, 70, 40, 10, 80}
	for i, l := range lines {
		if l.SortOrder != want[i] {
			t.Fatalf("attention order at %d: %d, want %d", i, l.SortOrder, want[i])
		}
	}
}

func TestComputeTotalsEdges(t *testing.T) {
	cur := ClockOf(PeriodOf(Month{2026, 11}, 1), Date(2026, 11, 18))
	// JPY: no minor units, the daily amount is rounded to whole yen.
	got := ComputeTotals([]Line{{Limit: i64(30000), Spent: 0}}, cur, 0)
	if *got.PerDay != 2308 { // 30000 / 13 = 2307.7
		t.Errorf("JPY per day = %d", *got.PerDay)
	}
	// Ahead of pace, and the daily amount never goes below 0.
	got = ComputeTotals([]Line{{Limit: i64(10000), Spent: 11000}, {Limit: i64(100000), Spent: 0, Fixed: true}}, cur, 2)
	if got.Status != StatusAhead || *got.UnderPace != -5000 || *got.PerDay != 0 {
		t.Errorf("ahead: %+v underPace %d perDay %d", got, *got.UnderPace, *got.PerDay)
	}
	got = ComputeTotals([]Line{{Limit: i64(10000), Spent: 12000}}, cur, 2)
	if got.Status != StatusOver || *got.PerDay != 0 {
		t.Errorf("over: %+v", got)
	}
	// No budget: zeros, no marker.
	got = ComputeTotals([]Line{{Spent: 5000}}, cur, 2)
	if got.HasBudget || got.Budget != 0 || got.Spent != 0 || got.PaceMarker != nil || got.Status != StatusOnTrack {
		t.Errorf("no budget: %+v", got)
	}
	// Past month: no pace numbers, only over / on track.
	past := ClockOf(PeriodOf(Month{2026, 10}, 1), Date(2026, 11, 18))
	got = ComputeTotals([]Line{{Limit: i64(10000), Spent: 9999}}, past, 2)
	if got.PerDay != nil || got.UnderPace != nil || got.PaceMarker != nil || got.Status != StatusOnTrack {
		t.Errorf("past: %+v", got)
	}
}
