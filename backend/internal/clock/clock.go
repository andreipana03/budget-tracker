// Package clock lets code ask for "now" so tests can fix it.
package clock

import "time"

// Clock tells the time.
type Clock interface {
	Now() time.Time
}

// Real is the system clock.
type Real struct{}

func (Real) Now() time.Time { return time.Now() }

// Fixed always answers the same instant.
type Fixed struct{ T time.Time }

func (f Fixed) Now() time.Time { return f.T }

// Func adapts a function (handy for tests that move time forward).
type Func func() time.Time

func (f Func) Now() time.Time { return f() }
