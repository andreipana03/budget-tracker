package api

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// ListAccounts returns the accounts with their balances and the ≈ total in the home currency.
func (s *Server) ListAccounts(ctx context.Context, request gen.ListAccountsRequestObject) (gen.ListAccountsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.LedgerListAccounts(ctx, store.LedgerListAccountsParams{
		Today: h.Today, HouseholdID: h.ID, IncludeArchived: deref(request.Params.IncludeArchived),
	})
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	out := gen.AccountList{Items: make([]gen.Account, 0, len(rows)), HomeCurrency: h.HomeCurrency}
	for _, r := range rows {
		a := ledgerAccount(r.Account, r.BalanceMinor, r.BalanceHomeMinor)
		out.Items = append(out.Items, a)
		if a.Archived || !a.IncludeInTotal {
			continue
		}
		if a.Currency != h.HomeCurrency {
			out.TotalIsApproximate = true
		}
		if a.BalanceHomeMinor != nil {
			out.TotalHomeMinor += *a.BalanceHomeMinor
		}
	}
	return gen.ListAccounts200JSONResponse(out), nil
}

// CreateAccount adds an account. Sending the same id again returns the existing one.
func (s *Server) CreateAccount(ctx context.Context, request gen.CreateAccountRequestObject) (gen.CreateAccountResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Account
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		id := ledgerNewID(body.Id)
		existing := func() (bool, error) {
			row, err := q.LedgerFindAccountHousehold(ctx, id)
			return ledgerExisting(h.ID, row.HouseholdID, row.DeletedAt, err)
		}
		if body.Id != nil {
			if found, err := existing(); err != nil || found {
				if err == nil {
					out, err = s.ledgerAccountOut(ctx, q, h, id)
				}
				return err
			}
		}

		var errs []apierr.FieldError
		name := ledgerText("name", body.Name, 1, 60, &errs)
		if !store.AccountType(body.Type).Valid() {
			errs = append(errs, apierr.Field("type", "invalid", "Pick an account type."))
		}
		if _, err := s.ledgerCurrency(ctx, q, "currency", body.Currency, &errs); err != nil {
			return err
		}
		if body.OpeningBalanceMinor != nil && amountTooLarge(*body.OpeningBalanceMinor) {
			errs = append(errs, tooLargeField("openingBalanceMinor"))
		}
		if err := ledgerErrs(errs); err != nil {
			return err
		}
		openingOn := h.Today
		if body.OpeningBalanceOn != nil {
			openingOn = dayFromAPI(*body.OpeningBalanceOn)
		}
		includeInTotal := true
		if body.IncludeInTotal != nil {
			includeInTotal = *body.IncludeInTotal
		}
		var sortOrder *int32
		if body.SortOrder != nil {
			sortOrder = ptr(int32(*body.SortOrder))
		}
		_, err = q.LedgerInsertAccount(ctx, store.LedgerInsertAccountParams{
			ID: id, HouseholdID: h.ID, Name: name, Type: store.AccountType(body.Type), Currency: body.Currency,
			OpeningBalanceMinor: deref(body.OpeningBalanceMinor), OpeningBalanceOn: openingOn,
			IncludeInTotal: includeInTotal, SortOrder: sortOrder, CreatedBy: &p.UserID,
		})
		if dbx.IsNoRows(err) { // the id was taken between our check and the insert
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
		out, err = s.ledgerAccountOut(ctx, q, h, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.CreateAccount201JSONResponse(out), nil
}

// UpdateAccount replaces an account's editable fields (optimistic concurrency on rowVersion).
func (s *Server) UpdateAccount(ctx context.Context, request gen.UpdateAccountRequestObject) (gen.UpdateAccountResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Account
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		current, err := q.LedgerGetAccount(ctx, store.LedgerGetAccountParams{ID: request.Id, HouseholdID: h.ID})
		if dbx.IsNoRows(err) {
			return apierr.NotFound("account")
		}
		if err != nil {
			return fmt.Errorf("get account: %w", err)
		}
		if current.RowVersion != body.RowVersion {
			return apierr.VersionConflict()
		}
		var errs []apierr.FieldError
		name := ledgerText("name", body.Name, 1, 60, &errs)
		if !store.AccountType(body.Type).Valid() {
			errs = append(errs, apierr.Field("type", "invalid", "Pick an account type."))
		}
		if body.Currency != current.Currency {
			if _, err := s.ledgerCurrency(ctx, q, "currency", body.Currency, &errs); err != nil {
				return err
			}
		}
		if amountTooLarge(body.OpeningBalanceMinor) {
			errs = append(errs, tooLargeField("openingBalanceMinor"))
		}
		if err := ledgerErrs(errs); err != nil {
			return err
		}
		if body.Currency != current.Currency {
			used, err := q.LedgerAccountHasHistory(ctx, current.ID)
			if err != nil {
				return fmt.Errorf("check account history: %w", err)
			}
			if used {
				return apierr.Conflict("account_currency_locked",
					"The currency can't change once the account has transactions or subscriptions.")
			}
		}
		_, err = q.LedgerUpdateAccount(ctx, store.LedgerUpdateAccountParams{
			Name: name, Type: store.AccountType(body.Type), Currency: body.Currency,
			OpeningBalanceMinor: body.OpeningBalanceMinor, OpeningBalanceOn: dayFromAPI(body.OpeningBalanceOn),
			IncludeInTotal: body.IncludeInTotal, SortOrder: int32(body.SortOrder), Archived: body.Archived,
			ID: current.ID, HouseholdID: h.ID, RowVersion: body.RowVersion,
		})
		if dbx.IsNoRows(err) {
			return apierr.VersionConflict()
		}
		if err != nil {
			return err
		}
		out, err = s.ledgerAccountOut(ctx, q, h, current.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.UpdateAccount200JSONResponse(out), nil
}

// DeleteAccount deletes an unused account, or archives it when it has history.
func (s *Server) DeleteAccount(ctx context.Context, request gen.DeleteAccountRequestObject) (gen.DeleteAccountResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	var outcome gen.DeleteResultOutcome
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		key := store.LedgerGetAccountParams{ID: request.Id, HouseholdID: p.HouseholdID}
		if _, err := q.LedgerGetAccount(ctx, key); dbx.IsNoRows(err) {
			return apierr.NotFound("account")
		} else if err != nil {
			return fmt.Errorf("get account: %w", err)
		}
		used, err := q.LedgerAccountHasHistory(ctx, request.Id)
		if err != nil {
			return fmt.Errorf("check account history: %w", err)
		}
		if used {
			outcome = gen.DeleteResultOutcomeArchived
			return q.LedgerArchiveAccount(ctx, store.LedgerArchiveAccountParams(key))
		}
		outcome = gen.DeleteResultOutcomeDeleted
		return q.LedgerSoftDeleteAccount(ctx, store.LedgerSoftDeleteAccountParams(key))
	})
	if err != nil {
		return nil, err
	}
	return gen.DeleteAccount200JSONResponse{Outcome: outcome}, nil
}

func (s *Server) ledgerAccountOut(ctx context.Context, q *store.Queries, h householdInfo, id uuid.UUID) (gen.Account, error) {
	r, err := q.LedgerGetAccountWithBalance(ctx, store.LedgerGetAccountWithBalanceParams{Today: h.Today, ID: id, HouseholdID: h.ID})
	if dbx.IsNoRows(err) {
		return gen.Account{}, apierr.NotFound("account")
	}
	if err != nil {
		return gen.Account{}, fmt.Errorf("get account: %w", err)
	}
	return ledgerAccount(r.Account, r.BalanceMinor, r.BalanceHomeMinor), nil
}

// ledgerExisting interprets a lookup of a client-chosen id for an idempotent create:
// found in this household → (true, nil); used elsewhere or deleted → 409; free → (false, nil).
func ledgerExisting(household, owner uuid.UUID, deletedAt *time.Time, err error) (bool, error) {
	if dbx.IsNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("look up id: %w", err)
	}
	if owner != household || deletedAt != nil {
		return false, ledgerIDTaken()
	}
	return true, nil
}
