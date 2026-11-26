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

// Transfers move money between two of the household's accounts (DB doc § 6). Each side
// is in its own account's currency; between currencies the amounts differ by the rate
// and fees actually paid. They never count as spending or income. Activity lists them
// through ListTransactions (includeTransfers).

// ledgerTransfer converts a transfer and its two accounts' names and types.
func ledgerTransfer(t store.Transfer, fromName string, fromType store.AccountType, toName string, toType store.AccountType) gen.Transfer {
	return gen.Transfer{
		Id:              t.ID,
		FromAccount:     gen.AccountRef{Id: t.FromAccountID, Name: fromName, Type: gen.AccountType(fromType), Currency: t.FromCurrency},
		FromAmountMinor: t.FromAmountMinor,
		ToAccount:       gen.AccountRef{Id: t.ToAccountID, Name: toName, Type: gen.AccountType(toType), Currency: t.ToCurrency},
		ToAmountMinor:   t.ToAmountMinor,
		OccurredOn:      apiDate(t.OccurredOn),
		OccurredAt:      t.OccurredAt,
		Note:            t.Note,
		RowVersion:      t.RowVersion,
		CreatedAt:       t.CreatedAt,
		UpdatedAt:       t.UpdatedAt,
	}
}

// ledgerTransferInput is the editable part of a transfer, from a create or update request.
type ledgerTransferInput struct {
	FromAccountID uuid.UUID
	ToAccountID   uuid.UUID
	FromAmount    int64
	ToAmount      *int64
	OccurredOn    time.Time
	Note          *string
}

type ledgerTransferResolved struct {
	From     store.Account
	To       store.Account
	ToAmount int64
	Note     *string
}

// ledgerResolveTransfer validates a transfer against the household and works out the
// arriving amount. prev is the transfer being edited (nil on create): archived accounts
// it already uses stay allowed.
func ledgerResolveTransfer(ctx context.Context, q *store.Queries, h householdInfo, in ledgerTransferInput, prev *store.Transfer) (ledgerTransferResolved, error) {
	var errs []apierr.FieldError
	var res ledgerTransferResolved
	if in.FromAmount < 1 {
		errs = append(errs, apierr.Field("fromAmountMinor", "too_small", "Enter an amount above zero."))
	} else if amountTooLarge(in.FromAmount) {
		errs = append(errs, tooLargeField("fromAmountMinor"))
	}
	if in.ToAmount != nil {
		if *in.ToAmount < 1 {
			errs = append(errs, apierr.Field("toAmountMinor", "too_small", "Enter an amount above zero."))
		} else if amountTooLarge(*in.ToAmount) {
			errs = append(errs, tooLargeField("toAmountMinor"))
		}
	}
	if in.FromAccountID == in.ToAccountID {
		errs = append(errs, apierr.Field("toAccountId", "same_account", "Pick two different accounts."))
	}
	usedBefore := func(id uuid.UUID) bool { return prev != nil && (prev.FromAccountID == id || prev.ToAccountID == id) }
	var err error
	res.From, err = ledgerPickAccountAs(ctx, q, h.ID, in.FromAccountID, "fromAccountId", usedBefore(in.FromAccountID), &errs)
	if err != nil {
		return res, err
	}
	res.To, err = ledgerPickAccountAs(ctx, q, h.ID, in.ToAccountID, "toAccountId", usedBefore(in.ToAccountID), &errs)
	if err != nil {
		return res, err
	}
	res.Note = ledgerNote(in.Note, &errs)
	if err := ledgerErrs(errs); err != nil {
		return res, err
	}

	switch {
	case res.From.Currency == res.To.Currency:
		if in.ToAmount != nil && *in.ToAmount != in.FromAmount {
			return res, apierr.Validation(apierr.Field("toAmountMinor", "mismatch",
				"Between accounts in the same currency, what arrives is what leaves."))
		}
		res.ToAmount = in.FromAmount
	case in.ToAmount != nil:
		res.ToAmount = *in.ToAmount
	case prev != nil && prev.FromAmountMinor == in.FromAmount && prev.FromAccountID == in.FromAccountID &&
		prev.ToAccountID == in.ToAccountID && prev.OccurredOn.Equal(in.OccurredOn):
		// Nothing that decides the conversion changed: keep what arrived (DB doc § 6, rates never move old rows).
		res.ToAmount = prev.ToAmountMinor
	default:
		converted, err := q.LedgerConvertAmount(ctx, store.LedgerConvertAmountParams{
			AmountMinor: in.FromAmount, FromCurrency: res.From.Currency, ToCurrency: res.To.Currency, OnDate: in.OccurredOn,
		})
		if err != nil {
			return res, fmt.Errorf("convert amount: %w", err)
		}
		amount := ledgerNumericInt64(converted)
		if amount == nil {
			return res, apierr.FxRateUnavailable(res.From.Currency, res.To.Currency)
		}
		if *amount < 1 {
			return res, apierr.Validation(apierr.Field("fromAmountMinor", "too_small", "This amount is too small to convert."))
		}
		res.ToAmount = *amount
	}
	return res, nil
}

