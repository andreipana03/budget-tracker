package ratelimit

import (
	"testing"
	"time"
)

func TestLimiter(t *testing.T) {
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	l := New(true).WithClock(func() time.Time { return now })
	ip := Check{Key: "login:ip:1", Rule: PerWindow(10, time.Minute)}
	id := Check{Key: "login:id:ana", Rule: PerWindow(5, 15*time.Minute)}

	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow(ip, id); !ok {
			t.Fatalf("attempt %d refused", i+1)
		}
	}
	ok, wait := l.Allow(ip, id)
	if ok || wait < time.Minute {
		t.Fatalf("6th attempt: ok=%v wait=%v, want refused for ~3 minutes", ok, wait)
	}
	// A refused attempt takes nothing: the IP bucket still has 5 left for other names.
	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow(ip, Check{Key: "login:id:other", Rule: id.Rule}); !ok {
			t.Fatalf("other identifier attempt %d refused", i+1)
		}
	}
	if ok, _ := l.Allow(ip, Check{Key: "login:id:third", Rule: id.Rule}); ok {
		t.Fatal("IP bucket should be empty")
	}

	now = now.Add(3 * time.Minute)
	if ok, _ := l.Allow(id); !ok {
		t.Fatal("identifier bucket should have refilled one attempt")
	}

	// Idle buckets are forgotten.
	now = now.Add(time.Hour)
	l.Allow(Check{Key: "x", Rule: PerWindow(1, time.Minute)})
	l.mu.Lock()
	n := len(l.buckets)
	l.mu.Unlock()
	if n != 1 {
		t.Fatalf("buckets after sweep = %d, want 1", n)
	}
}

func TestDisabledLimiterAllowsEverything(t *testing.T) {
	l := New(false)
	for i := 0; i < 100; i++ {
		if ok, _ := l.Allow(Check{Key: "k", Rule: PerWindow(1, time.Hour)}); !ok {
			t.Fatal("disabled limiter refused")
		}
	}
	var nilLimiter *Limiter
	if ok, _ := nilLimiter.Allow(Check{Key: "k", Rule: PerWindow(1, time.Hour)}); !ok {
		t.Fatal("nil limiter refused")
	}
}
