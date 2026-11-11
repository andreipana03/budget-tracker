package insights

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/budget"
)

var (
	d       = budget.Date
	catA    = uuid.MustParse("00000000-0000-7000-8000-00000000000a")
	catB    = uuid.MustParse("00000000-0000-7000-8000-00000000000b")
	catC    = uuid.MustParse("00000000-0000-7000-8000-00000000000c")
	byOrder = Order(func(id uuid.UUID) int {
		return map[uuid.UUID]int{catA: 10, catB: 20, catC: 30}[id]
	})
)

func span(a, b time.Time) Span { return Span{a, b} }

func eqSpan(t *testing.T, name string, got, want Span) {
	t.Helper()
	if !got.Start.Equal(want.Start) || !got.EndBefore.Equal(want.EndBefore) {
		t.Errorf("%s = %s – %s, want %s – %s", name, got.Start.Format(time.DateOnly), got.EndBefore.Format(time.DateOnly),
			want.Start.Format(time.DateOnly), want.EndBefore.Format(time.DateOnly))
	}
}

func TestPlanWeek(t *testing.T) {
	l := Plan(Week, d(2026, 11, 18), 1) // a Wednesday
	eqSpan(t, "range", l.Range, span(d(2026, 11, 16), d(2026, 11, 23)))
	eqSpan(t, "so far", l.SoFar, span(d(2026, 11, 16), d(2026, 11, 19)))
	eqSpan(t, "previous", l.Previous, span(d(2026, 11, 9), d(2026, 11, 12)))
	eqSpan(t, "previous unit", l.PreviousUnit, span(d(2026, 11, 9), d(2026, 11, 16)))
	if len(l.Bars) != 7 || l.Current != 2 || !l.ComparedTo.Equal(d(2026, 11, 9)) || l.Monthly {
		t.Fatalf("bars %d current %d comparedTo %v", len(l.Bars), l.Current, l.ComparedTo)
	}
	// Sunday belongs to the week that started the Monday before.
	l = Plan(Week, d(2026, 11, 22), 1)
	eqSpan(t, "sunday range", l.Range, span(d(2026, 11, 16), d(2026, 11, 23)))
	if l.Current != 6 {
		t.Errorf("sunday current = %d", l.Current)
	}
}

func TestPlanMonth(t *testing.T) {
	// Month start day 10: on 5 Nov the current budget month is October (10 Oct – 9 Nov).
	l := Plan(Month, d(2026, 11, 5), 10)
	eqSpan(t, "range", l.Range, span(d(2026, 10, 10), d(2026, 11, 10)))
	eqSpan(t, "previous", l.Previous, span(d(2026, 9, 10), d(2026, 10, 7)))
	if len(l.Bars) != 31 || l.Current != 26 || !l.ComparedTo.Equal(d(2026, 9, 10)) {
		t.Fatalf("bars %d current %d comparedTo %v", len(l.Bars), l.Current, l.ComparedTo)
	}
	eqSpan(t, "fetch", l.Fetch(), span(d(2026, 9, 10), d(2026, 11, 10)))
	// The previous month is shorter: the comparison stops at its end.
	l = Plan(Month, d(2027, 3, 31), 1)
	eqSpan(t, "clipped previous", l.Previous, span(d(2027, 2, 1), d(2027, 3, 1)))
}

func TestPlanMonths(t *testing.T) {
	l := Plan(SixMonths, d(2026, 11, 18), 1)
	eqSpan(t, "six months", l.Range, span(d(2026, 6, 1), d(2026, 12, 1)))
	eqSpan(t, "so far", l.SoFar, span(d(2026, 11, 1), d(2026, 11, 19)))
	eqSpan(t, "previous", l.Previous, span(d(2026, 10, 1), d(2026, 10, 19)))
	if len(l.Bars) != 6 || l.Current != 5 || !l.Monthly || !l.ComparedTo.Equal(d(2026, 10, 1)) {
		t.Fatalf("bars %d current %d", len(l.Bars), l.Current)
	}
	l = Plan(Year, d(2026, 11, 18), 10) // current = 10 Nov – 9 Dec
	eqSpan(t, "year", l.Range, span(d(2025, 12, 10), d(2026, 12, 10)))
	eqSpan(t, "last bar", l.Bars[11], span(d(2026, 11, 10), d(2026, 12, 10)))
	if len(l.Bars) != 12 || l.Current != 11 {
		t.Fatalf("year bars %d current %d", len(l.Bars), l.Current)
	}
}

func sp(day time.Time, cat uuid.UUID, amount int64) Spend { return Spend{day, cat, amount} }

