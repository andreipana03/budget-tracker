// Package ratelimit is an in-memory token-bucket limiter keyed by strings such as
// "login:ip:203.0.113.7" or "login:id:ana". One API process is enough for now;
// a shared store (Redis) can replace it when there are several.
package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Rule is a bucket: Burst attempts at once, refilled one every Every.
// Rule{Burst: 5, Every: 3 * time.Minute} allows 5 attempts per 15 minutes.
type Rule struct {
	Burst int
	Every time.Duration
}

// PerWindow allows n attempts per window.
func PerWindow(n int, window time.Duration) Rule {
	return Rule{Burst: n, Every: window / time.Duration(n)}
}

type entry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// Limiter holds one bucket per key and forgets buckets that have been idle long
// enough to be full again. The zero value is not usable; call New.
type Limiter struct {
	enabled bool
	now     func() time.Time

	mu        sync.Mutex
	buckets   map[string]*entry
	lastSweep time.Time
}

// New returns a limiter. A disabled limiter allows everything.
func New(enabled bool) *Limiter {
	return &Limiter{enabled: enabled, now: time.Now, buckets: map[string]*entry{}}
}

// WithClock makes the limiter use now (tests).
func (l *Limiter) WithClock(now func() time.Time) *Limiter {
	l.now = now
	return l
}

// Check is one bucket to take an attempt from.
type Check struct {
	Key  string
	Rule Rule
}

// Allow takes one attempt from every check's bucket. When any bucket is empty nothing
// is taken and it returns false with how long to wait (at least a second).
func (l *Limiter) Allow(checks ...Check) (bool, time.Duration) {
	if l == nil || !l.enabled {
		return true, 0
	}
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now)

	reservations := make([]*rate.Reservation, 0, len(checks))
	var wait time.Duration
	for _, c := range checks {
		if c.Rule.Burst <= 0 || c.Rule.Every <= 0 {
			continue
		}
		e, ok := l.buckets[c.Key]
		if !ok {
			e = &entry{lim: rate.NewLimiter(rate.Every(c.Rule.Every), c.Rule.Burst)}
			l.buckets[c.Key] = e
		}
		e.lastSeen = now
		r := e.lim.ReserveN(now, 1)
		reservations = append(reservations, r)
		if d := r.DelayFrom(now); d > wait {
			wait = d
		}
	}
	if wait > 0 {
		for _, r := range reservations {
			r.CancelAt(now)
		}
		if wait < time.Second {
			wait = time.Second
		}
		return false, wait
	}
	return true, 0
}

// sweep drops buckets idle for longer than they need to refill (at most once a minute).
func (l *Limiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < time.Minute {
		return
	}
	l.lastSweep = now
	for key, e := range l.buckets {
		full := time.Duration(float64(time.Second) / float64(e.lim.Limit()) * float64(e.lim.Burst()))
		if now.Sub(e.lastSeen) > full {
			delete(l.buckets, key)
		}
	}
}
