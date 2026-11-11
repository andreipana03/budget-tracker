// Package recurring holds the schedule and cost math for subscriptions (recurring
// transactions), docs/database/postgres-schema-and-business-rules.md § 8.
//
// Calendar days are midnight-UTC time.Time values, like everywhere else in the backend.
//
// Occurrence n is always computed from starts_on (starts_on + n × interval), never by
// stepping from the previous occurrence, so a subscription on the 31st falls on the
// last day of shorter months and comes back to the 31st when it can — exactly what
// PostgreSQL's `date + interval 'n months'` does.
package recurring

import (
	"fmt"
	"math/big"
	"time"
)

// Frequency is how often a subscription repeats (the recurrence_frequency enum).
type Frequency string

const (
	Weekly  Frequency = "weekly"
	Monthly Frequency = "monthly"
	Yearly  Frequency = "yearly"
)

// Valid reports whether f is a known frequency.
func (f Frequency) Valid() bool {
	switch f {
	case Weekly, Monthly, Yearly:
		return true
	}
	return false
}

// MaxInterval is the largest interval_count the database accepts.
const MaxInterval = 52

func date(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func day(t time.Time) time.Time { return date(t.Year(), t.Month(), t.Day()) }

func daysIn(y int, m time.Month) int { return date(y, m+1, 0).Day() }

// addMonths adds n months to d, clamping the day to the target month's last day.
func addMonths(d time.Time, n int) time.Time {
	total := d.Year()*12 + int(d.Month()) - 1 + n
	y, m := total/12, time.Month(total%12+1) // years are positive, so plain division is fine
	dd := d.Day()
	if last := daysIn(y, m); dd > last {
		dd = last
	}
	return date(y, m, dd)
}

// Occurrence returns occurrence n (0 = start) of a schedule.
func Occurrence(start time.Time, f Frequency, interval, n int) time.Time {
	start = day(start)
	if interval < 1 {
		interval = 1
	}
	switch f {
	case Weekly:
		return start.AddDate(0, 0, 7*interval*n)
	case Yearly:
		return addMonths(start, 12*interval*n)
	default:
		return addMonths(start, interval*n)
	}
}

// monthsBetween is the number of whole calendar months from a's month to b's month.
func monthsBetween(a, b time.Time) int {
	return (b.Year()-a.Year())*12 + int(b.Month()) - int(a.Month())
}

// IndexOnOrAfter is the smallest n ≥ 0 whose occurrence is on or after d.
func IndexOnOrAfter(start time.Time, f Frequency, interval int, d time.Time) int {
	start, d = day(start), day(d)
	if interval < 1 {
		interval = 1
	}
	if !d.After(start) {
		return 0
	}
	var n int
	switch f {
	case Weekly:
		days := int(d.Sub(start).Hours() / 24)
		step := 7 * interval
		n = days / step
	case Yearly:
		n = monthsBetween(start, d) / (12 * interval)
	default:
		n = monthsBetween(start, d) / interval
	}
	if n < 0 {
		n = 0
	}
	// The estimate never overshoots (its occurrence is in d's month or earlier);
	// step forward until we reach d.
	for Occurrence(start, f, interval, n).Before(d) {
		n++
	}
	return n
}

// NextOnOrAfter is the first occurrence on or after d (never before start).
func NextOnOrAfter(start time.Time, f Frequency, interval int, d time.Time) time.Time {
	return Occurrence(start, f, interval, IndexOnOrAfter(start, f, interval, d))
}

// IndexOf returns n when d is exactly occurrence n of the schedule.
func IndexOf(start time.Time, f Frequency, interval int, d time.Time) (int, bool) {
	n := IndexOnOrAfter(start, f, interval, d)
	if Occurrence(start, f, interval, n).Equal(day(d)) {
		return n, true
	}
	return 0, false
}

// MonthlyFactor is how many times per month a schedule charges, as an exact fraction:
// weekly 52/12, monthly 1, yearly 1/12, each divided by the interval.
func MonthlyFactor(f Frequency, interval int) *big.Rat {
	if interval < 1 {
		interval = 1
	}
	var r *big.Rat
	switch f {
	case Weekly:
		r = big.NewRat(52, 12)
	case Yearly:
		r = big.NewRat(1, 12)
	default:
		r = big.NewRat(1, 1)
	}
	return r.Quo(r, big.NewRat(int64(interval), 1))
}

// MonthlyCost is amount × MonthlyFactor, exact.
func MonthlyCost(amount *big.Rat, f Frequency, interval int) *big.Rat {
	return new(big.Rat).Mul(amount, MonthlyFactor(f, interval))
}

// MonthlyCostMinor is the monthly cost of an integer amount, rounded half away from zero.
func MonthlyCostMinor(amountMinor int64, f Frequency, interval int) int64 {
	return RoundHalfAway(MonthlyCost(new(big.Rat).SetInt64(amountMinor), f, interval))
}

// RoundHalfAway rounds r to the nearest integer, halves away from zero (PostgreSQL's
// round() on numeric). It panics if the result doesn't fit in an int64.
func RoundHalfAway(r *big.Rat) int64 {
	num := new(big.Int).Abs(r.Num())
	den := r.Denom()
	// floor(|r| + 1/2) = floor((2|num| + den) / (2 den))
	twice := new(big.Int).Lsh(num, 1)
	twice.Add(twice, den)
	q := new(big.Int).Quo(twice, new(big.Int).Lsh(den, 1))
	if r.Sign() < 0 {
		q.Neg(q)
	}
	if !q.IsInt64() {
		panic(fmt.Sprintf("recurring: %s does not fit in int64", r.RatString()))
	}
	return q.Int64()
}
