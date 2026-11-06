package api

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/recurring"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// ListSubscriptions returns the subscriptions grouped for the Subscriptions screen, with
// the ≈ monthly and yearly cost of the active expense ones.
func (s *Server) ListSubscriptions(ctx context.Context, request gen.ListSubscriptionsRequestObject) (gen.ListSubscriptionsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}
	rows, err := s.ledgerSubRows(ctx, s.q, h, false)
	if err != nil {
		return nil, err
	}
	totals := ledgerSubTotals(rows)
	out := gen.SubscriptionList{
		HomeCurrency:  h.HomeCurrency,
		PerMonthMinor: totals.PerMonthMinor,
		PerYearMinor:  totals.PerYearMinor,
		ActiveCount:   totals.ActiveCount,
		IsApproximate: totals.IsApproximate,
		NextSevenDays: []gen.Subscription{},
		Later:         []gen.Subscription{},
		Paused:        []gen.Subscription{},
	}
	soon := new(big.Rat)
	for _, row := range rows {
		sub := ledgerSubscription(row, h.Today)
		switch {
		case !ledgerSubActive(row.R):
			out.Paused = append(out.Paused, sub)
		case sub.DaysUntilDue >= 0 && sub.DaysUntilDue <= 7:
			out.NextSevenDays = append(out.NextSevenDays, sub)
			if row.R.Kind == store.EntryKindExpense {
				if home := row.homeExact(); home != nil {
					soon.Add(soon, home)
				}
			}
		default:
			out.Later = append(out.Later, sub)
		}
	}
	out.NextSevenDaysHomeMinor = recurring.RoundHalfAway(soon)

	budgetTotal, err := s.q.LedgerMonthBudgetTotal(ctx, store.LedgerMonthBudgetTotalParams{
		Month: h.CurrentMonth.First(), HouseholdID: h.ID,
	})
	if err != nil {
		return nil, fmt.Errorf("month budget total: %w", err)
	}
	if budgetTotal > 0 {
		out.ShareOfBudget = ptr(float64(out.PerMonthMinor) / float64(budgetTotal))
	}
	pending, err := s.q.LedgerCountPending(ctx, h.ID)
	if err != nil {
		return nil, fmt.Errorf("count pending: %w", err)
	}
	out.PendingCount = int(pending)
	return gen.ListSubscriptions200JSONResponse(out), nil
}

// ledgerSubInput is the editable part of a subscription.
type ledgerSubInput struct {
	Kind          store.EntryKind
	Title         string
	Note          *string
	AmountMinor   int64
	Currency      string
	AccountID     uuid.UUID
	CategoryID    uuid.UUID
	Frequency     gen.Frequency
	IntervalCount int
	StartsOn      time.Time
	EndsOn        *time.Time
}

type ledgerSubResolved struct {
	Title    string
	Note     *string
	Account  store.Account
	Category store.Category
	Freq     recurring.Frequency
}

func (s *Server) ledgerResolveSub(ctx context.Context, q *store.Queries, h householdInfo, in ledgerSubInput, prev *store.RecurringTransaction) (ledgerSubResolved, error) {
	var errs []apierr.FieldError
	var res ledgerSubResolved
	if !in.Kind.Valid() {
		errs = append(errs, apierr.Field("kind", "invalid", "Pick expense or income."))
	}
	res.Title = ledgerText("title", in.Title, 1, 80, &errs)
	res.Note = ledgerNote(in.Note, &errs)
	if in.AmountMinor < 1 {
		errs = append(errs, apierr.Field("amountMinor", "too_small", "Enter an amount above zero."))
	}
	if _, err := s.ledgerCurrency(ctx, q, "currency", in.Currency, &errs); err != nil {
		return res, err
	}
	var err error
	res.Account, err = ledgerPickAccount(ctx, q, h.ID, in.AccountID, prev != nil && prev.AccountID == in.AccountID, &errs)
	if err != nil {
		return res, err
	}
	res.Category, err = ledgerPickCategory(ctx, q, h.ID, in.CategoryID, in.Kind, prev != nil && prev.CategoryID == in.CategoryID, &errs)
	if err != nil {
		return res, err
	}
	res.Freq = recurring.Frequency(in.Frequency)
	if !res.Freq.Valid() {
		errs = append(errs, apierr.Field("frequency", "invalid", "Pick weekly, monthly or yearly."))
	}
	if in.IntervalCount < 1 || in.IntervalCount > recurring.MaxInterval {
		errs = append(errs, apierr.Field("intervalCount", "out_of_range", "Repeat every 1 to 52 periods."))
	}
	if in.EndsOn != nil && in.EndsOn.Before(in.StartsOn) {
		errs = append(errs, apierr.Field("endsOn", "before_start", "The last day can't be before the first charge."))
	}
	return res, ledgerErrs(errs)
}

