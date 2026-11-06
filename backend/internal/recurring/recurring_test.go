package recurring

import (
	"math/big"
	"testing"
	"time"
)

func d(y int, m time.Month, dd int) time.Time { return time.Date(y, m, dd, 0, 0, 0, 0, time.UTC) }

func TestOccurrenceMonthEndNeverDrifts(t *testing.T) {
	start := d(2026, time.January, 31)
	want := []time.Time{
		d(2026, time.January, 31),
		d(2026, time.February, 28),
		d(2026, time.March, 31),
		d(2026, time.April, 30),
		d(2026, time.May, 31),
		d(2026, time.June, 30),
	}
	for n, w := range want {
		if got := Occurrence(start, Monthly, 1, n); !got.Equal(w) {
			t.Errorf("occurrence %d = %s, want %s", n, got.Format(time.DateOnly), w.Format(time.DateOnly))
		}
	}
	// Every 2 months from 31 Jan: 31 Mar, not 28 Mar.
	if got := Occurrence(start, Monthly, 2, 1); !got.Equal(d(2026, time.March, 31)) {
		t.Errorf("31 Jan + 2 months = %s", got.Format(time.DateOnly))
	}
	// Leap year February.
	if got := Occurrence(d(2028, time.January, 31), Monthly, 1, 1); !got.Equal(d(2028, time.February, 29)) {
		t.Errorf("31 Jan 2028 + 1 month = %s", got.Format(time.DateOnly))
	}
	// Crossing a year boundary.
	if got := Occurrence(d(2026, time.November, 30), Monthly, 3, 1); !got.Equal(d(2027, time.February, 28)) {
		t.Errorf("30 Nov + 3 months = %s", got.Format(time.DateOnly))
	}
}

func TestOccurrenceYearlyLeapDay(t *testing.T) {
	start := d(2028, time.February, 29)
	cases := map[int]time.Time{0: start, 1: d(2029, time.February, 28), 4: d(2032, time.February, 29)}
	for n, w := range cases {
		if got := Occurrence(start, Yearly, 1, n); !got.Equal(w) {
			t.Errorf("yearly occurrence %d = %s, want %s", n, got.Format(time.DateOnly), w.Format(time.DateOnly))
		}
	}
	if got := Occurrence(start, Yearly, 2, 1); !got.Equal(d(2030, time.February, 28)) {
		t.Errorf("every 2 years = %s", got.Format(time.DateOnly))
	}
}

func TestOccurrenceWeekly(t *testing.T) {
	start := d(2026, time.December, 28)
	if got := Occurrence(start, Weekly, 1, 1); !got.Equal(d(2027, time.January, 4)) {
		t.Errorf("weekly = %s", got.Format(time.DateOnly))
	}
	if got := Occurrence(start, Weekly, 2, 3); !got.Equal(d(2027, time.February, 8)) {
		t.Errorf("every 2 weeks ×3 = %s", got.Format(time.DateOnly))
	}
}

func TestNextOnOrAfter(t *testing.T) {
	tests := []struct {
		name     string
		start    time.Time
		f        Frequency
		interval int
		on       time.Time
		want     time.Time
	}{
		{"before start", d(2026, 11, 20), Monthly, 1, d(2026, 11, 6), d(2026, 11, 20)},
		{"on start", d(2026, 11, 20), Monthly, 1, d(2026, 11, 20), d(2026, 11, 20)},
		{"31st in February", d(2026, 1, 31), Monthly, 1, d(2026, 2, 10), d(2026, 2, 28)},
		{"31st after February", d(2026, 1, 31), Monthly, 1, d(2026, 3, 1), d(2026, 3, 31)},
		{"same day of a later month", d(2026, 1, 15), Monthly, 1, d(2026, 6, 15), d(2026, 6, 15)},
		{"day after", d(2026, 1, 15), Monthly, 1, d(2026, 6, 16), d(2026, 7, 15)},
		{"quarterly", d(2026, 1, 15), Monthly, 3, d(2026, 5, 1), d(2026, 7, 15)},
		{"weekly", d(2026, 11, 2), Weekly, 1, d(2026, 11, 6), d(2026, 11, 9)},
		{"weekly exact", d(2026, 11, 2), Weekly, 1, d(2026, 11, 16), d(2026, 11, 16)},
		{"fortnightly", d(2026, 11, 2), Weekly, 2, d(2026, 11, 10), d(2026, 11, 16)},
		{"yearly", d(2026, 3, 3), Yearly, 1, d(2026, 11, 6), d(2027, 3, 3)},
		{"yearly leap", d(2028, 2, 29), Yearly, 1, d(2029, 1, 1), d(2029, 2, 28)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NextOnOrAfter(tt.start, tt.f, tt.interval, tt.on); !got.Equal(tt.want) {
				t.Fatalf("got %s, want %s", got.Format(time.DateOnly), tt.want.Format(time.DateOnly))
			}
		})
	}
}

