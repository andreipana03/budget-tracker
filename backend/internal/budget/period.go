// Package budget holds budget-month math: which period a month covers, limits, the
// pace numbers and statuses (docs/database/postgres-schema-and-business-rules.md § 7,
// docs/design/ui-design-system-and-screen-specs.md § 3).
//
// Calendar days are time.Time values at midnight UTC everywhere (that's what pgx
// returns for `date`), so day arithmetic never crosses a DST change.
package budget

import (
	"fmt"
	"time"
)

// Date returns the calendar day y-m-d as midnight UTC.
func Date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// DayOf drops the time of day and zone from t, keeping its calendar day as seen in t's zone.
func DayOf(t time.Time) time.Time {
	return Date(t.Year(), t.Month(), t.Day())
}

// Today is the calendar day it is now in loc (a household's time zone).
func Today(now time.Time, loc *time.Location) time.Time {
	return DayOf(now.In(loc))
}

// DaysBetween is the number of days from a to b (b − a), both calendar days.
func DaysBetween(a, b time.Time) int {
	return int(b.Sub(a).Hours() / 24)
}

// Month is a budget month, named after the calendar month its period starts in.
type Month struct {
	Year  int
	Month time.Month
}

// ParseMonth reads "2026-11".
func ParseMonth(s string) (Month, error) {
	t, err := time.Parse("2006-01", s)
	if err != nil {
		return Month{}, fmt.Errorf("month %q: want YYYY-MM", s)
	}
	return Month{Year: t.Year(), Month: t.Month()}, nil
}

// String formats the month as "2026-11".
func (m Month) String() string { return fmt.Sprintf("%04d-%02d", m.Year, int(m.Month)) }

// First is the 1st of the month (what budgets.month stores).
func (m Month) First() time.Time { return Date(m.Year, m.Month, 1) }

// Add moves n months forward (or back when n < 0).
func (m Month) Add(n int) Month {
	t := m.First().AddDate(0, n, 0)
	return Month{Year: t.Year(), Month: t.Month()}
}

// Before reports whether m is earlier than o.
func (m Month) Before(o Month) bool { return m.First().Before(o.First()) }

// MonthsBetween is how many months o is after m.
func (m Month) MonthsBetween(o Month) int {
	return (o.Year-m.Year)*12 + int(o.Month) - int(m.Month)
}

// CalendarMonth is the calendar month a day falls in.
func CalendarMonth(day time.Time) Month { return Month{Year: day.Year(), Month: day.Month()} }

// MonthContaining is the budget month whose period contains day. With month start
// day 10, 5 Dec belongs to the November budget month.
func MonthContaining(day time.Time, startDay int) Month {
	m := CalendarMonth(day)
	if day.Day() < startDay {
		return m.Add(-1)
	}
	return m
}

// Period is the span of days a budget month covers: [Start, EndBefore).
type Period struct {
	Month     Month
	Start     time.Time
	EndBefore time.Time
}

// PeriodOf is [1st + (startDay − 1), next 1st + (startDay − 1)). startDay is 1–28, so
// the start always exists in every month.
func PeriodOf(m Month, startDay int) Period {
	offset := startDay - 1
	return Period{
		Month:     m,
		Start:     m.First().AddDate(0, 0, offset),
		EndBefore: m.Add(1).First().AddDate(0, 0, offset),
	}
}

// Days is how many days the period has.
func (p Period) Days() int { return DaysBetween(p.Start, p.EndBefore) }

// Contains reports whether day is inside the period.
func (p Period) Contains(day time.Time) bool {
	return !day.Before(p.Start) && day.Before(p.EndBefore)
}

// Last is the period's last day.
func (p Period) Last() time.Time { return p.EndBefore.AddDate(0, 0, -1) }
