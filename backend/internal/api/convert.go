package api

import (
	"fmt"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
)

// Small conversions between the generated API types and the store/domain types.
// Calendar days are midnight-UTC time.Time values (see package budget).

func apiDate(t time.Time) openapi_types.Date { return openapi_types.Date{Time: t} }

func apiDatePtr(t *time.Time) *openapi_types.Date {
	if t == nil {
		return nil
	}
	d := apiDate(*t)
	return &d
}

// dayFromAPI turns an API date into a midnight-UTC calendar day.
func dayFromAPI(d openapi_types.Date) time.Time { return budget.DayOf(d.Time) }

func dayFromAPIPtr(d *openapi_types.Date) *time.Time {
	if d == nil {
		return nil
	}
	t := dayFromAPI(*d)
	return &t
}

// numericString renders a numeric (exchange rate) without passing through float64.
func numericString(n pgtype.Numeric) string {
	if !n.Valid {
		return ""
	}
	v, err := n.Value()
	if err != nil || v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// maxAmountMinor caps every amount the API accepts: 10^15 minor units (10 trillion lei).
// Far above any real budget, and it keeps sums and the subscription cost maths (× 52)
// well inside int64.
const maxAmountMinor int64 = 1_000_000_000_000_000

// amountTooLarge reports whether |v| is above maxAmountMinor.
func amountTooLarge(v int64) bool { return v > maxAmountMinor || v < -maxAmountMinor }

// tooLargeField is the field error for amountTooLarge.
func tooLargeField(field string) apierr.FieldError {
	return apierr.Field(field, "too_large", "This amount is too large.")
}

func ptr[T any](v T) *T { return &v }

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}