// CreateTransfer moves money from one account to another.
func (s *Server) CreateTransfer(ctx context.Context, request gen.CreateTransferRequestObject) (gen.CreateTransferResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Transfer
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		id := ledgerNewID(body.Id)
		existing := func() (bool, error) {
			row, err := q.LedgerGetTransferAny(ctx, id)
			return ledgerExisting(h.ID, row.HouseholdID, row.DeletedAt, err)
		}
		if body.Id != nil {
			if found, err := existing(); err != nil || found {
				if err == nil {
					out, err = ledgerTransferOut(ctx, q, h.ID, id)
				}
				return err
			}
		}

		occurredOn := dayFromAPI(body.OccurredOn)
		res, err := ledgerResolveTransfer(ctx, q, h, ledgerTransferInput{
			FromAccountID: body.FromAccountId, ToAccountID: body.ToAccountId,
			FromAmount: body.FromAmountMinor, ToAmount: body.ToAmountMinor, OccurredOn: occurredOn, Note: body.Note,
		}, nil)
		if err != nil {
			return err
		}
		_, err = q.LedgerInsertTransfer(ctx, store.LedgerInsertTransferParams{
			ID: id, HouseholdID: h.ID,
			FromAccountID: res.From.ID, FromCurrency: res.From.Currency, FromAmountMinor: body.FromAmountMinor,
			ToAccountID: res.To.ID, ToCurrency: res.To.Currency, ToAmountMinor: res.ToAmount,
			OccurredOn: occurredOn, OccurredAt: body.OccurredAt, Note: res.Note, CreatedBy: &p.UserID,
		})
		if dbx.IsNoRows(err) { // same id inserted concurrently
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
		out, err = ledgerTransferOut(ctx, q, h.ID, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.CreateTransfer201JSONResponse(out), nil
}

// GetTransfer returns one transfer.
func (s *Server) GetTransfer(ctx context.Context, request gen.GetTransferRequestObject) (gen.GetTransferResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	out, err := ledgerTransferOut(ctx, s.q, p.HouseholdID, request.Id)
	if err != nil {
		return nil, err
	}
	return gen.GetTransfer200JSONResponse(out), nil
}

// UpdateTransfer replaces a transfer's editable fields.
func (s *Server) UpdateTransfer(ctx context.Context, request gen.UpdateTransferRequestObject) (gen.UpdateTransferResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Transfer
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		current, err := q.LedgerGetTransfer(ctx, store.LedgerGetTransferParams{ID: request.Id, HouseholdID: h.ID})
		if dbx.IsNoRows(err) {
			return apierr.NotFound("transfer")
		}
		if err != nil {
			return fmt.Errorf("get transfer: %w", err)
		}
		if current.Transfer.RowVersion != body.RowVersion {
			return apierr.VersionConflict()
		}
		occurredOn := dayFromAPI(body.OccurredOn)
		res, err := ledgerResolveTransfer(ctx, q, h, ledgerTransferInput{
			FromAccountID: body.FromAccountId, ToAccountID: body.ToAccountId,
			FromAmount: body.FromAmountMinor, ToAmount: body.ToAmountMinor, OccurredOn: occurredOn, Note: body.Note,
		}, &current.Transfer)
		if err != nil {
			return err
		}
		_, err = q.LedgerUpdateTransfer(ctx, store.LedgerUpdateTransferParams{
			FromAccountID: res.From.ID, FromCurrency: res.From.Currency, FromAmountMinor: body.FromAmountMinor,
			ToAccountID: res.To.ID, ToCurrency: res.To.Currency, ToAmountMinor: res.ToAmount,
			OccurredOn: occurredOn, OccurredAt: body.OccurredAt, Note: res.Note,
			ID: current.Transfer.ID, HouseholdID: h.ID, RowVersion: body.RowVersion,
		})
		if dbx.IsNoRows(err) {
			return apierr.VersionConflict()
		}
		if err != nil {
			return err
		}
		out, err = ledgerTransferOut(ctx, q, h.ID, current.Transfer.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.UpdateTransfer200JSONResponse(out), nil
}

// DeleteTransfer soft-deletes a transfer (Undo restores it).
func (s *Server) DeleteTransfer(ctx context.Context, request gen.DeleteTransferRequestObject) (gen.DeleteTransferResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	_, err = s.q.LedgerSoftDeleteTransfer(ctx, store.LedgerSoftDeleteTransferParams{ID: request.Id, HouseholdID: p.HouseholdID})
	if dbx.IsNoRows(err) {
		return nil, apierr.NotFound("transfer")
	}
	if err != nil {
		return nil, fmt.Errorf("delete transfer: %w", err)
	}
	return gen.DeleteTransfer204Response{}, nil
}

// RestoreTransfer undoes a delete.
func (s *Server) RestoreTransfer(ctx context.Context, request gen.RestoreTransferRequestObject) (gen.RestoreTransferResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	var out gen.Transfer
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		_, err := q.LedgerRestoreTransfer(ctx, store.LedgerRestoreTransferParams{ID: request.Id, HouseholdID: p.HouseholdID})
		if dbx.IsNoRows(err) {
			return apierr.NotFound("transfer")
		}
		if err != nil {
			return err
		}
		out, err = ledgerTransferOut(ctx, q, p.HouseholdID, request.Id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.RestoreTransfer200JSONResponse(out), nil
}

func ledgerTransferOut(ctx context.Context, q *store.Queries, household, id uuid.UUID) (gen.Transfer, error) {
	r, err := q.LedgerGetTransfer(ctx, store.LedgerGetTransferParams{ID: id, HouseholdID: household})
	if dbx.IsNoRows(err) {
		return gen.Transfer{}, apierr.NotFound("transfer")
	}
	if err != nil {
		return gen.Transfer{}, fmt.Errorf("get transfer: %w", err)
	}
	return ledgerTransfer(r.Transfer, r.FromName, r.FromType, r.ToName, r.ToType), nil
}