func TestComputations(t *testing.T) {
	l := Plan(SixMonths, d(2026, 11, 18), 1)
	spends := []Spend{
		sp(d(2026, 5, 31), catA, 99999), // outside the range
		sp(d(2026, 7, 3), catA, 100000),
		sp(d(2026, 9, 3), catA, 150000),
		sp(d(2026, 9, 4), catB, 50000),
		sp(d(2026, 10, 2), catA, 40000), // before 19 Oct: in the comparison
		sp(d(2026, 10, 2), catB, 10000),
		sp(d(2026, 10, 25), catB, 70000), // after the same point
		sp(d(2026, 11, 3), catA, 10000),
		sp(d(2026, 11, 3), catB, 30000),
		sp(d(2026, 11, 18), catC, 15000),
	}
	bars := l.BarTotals(spends)
	want := []int64{0, 100000, 0, 200000, 120000, 55000}
	for i := range want {
		if bars[i] != want[i] {
			t.Fatalf("bars = %v, want %v", bars, want)
		}
	}
	if avg := Average(bars, l.Current); avg == nil || *avg != 140000 {
		t.Errorf("average = %v", avg)
	}
	if Average([]int64{0, 5, 0, 7}, 3) != nil {
		t.Error("average needs 2 bars with data")
	}

	h := l.HeadlineOf(spends)
	if h.Current != 55000 || h.Previous == nil || *h.Previous != 50000 || *h.Change != 0.1 {
		t.Errorf("headline = %+v", h)
	}

	cats := l.ByCategory(spends, byOrder)
	if len(cats) != 3 || cats[0].Category != catA || cats[0].Spent != 300000 || cats[1].Spent != 160000 ||
		cats[2].Category != catC || cats[0].Share != 300000.0/475000 {
		t.Errorf("by category = %+v", cats)
	}

	// A: 400 → 100 lei (−75%, 300 lei); B: 100 → 300 lei (+200%, 200 lei). A wins.
	ch := l.BiggestChange(spends, 2, byOrder)
	if ch == nil || ch.Category != catA || ch.Current != 10000 || ch.Previous != 40000 || ch.Ratio != -0.75 {
		t.Fatalf("biggest change = %+v", ch)
	}
	if want := []int64{0, 100000, 0, 150000, 40000, 10000}; len(ch.Spark) != 6 || ch.Spark[3] != want[3] || ch.Spark[5] != want[5] {
		t.Errorf("spark = %v", ch.Spark)
	}

	day := l.BiggestDay(spends, byOrder)
	if day == nil || !day.Date.Equal(d(2026, 9, 3)) || day.Spent != 150000 || len(day.Top) != 1 || day.Top[0] != catA {
		t.Errorf("biggest day = %+v", day)
	}
}

func TestHighlightsThresholds(t *testing.T) {
	l := Plan(Month, d(2026, 11, 18), 1)
	cases := []struct {
		name      string
		prev, cur int64
		want      bool
	}{
		{"enough", 10000, 12000, true}, // +20%, 20 lei
		{"too small in lei", 10000, 11999, false},
		{"previous under 10 lei", 999, 5000, false},
		{"under 10%", 30000, 32500, false}, // +8.3%, 25 lei
		{"drop", 50000, 0, true},
		{"exactly 10%", 20000, 22000, true},
	}
	for _, c := range cases {
		spends := []Spend{sp(d(2026, 10, 5), catA, c.prev)}
		if c.cur > 0 {
			spends = append(spends, sp(d(2026, 11, 5), catA, c.cur))
		}
		if got := l.BiggestChange(spends, 2, byOrder) != nil; got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
	// JPY has no minor units: 20 yen is enough.
	if l.BiggestChange([]Spend{sp(d(2026, 10, 5), catA, 100), sp(d(2026, 11, 5), catA, 120)}, 0, byOrder) == nil {
		t.Error("JPY thresholds")
	}
}

func TestBiggestDayTies(t *testing.T) {
	l := Plan(Week, d(2026, 11, 18), 1)
	spends := []Spend{
		sp(d(2026, 11, 16), catA, 5000),
		sp(d(2026, 11, 17), catA, 2000),
		sp(d(2026, 11, 17), catB, 2000),
		sp(d(2026, 11, 17), catC, 1000),
	}
	day := l.BiggestDay(spends, byOrder)
	// Same total on Mon and Tue: the most recent wins; no category reaches 50% → top two.
	if day == nil || !day.Date.Equal(d(2026, 11, 17)) || len(day.Top) != 2 || day.Top[0] != catA || day.Top[1] != catB {
		t.Fatalf("biggest day = %+v", day)
	}
	if l.BiggestDay(nil, byOrder) != nil {
		t.Error("no spending, no biggest day")
	}
}

func TestHeadlineWithoutPrevious(t *testing.T) {
	l := Plan(Week, d(2026, 11, 18), 1)
	h := l.HeadlineOf([]Spend{sp(d(2026, 11, 17), catA, 500)})
	if h.Current != 500 || h.Previous != nil || h.Change != nil {
		t.Errorf("headline = %+v", h)
	}
	// Previous week had data, but only after the same point: previous = 0, no ratio.
	h = l.HeadlineOf([]Spend{sp(d(2026, 11, 17), catA, 500), sp(d(2026, 11, 14), catA, 900)})
	if h.Previous == nil || *h.Previous != 0 || h.Change != nil {
		t.Errorf("headline = %+v", h)
	}
}

func TestProject(t *testing.T) {
	p := budget.PeriodOf(budget.Month{Year: 2026, Month: 11}, 1)
	c := budget.ClockOf(p, d(2026, 11, 18))
	// fixed: max(29500, 35000) + 93929 × 30 / 18 = 35000 + 156548.3
	if v := Project(29500, 35000, 93929, c); v == nil || *v != 191548 {
		t.Errorf("projection = %v", v)
	}
	if Project(0, 0, 100, budget.ClockOf(p, d(2026, 11, 2))) != nil {
		t.Error("no projection before day 3")
	}
	if v := Project(0, 0, 300, budget.ClockOf(p, d(2026, 11, 3))); v == nil || *v != 3000 {
		t.Errorf("day 3 projection = %v", v)
	}
	if Project(0, 0, 100, budget.ClockOf(p, d(2026, 12, 3))) != nil {
		t.Error("no projection for a past month")
	}
}
