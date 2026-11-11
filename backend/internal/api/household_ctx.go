package api

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// householdInfo is a household plus what "today" and "this month" mean for it.
type householdInfo struct {
	Row           store.Household
	ID            uuid.UUID
	HomeCurrency  string
	Location      *time.Location
	MonthStartDay int
	// Today is the household's calendar day (midnight UTC).
	Today        time.Time
	CurrentMonth budget.Month
}

// Period returns the budget period of month m for this household.
func (h householdInfo) Period(m budget.Month) budget.Period {
	return budget.PeriodOf(m, h.MonthStartDay)
}

// loadHousehold reads a household and works out its today and current budget month.
// Pass s.q, or store.New(tx) inside a transaction.
func (s *Server) loadHousehold(ctx context.Context, q *store.Queries, id uuid.UUID) (householdInfo, error) {
	row, err := q.GetHousehold(ctx, id)
	if dbx.IsNoRows(err) {
		return householdInfo{}, apierr.NotFound("household")
	}
	if err != nil {
		return householdInfo{}, fmt.Errorf("load household: %w", err)
	}
	loc, err := time.LoadLocation(row.Timezone)
	if err != nil {
		loc = time.UTC // the API validates zones on write; this is only a fallback
	}
	today := budget.Today(s.clock.Now(), loc)
	return householdInfo{
		Row:           row,
		ID:            row.ID,
		HomeCurrency:  row.HomeCurrency,
		Location:      loc,
		MonthStartDay: int(row.MonthStartDay),
		Today:         today,
		CurrentMonth:  budget.MonthContaining(today, int(row.MonthStartDay)),
	}, nil
}

// monthOrCurrent parses an optional "YYYY-MM" query value (422 when malformed).
func monthOrCurrent(h householdInfo, value *string) (budget.Month, error) {
	if value == nil || *value == "" {
		return h.CurrentMonth, nil
	}
	m, err := budget.ParseMonth(*value)
	if err != nil {
		return budget.Month{}, apierr.Validation(apierr.Field("month", "invalid_format", "Use YYYY-MM."))
	}
	return m, nil
}
