package budget

import (
	"testing"
	"time"
)

func TestPeriodOf(t *testing.T) {
	nov := Month{2026, time.November}
	p := PeriodOf(nov, 1)
	if !p.Start.Equal(Date(2026, 11, 1)) || !p.EndBefore.Equal(Date(2026, 12, 1)) || p.Days() != 30 {
		t.Fatalf("start day 1: %v – %v (%d days)", p.Start, p.EndBefore, p.Days())
	}
	p = PeriodOf(nov, 10)
	if !p.Start.Equal(Date(2026, 11, 10)) || !p.EndBefore.Equal(Date(2026, 12, 10)) || !p.Last().Equal(Date(2026, 12, 9)) {
		t.Fatalf("start day 10: %v – %v", p.Start, p.EndBefore)
	}
	p = PeriodOf(Month{2027, time.February}, 1)
	if p.Days() != 28 {
		t.Fatalf("February 2027 has %d days", p.Days())
	}
}

func TestMonthContaining(t *testing.T) {
	cases := []struct {
		day      time.Time
		startDay int
		want     string
	}{
		{Date(2026, 11, 18), 1, "2026-11"},
		{Date(2026, 12, 5), 10, "2026-11"},
		{Date(2026, 12, 10), 10, "2026-12"},
		{Date(2026, 1, 3), 10, "2025-12"},
	}
	for _, c := range cases {
		if got := MonthContaining(c.day, c.startDay).String(); got != c.want {
			t.Errorf("MonthContaining(%v, %d) = %s, want %s", c.day, c.startDay, got, c.want)
		}
	}
}

func TestParseMonthAndAdd(t *testing.T) {
	m, err := ParseMonth("2026-11")
	if err != nil {
		t.Fatal(err)
	}
	if m.Add(2).String() != "2027-01" || m.Add(-11).String() != "2025-12" {
		t.Fatalf("Add: %s %s", m.Add(2), m.Add(-11))
	}
	if m.MonthsBetween(Month{2027, time.March}) != 4 {
		t.Fatal("MonthsBetween")
	}
	if _, err := ParseMonth("2026-13"); err == nil {
		t.Fatal("ParseMonth accepted month 13")
	}
}

func TestToday(t *testing.T) {
	bucharest, _ := time.LoadLocation("Europe/Bucharest")
	// 22:30 UTC on 17 Nov is already 18 Nov in Bucharest (UTC+2).
	now := time.Date(2026, 11, 17, 22, 30, 0, 0, time.UTC)
	if got := Today(now, bucharest); !got.Equal(Date(2026, 11, 18)) {
		t.Fatalf("Today = %v", got)
	}
}
