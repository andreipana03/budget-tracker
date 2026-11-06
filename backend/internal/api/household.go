package api

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// GetHousehold returns the signed-in user's household settings.
func (s *Server) GetHousehold(ctx context.Context, request gen.GetHouseholdRequestObject) (gen.GetHouseholdResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.ledgerHousehold(ctx, s.q, p)
	if err != nil {
		return nil, err
	}
	return gen.GetHousehold200JSONResponse(out), nil
}

// UpdateHousehold changes the name, home currency, time zone or month start day.
func (s *Server) UpdateHousehold(ctx context.Context, request gen.UpdateHouseholdRequestObject) (gen.UpdateHouseholdResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Household
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		var errs []apierr.FieldError
		params := store.LedgerUpdateHouseholdParams{ID: h.ID}
		if body.Name != nil {
			params.Name = ptr(ledgerText("name", *body.Name, 1, 60, &errs))
		}
		if body.Timezone != nil {
			ok, err := q.LedgerTimezoneExists(ctx, body.Timezone)
			if err != nil {
				return fmt.Errorf("check time zone: %w", err)
			}
			if ok { // Go must know it too, or "today" would silently fall back to UTC
				_, lerr := time.LoadLocation(*body.Timezone)
				ok = lerr == nil
			}
			if !ok {
				errs = append(errs, apierr.Field("timezone", "invalid", "This isn't a time zone we know."))
			}
			params.Timezone = body.Timezone
		}
		if body.MonthStartDay != nil {
			if d := *body.MonthStartDay; d < 1 || d > 28 {
				errs = append(errs, apierr.Field("monthStartDay", "out_of_range", "Pick a day from 1 to 28."))
			} else {
				params.MonthStartDay = ptr(int16(d))
			}
		}
		currencyChange := body.HomeCurrency != nil && *body.HomeCurrency != h.HomeCurrency
		if currencyChange {
			if _, err := s.ledgerCurrency(ctx, q, "homeCurrency", *body.HomeCurrency, &errs); err != nil {
				return err
			}
			params.HomeCurrency = body.HomeCurrency
		}
		if err := ledgerErrs(errs); err != nil {
			return err
		}
		if currencyChange {
			has, err := q.LedgerHouseholdHasMoneyData(ctx, h.ID)
			if err != nil {
				return fmt.Errorf("check money data: %w", err)
			}
			if has {
				return apierr.Conflict("home_currency_locked",
					"The home currency can't change once you have transactions or subscriptions.")
			}
		}
		if _, err := q.LedgerUpdateHousehold(ctx, params); err != nil {
			return fmt.Errorf("update household: %w", err)
		}
		out, err = s.ledgerHousehold(ctx, q, p)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.UpdateHousehold200JSONResponse(out), nil
}

func (s *Server) ledgerHousehold(ctx context.Context, q *store.Queries, p Principal) (gen.Household, error) {
	h, err := s.loadHousehold(ctx, q, p.HouseholdID)
	if err != nil {
		return gen.Household{}, err
	}
	has, err := q.LedgerHouseholdHasMoneyData(ctx, h.ID)
	if err != nil {
		return gen.Household{}, fmt.Errorf("check money data: %w", err)
	}
	return gen.Household{
		Id:                    h.ID,
		Name:                  h.Row.Name,
		HomeCurrency:          h.HomeCurrency,
		Timezone:              h.Row.Timezone,
		MonthStartDay:         h.MonthStartDay,
		CanChangeHomeCurrency: !has,
		Today:                 apiDate(h.Today),
		CurrentMonth:          h.CurrentMonth.String(),
	}, nil
}
