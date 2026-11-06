package api

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// ListCategories returns the expense then income categories, in sort order.
func (s *Server) ListCategories(ctx context.Context, request gen.ListCategoriesRequestObject) (gen.ListCategoriesResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.LedgerListCategories(ctx, store.LedgerListCategoriesParams{
		HouseholdID: p.HouseholdID, IncludeArchived: deref(request.Params.IncludeArchived),
	})
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	out := make(gen.ListCategories200JSONResponse, 0, len(rows))
	for _, c := range rows {
		out = append(out, ledgerCategory(c))
	}
	return out, nil
}

// ledgerCategoryFields validates the editable category fields shared by create and update.
func ledgerCategoryFields(kind store.EntryKind, name string, color gen.CategoryColor, icon string, isFixed bool, errs *[]apierr.FieldError) string {
	name = ledgerText("name", name, 1, 40, errs)
	if !color.Valid() {
		*errs = append(*errs, apierr.Field("color", "invalid", "Pick one of the category colors."))
	}
	if !ledgerIconPattern.MatchString(icon) {
		*errs = append(*errs, apierr.Field("icon", "invalid_format", "Use a Phosphor icon name like shopping-cart."))
	}
	if isFixed && kind != store.EntryKindExpense {
		*errs = append(*errs, apierr.Field("isFixed", "expense_only", "Only expense categories can be fixed."))
	}
	return name
}

// CreateCategory adds a category. Sending the same id again returns the existing one.
func (s *Server) CreateCategory(ctx context.Context, request gen.CreateCategoryRequestObject) (gen.CreateCategoryResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Category
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		id := ledgerNewID(body.Id)
		existing := func() (bool, error) {
			row, err := q.LedgerFindCategoryHousehold(ctx, id)
			return ledgerExisting(p.HouseholdID, row.HouseholdID, row.DeletedAt, err)
		}
		if body.Id != nil {
			if found, err := existing(); err != nil || found {
				if err == nil {
					out, err = ledgerCategoryOut(ctx, q, p.HouseholdID, id)
				}
				return err
			}
		}
		var errs []apierr.FieldError
		kind := store.EntryKind(body.Kind)
		if !kind.Valid() {
			errs = append(errs, apierr.Field("kind", "invalid", "Pick expense or income."))
		}
		isFixed := deref(body.IsFixed)
		name := ledgerCategoryFields(kind, body.Name, body.Color, body.Icon, isFixed, &errs)
		if err := ledgerErrs(errs); err != nil {
			return err
		}
		var sortOrder *int32
		if body.SortOrder != nil {
			sortOrder = ptr(int32(*body.SortOrder))
		}
		_, err := q.LedgerInsertCategory(ctx, store.LedgerInsertCategoryParams{
			ID: id, HouseholdID: p.HouseholdID, Kind: kind, Name: name, Color: string(body.Color),
			Icon: body.Icon, IsFixed: isFixed, SortOrder: sortOrder, CreatedBy: &p.UserID,
		})
		if dbx.IsNoRows(err) {
			found, err := existing()
			if err != nil {
				return err
			}
			if !found {
				return ledgerIDTaken()
			}
		} else if err != nil {
			return err
		}
		out, err = ledgerCategoryOut(ctx, q, p.HouseholdID, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.CreateCategory201JSONResponse(out), nil
}

// UpdateCategory replaces a category's editable fields. Its kind never changes.
func (s *Server) UpdateCategory(ctx context.Context, request gen.UpdateCategoryRequestObject) (gen.UpdateCategoryResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	current, err := s.q.LedgerGetCategory(ctx, store.LedgerGetCategoryParams{ID: request.Id, HouseholdID: p.HouseholdID})
	if dbx.IsNoRows(err) {
		return nil, apierr.NotFound("category")
	}
	if err != nil {
		return nil, fmt.Errorf("get category: %w", err)
	}
	if current.RowVersion != body.RowVersion {
		return nil, apierr.VersionConflict()
	}
	var errs []apierr.FieldError
	name := ledgerCategoryFields(current.Kind, body.Name, body.Color, body.Icon, body.IsFixed, &errs)
	if err := ledgerErrs(errs); err != nil {
		return nil, err
	}
	updated, err := s.q.LedgerUpdateCategory(ctx, store.LedgerUpdateCategoryParams{
		Name: name, Color: string(body.Color), Icon: body.Icon, IsFixed: body.IsFixed,
		SortOrder: int32(body.SortOrder), Archived: body.Archived,
		ID: current.ID, HouseholdID: p.HouseholdID, RowVersion: body.RowVersion,
	})
	if dbx.IsNoRows(err) {
		return nil, apierr.VersionConflict()
	}
	if err != nil {
		return nil, err
	}
	return gen.UpdateCategory200JSONResponse(ledgerCategory(updated)), nil
}

// DeleteCategory deletes an unused category, or archives it when it has history.
func (s *Server) DeleteCategory(ctx context.Context, request gen.DeleteCategoryRequestObject) (gen.DeleteCategoryResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	var outcome gen.DeleteResultOutcome
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		key := store.LedgerGetCategoryParams{ID: request.Id, HouseholdID: p.HouseholdID}
		if _, err := q.LedgerGetCategory(ctx, key); dbx.IsNoRows(err) {
			return apierr.NotFound("category")
		} else if err != nil {
			return fmt.Errorf("get category: %w", err)
		}
		used, err := q.LedgerCategoryInUse(ctx, request.Id)
		if err != nil {
			return fmt.Errorf("check category history: %w", err)
		}
		if used {
			outcome = gen.DeleteResultOutcomeArchived
			return q.LedgerArchiveCategory(ctx, store.LedgerArchiveCategoryParams(key))
		}
		outcome = gen.DeleteResultOutcomeDeleted
		return q.LedgerSoftDeleteCategory(ctx, store.LedgerSoftDeleteCategoryParams(key))
	})
	if err != nil {
		return nil, err
	}
	return gen.DeleteCategory200JSONResponse{Outcome: outcome}, nil
}

func ledgerCategoryOut(ctx context.Context, q *store.Queries, household, id uuid.UUID) (gen.Category, error) {
	c, err := q.LedgerGetCategory(ctx, store.LedgerGetCategoryParams{ID: id, HouseholdID: household})
	if dbx.IsNoRows(err) {
		return gen.Category{}, apierr.NotFound("category")
	}
	if err != nil {
		return gen.Category{}, fmt.Errorf("get category: %w", err)
	}
	return ledgerCategory(c), nil
}