// CreateSubscription adds a subscription. Its first charge is the first occurrence on or
// after today (past ones aren't backfilled). Sending the same id again returns it.
func (s *Server) CreateSubscription(ctx context.Context, request gen.CreateSubscriptionRequestObject) (gen.CreateSubscriptionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Subscription
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		id := ledgerNewID(body.Id)
		existing := func() (bool, error) {
			row, err := q.LedgerFindSubscriptionHousehold(ctx, id)
			return ledgerExisting(h.ID, row.HouseholdID, row.DeletedAt, err)
		}
		if body.Id != nil {
			if found, err := existing(); err != nil || found {
				if err == nil {
					out, err = ledgerSubscriptionOut(ctx, q, h, id)
				}
				return err
			}
		}
		interval := 1
		if body.IntervalCount != nil {
			interval = *body.IntervalCount
		}
		in := ledgerSubInput{
			Kind: store.EntryKind(body.Kind), Title: body.Title, Note: body.Note, AmountMinor: body.AmountMinor,
			Currency: body.Currency, AccountID: body.AccountId, CategoryID: body.CategoryId, Frequency: body.Frequency,
			IntervalCount: interval, StartsOn: dayFromAPI(body.StartsOn), EndsOn: dayFromAPIPtr(body.EndsOn),
		}
		res, err := s.ledgerResolveSub(ctx, q, h, in, nil)
		if err != nil {
			return err
		}
		_, err = q.LedgerInsertSubscription(ctx, store.LedgerInsertSubscriptionParams{
			ID: id, HouseholdID: h.ID, Kind: in.Kind, Title: res.Title, Note: res.Note,
			AmountMinor: in.AmountMinor, Currency: in.Currency,
			AccountID: res.Account.ID, AccountCurrency: res.Account.Currency, CategoryID: res.Category.ID,
			Frequency: store.RecurrenceFrequency(res.Freq), IntervalCount: int16(interval),
			StartsOn: in.StartsOn, NextDueOn: recurring.NextOnOrAfter(in.StartsOn, res.Freq, interval, h.Today),
			EndsOn: in.EndsOn, CreatedBy: &p.UserID,
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
		out, err = ledgerSubscriptionOut(ctx, q, h, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.CreateSubscription201JSONResponse(out), nil
}

// UpdateSubscription replaces a subscription's editable fields. isActive false pauses it.
// When the schedule changes (or it's resumed) the next charge is recomputed from today;
// past transactions are never touched.
func (s *Server) UpdateSubscription(ctx context.Context, request gen.UpdateSubscriptionRequestObject) (gen.UpdateSubscriptionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Subscription
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		current, err := q.LedgerGetSubscriptionRow(ctx, store.LedgerGetSubscriptionRowParams{ID: request.Id, HouseholdID: h.ID})
		if dbx.IsNoRows(err) {
			return apierr.NotFound("subscription")
		}
		if err != nil {
			return fmt.Errorf("get subscription: %w", err)
		}
		if current.RowVersion != body.RowVersion {
			return apierr.VersionConflict()
		}
		in := ledgerSubInput{
			Kind: current.Kind, Title: body.Title, Note: body.Note, AmountMinor: body.AmountMinor,
			Currency: body.Currency, AccountID: body.AccountId, CategoryID: body.CategoryId, Frequency: body.Frequency,
			IntervalCount: body.IntervalCount, StartsOn: dayFromAPI(body.StartsOn), EndsOn: dayFromAPIPtr(body.EndsOn),
		}
		res, err := s.ledgerResolveSub(ctx, q, h, in, &current)
		if err != nil {
			return err
		}
		nextDue := current.NextDueOn
		scheduleChanged := res.Freq != recurring.Frequency(current.Frequency) ||
			in.IntervalCount != int(current.IntervalCount) || !in.StartsOn.Equal(current.StartsOn)
		resumed := body.IsActive && !current.IsActive
		if scheduleChanged || resumed || nextDue.Before(in.StartsOn) {
			nextDue = recurring.NextOnOrAfter(in.StartsOn, res.Freq, in.IntervalCount, h.Today)
		}
		_, err = q.LedgerUpdateSubscription(ctx, store.LedgerUpdateSubscriptionParams{
			Title: res.Title, Note: res.Note, AmountMinor: in.AmountMinor, Currency: in.Currency,
			AccountID: res.Account.ID, AccountCurrency: res.Account.Currency, CategoryID: res.Category.ID,
			Frequency: store.RecurrenceFrequency(res.Freq), IntervalCount: int16(in.IntervalCount),
			StartsOn: in.StartsOn, NextDueOn: nextDue, EndsOn: in.EndsOn, IsActive: body.IsActive,
			ID: current.ID, HouseholdID: h.ID, RowVersion: body.RowVersion,
		})
		if dbx.IsNoRows(err) {
			return apierr.VersionConflict()
		}
		if err != nil {
			return err
		}
		out, err = ledgerSubscriptionOut(ctx, q, h, current.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.UpdateSubscription200JSONResponse(out), nil
}

// DeleteSubscription soft-deletes a subscription; its past transactions stay.
func (s *Server) DeleteSubscription(ctx context.Context, request gen.DeleteSubscriptionRequestObject) (gen.DeleteSubscriptionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	_, err = s.q.LedgerSoftDeleteSubscription(ctx, store.LedgerSoftDeleteSubscriptionParams{ID: request.Id, HouseholdID: p.HouseholdID})
	if dbx.IsNoRows(err) {
		return nil, apierr.NotFound("subscription")
	}
	if err != nil {
		return nil, fmt.Errorf("delete subscription: %w", err)
	}
	return gen.DeleteSubscription204Response{}, nil
}

func ledgerSubscriptionOut(ctx context.Context, q *store.Queries, h householdInfo, id uuid.UUID) (gen.Subscription, error) {
	r, err := q.LedgerGetSubscription(ctx, store.LedgerGetSubscriptionParams{Today: h.Today, ID: id, HouseholdID: h.ID})
	if dbx.IsNoRows(err) {
		return gen.Subscription{}, apierr.NotFound("subscription")
	}
	if err != nil {
		return gen.Subscription{}, fmt.Errorf("get subscription: %w", err)
	}
	return ledgerSubscription(ledgerSubRow{
		R: r.RecurringTransaction, A: r.Account, C: r.Category, HomeRate: r.HomeRate,
		FromMinor: r.CurrencyMinorUnits, HomeMinor: r.HomeMinorUnits, HomeCode: h.HomeCurrency,
	}, h.Today), nil
}