func TestNextOnOrAfterMatchesBruteForce(t *testing.T) {
	starts := []time.Time{d(2026, 1, 31), d(2026, 1, 29), d(2028, 2, 29), d(2026, 5, 1), d(2026, 12, 30)}
	for _, start := range starts {
		for _, f := range []Frequency{Weekly, Monthly, Yearly} {
			for _, interval := range []int{1, 2, 3, 5} {
				for on := start.AddDate(0, 0, -3); on.Before(start.AddDate(3, 0, 0)); on = on.AddDate(0, 0, 1) {
					n := 0
					for Occurrence(start, f, interval, n).Before(on) {
						n++
					}
					if got := IndexOnOrAfter(start, f, interval, on); got != n {
						t.Fatalf("%s %s×%d on %s: index %d, want %d", start.Format(time.DateOnly), f, interval,
							on.Format(time.DateOnly), got, n)
					}
				}
			}
		}
	}
}

func TestIndexOf(t *testing.T) {
	start := d(2026, 1, 31)
	if n, ok := IndexOf(start, Monthly, 1, d(2026, 4, 30)); !ok || n != 3 {
		t.Fatalf("IndexOf 30 Apr = %d, %v", n, ok)
	}
	if _, ok := IndexOf(start, Monthly, 1, d(2026, 4, 29)); ok {
		t.Fatal("29 Apr is not an occurrence")
	}
	if n, ok := IndexOf(start, Monthly, 1, start); !ok || n != 0 {
		t.Fatalf("start = %d, %v", n, ok)
	}
	if _, ok := IndexOf(start, Monthly, 1, d(2025, 12, 31)); ok {
		t.Fatal("before start is not an occurrence")
	}
}

func TestMonthlyCost(t *testing.T) {
	tests := []struct {
		amount   int64
		f        Frequency
		interval int
		want     int64
	}{
		{3999, Monthly, 1, 3999},
		{1000, Weekly, 1, 4333},  // 1000 × 52/12 = 4333.33
		{1500, Weekly, 1, 6500},  // exactly 6500
		{1000, Weekly, 2, 2167},  // 2166.67
		{12000, Yearly, 1, 1000}, //
		{6, Yearly, 1, 1},        // 0.5 → 1 (half away from zero)
		{18, Yearly, 1, 2},       // 1.5 → 2
		{30, Yearly, 1, 3},       // 2.5 → 3
		{5000, Monthly, 2, 2500},
		{4999, Monthly, 2, 2500}, // 2499.5 → 2500
	}
	for _, tt := range tests {
		if got := MonthlyCostMinor(tt.amount, tt.f, tt.interval); got != tt.want {
			t.Errorf("%d %s×%d = %d, want %d", tt.amount, tt.f, tt.interval, got, tt.want)
		}
	}
}

func TestRoundHalfAway(t *testing.T) {
	cases := []struct {
		r    *big.Rat
		want int64
	}{
		{big.NewRat(5, 2), 3},
		{big.NewRat(-5, 2), -3},
		{big.NewRat(7, 3), 2},
		{big.NewRat(-7, 3), -2},
		{big.NewRat(0, 1), 0},
		{big.NewRat(1, 2), 1},
		{big.NewRat(-1, 2), -1},
		{big.NewRat(499999, 1000000), 0},
	}
	for _, c := range cases {
		if got := RoundHalfAway(c.r); got != c.want {
			t.Errorf("round(%s) = %d, want %d", c.r.RatString(), got, c.want)
		}
	}
}
