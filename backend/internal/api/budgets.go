package api

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// GetBudgets returns limits, spending and pace for every expense category in a month.
func (s *Server) GetBudgets(ctx context.Context, request gen.GetBudgetsRequestObject) (gen.GetBudgetsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}
	m, err := monthOrCurrent(h, request.Params.Month)
	if err != nil {
		return nil, err
	}
	month, err := s.screensBudgetMonth(ctx, s.q, h, m)
	if err != nil {
		return nil, err
	}
	return gen.GetBudgets200JSONResponse(month.API), nil
}

// SetBudgets sets (or removes) monthly limits for several categories in one transaction.
func (s *Server) SetBudgets(ctx context.Context, request gen.SetBudgetsRequestObject) (gen.SetBudgetsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	body := request.Body
	if body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	var fields []apierr.FieldError
	m, err := budget.ParseMonth(body.Month)
	if err != nil {
		fields = append(fields, apierr.Field("month", "invalid_format", "Use YYYY-MM."))
	}
	if !body.Scope.Valid() {
		fields = append(fields, apierr.Field("scope", "invalid", "Use ongoing or single_month."))
	}
	if len(body.Items) == 0 {
		fields = append(fields, apierr.Field("items", "required", "Add at least one category."))
	}
	seen := map[uuid.UUID]bool{}
	ids := make([]uuid.UUID, 0, len(body.Items))
	for i, it := range body.Items {
		if seen[it.CategoryId] {
			fields = append(fields, apierr.Field(fmt.Sprintf("items[%d].categoryId", i), "duplicate", "This category is listed twice."))
		}
		seen[it.CategoryId] = true
		ids = append(ids, it.CategoryId)
		if it.AmountMinor != nil && *it.AmountMinor < 0 {
			fields = append(fields, apierr.Field(fmt.Sprintf("items[%d].amountMinor", i), "invalid", "A limit can't be negative."))
		} else if it.AmountMinor != nil && amountTooLarge(*it.AmountMinor) {
			fields = append(fields, tooLargeField(fmt.Sprintf("items[%d].amountMinor", i)))
		}
	}

	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}
	cats, err := s.q.ScreensCategoriesByIDs(ctx, store.ScreensCategoriesByIDsParams{HouseholdID: h.ID, Ids: ids})
	if err != nil {
		return nil, fmt.Errorf("load categories: %w", err)
	}
	found := make(map[uuid.UUID]store.ScreensCategoriesByIDsRow, len(cats))
	for _, c := range cats {
		found[c.ID] = c
	}
	for i, it := range body.Items {
		field := fmt.Sprintf("items[%d].categoryId", i)
		c, ok := found[it.CategoryId]
		switch {
		case !ok:
			fields = append(fields, apierr.Field(field, "not_found", "This category doesn't exist."))
		case c.Kind != store.EntryKindExpense:
			fields = append(fields, apierr.Field(field, "not_expense", "Only expense categories can have a budget."))
		case c.ArchivedAt != nil:
			fields = append(fields, apierr.Field(field, "archived", "This category is archived."))
		}
	}
	if len(fields) > 0 {
		return nil, apierr.Validation(fields...)
	}

	var createdBy *uuid.UUID
	if p.UserID != uuid.Nil {
		createdBy = &p.UserID
	}
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		for _, it := range body.Items {
			if body.Scope == gen.SetBudgetsRequestScopeSingleMonth && it.AmountMinor == nil {
				if err := q.ScreensDeleteSingleMonthBudget(ctx, store.ScreensDeleteSingleMonthBudgetParams{
					HouseholdID: h.ID, CategoryID: it.CategoryId, Month: m.First(),
				}); err != nil {
					return fmt.Errorf("remove override: %w", err)
				}
				continue
			}
			if err := q.ScreensUpsertBudget(ctx, store.ScreensUpsertBudgetParams{
				HouseholdID: h.ID,
				CategoryID:  it.CategoryId,
				Scope:       store.BudgetScope(body.Scope),
				Month:       m.First(),
				AmountMinor: it.AmountMinor,
				CreatedBy:   createdBy,
			}); err != nil {
				return fmt.Errorf("set budget: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	month, err := s.screensBudgetMonth(ctx, s.q, h, m)
	if err != nil {
		return nil, err
	}
	return gen.SetBudgets200JSONResponse(month.API), nil
}
