package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// sampleRates inserts made-up weekday rates for [from, to] (EUR 4.97–5.00, USD
// 4.55–4.65, GBP 5.70–5.80), deterministic, without overwriting any existing rate.
// Used offline; the BNR job replaces them with real rates later.
func sampleRates(ctx context.Context, q *store.Queries, from, to time.Time) (int64, error) {
	type row struct {
		Code     string `json:"code"`
		RateDate string `json:"rate_date"`
		Rate     string `json:"rate"`
	}
	ranges := []struct {
		code     string
		lo, span int // in 1/10000 lei
	}{
		{"EUR", 49700, 300},
		{"USD", 45500, 1000},
		{"GBP", 57000, 1000},
	}
	rng := rand.New(rand.NewPCG(4977, 4600))
	var rows []row
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			continue
		}
		for _, r := range ranges {
			v := r.lo + rng.IntN(r.span+1)
			rows = append(rows, row{Code: r.code, RateDate: d.Format(time.DateOnly), Rate: fmt.Sprintf("%d.%04d", v/10000, v%10000)})
		}
	}
	payload, err := json.Marshal(rows)
	if err != nil {
		return 0, err
	}
	return q.SeedInsertSampleRates(ctx, payload)
}
