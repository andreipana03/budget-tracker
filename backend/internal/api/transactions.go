package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/recurring"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

const (
	ledgerDefaultPageSize = 50
	ledgerMaxPageSize     = 200
)

// ---------------------------------------------------------------- list

// ledgerCursor is the last row of a page: occurred_on, occurred_at (may be null), id.
type ledgerCursor struct {
	On string     `json:"d"`
	At *time.Time `json:"a,omitempty"`
	ID uuid.UUID  `json:"i"`
}

func ledgerEncodeCursor(t store.Transaction) string {
	b, _ := json.Marshal(ledgerCursor{On: t.OccurredOn.Format(time.DateOnly), At: t.OccurredAt, ID: t.ID})
	return base64.RawURLEncoding.EncodeToString(b)
}

func ledgerDecodeCursor(s string) (on time.Time, at *time.Time, id uuid.UUID, err error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return
	}
	var c ledgerCursor
	if err = json.Unmarshal(raw, &c); err != nil {
		return
	}
	if on, err = time.Parse(time.DateOnly, c.On); err != nil {
		return
	}
	if c.ID == uuid.Nil {
		err = fmt.Errorf("cursor without id")
	}
	return on, c.At, c.ID, err
}

var ledgerLikeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// ListTransactions returns one page of transactions, newest first, with day totals.
func (s *Server) ListTransactions(ctx context.Context, request gen.ListTransactionsRequestObject) (gen.ListTransactionsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	h, err := s.loadHousehold(ctx, s.q, p.HouseholdID)
	if err != nil {
		return nil, err
	}
	params := request.Params
	var errs []apierr.FieldError

	limit := ledgerDefaultPageSize
	if params.Limit != nil {
		limit = *params.Limit
		if limit < 1 || limit > ledgerMaxPageSize {
			errs = append(errs, apierr.Field("limit", "out_of_range", "Ask for 1 to 200 transactions."))
		}
	}
	f := store.LedgerListTransactionsParams{HouseholdID: h.ID, CategoryID: params.CategoryId, AccountID: params.AccountId}
	if params.Kind != nil {
		if !params.Kind.Valid() {
			errs = append(errs, apierr.Field("kind", "invalid", "Use expense or income."))
		}
		f.Kind = ptr(store.EntryKind(*params.Kind))
	}
	if params.Status != nil {
		if !params.Status.Valid() {
			errs = append(errs, apierr.Field("status", "invalid", "Use posted, pending or skipped."))
		}
		f.Status = ptr(store.TransactionStatus(*params.Status))
	}
	// Day range: the budget month's period intersected with from/to.
	if params.Month != nil {
		m, err := budget.ParseMonth(*params.Month)
		if err != nil {
			errs = append(errs, apierr.Field("month", "invalid_format", "Use YYYY-MM."))
		} else {
			period := h.Period(m)
			f.FromOn, f.ToBefore = ptr(period.Start), ptr(period.EndBefore)
		}
	}
	if params.From != nil {
		if from := dayFromAPI(*params.From); f.FromOn == nil || from.After(*f.FromOn) {
			f.FromOn = &from
		}
	}
	if params.To != nil {
		if before := dayFromAPI(*params.To).AddDate(0, 0, 1); f.ToBefore == nil || before.Before(*f.ToBefore) {
			f.ToBefore = &before
		}
	}
	if params.Q != nil {
		if q := strings.TrimSpace(*params.Q); q != "" {
			if utf8.RuneCountInString(q) > 100 {
				errs = append(errs, apierr.Field("q", "too_long", "Search for up to 100 characters."))
			}
			f.Q = ptr(ledgerLikeEscaper.Replace(q))
		}
	}
	if params.Cursor != nil && *params.Cursor != "" {
		on, at, id, err := ledgerDecodeCursor(*params.Cursor)
		if err != nil {
			errs = append(errs, apierr.Field("cursor", "invalid", "This cursor isn't valid. Start from the first page."))
		} else {
			f.CursorOn, f.CursorAt, f.CursorID = &on, at, &id
		}
	}
	if err := ledgerErrs(errs); err != nil {
		return nil, err
	}

	f.RowLimit = int32(limit + 1)
	rows, err := s.q.LedgerListTransactions(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("list transactions: %w", err)
	}
	out := gen.TransactionPage{
		Items:        make([]gen.Transaction, 0, min(len(rows), limit)),
		DayTotals:    []gen.DayTotal{},
		HomeCurrency: h.HomeCurrency,
	}
	if len(rows) > limit {
		rows = rows[:limit]
		out.NextCursor = ptr(ledgerEncodeCursor(rows[len(rows)-1].Transaction))
	}
	var days []time.Time
	for _, r := range rows {
		out.Items = append(out.Items, ledgerTransaction(r.Transaction, r.Category, r.Account))
		if n := len(days); n == 0 || !days[n-1].Equal(r.Transaction.OccurredOn) {
			days = append(days, r.Transaction.OccurredOn)
		}
	}
	if len(days) > 0 {
		totals, err := s.q.LedgerDayTotals(ctx, store.LedgerDayTotalsParams{
			HouseholdID: h.ID, Days: days, Kind: f.Kind, Status: f.Status, CategoryID: f.CategoryID,
			AccountID: f.AccountID, FromOn: f.FromOn, ToBefore: f.ToBefore, Q: f.Q,
		})
		if err != nil {
			return nil, fmt.Errorf("day totals: %w", err)
		}
		byDay := make(map[time.Time]store.LedgerDayTotalsRow, len(totals))
		for _, t := range totals {
			byDay[budget.DayOf(t.OccurredOn)] = t
		}
		for _, d := range days {
			t := byDay[budget.DayOf(d)]
			out.DayTotals = append(out.DayTotals, gen.DayTotal{
				Date: apiDate(d), ExpenseHomeMinor: t.ExpenseHomeMinor, IncomeHomeMinor: t.IncomeHomeMinor,
			})
		}
	}
	return gen.ListTransactions200JSONResponse(out), nil
}

// ---------------------------------------------------------------- create / update

// ledgerFrozen is what a transaction freezes at entry (DB doc § 6).
type ledgerFrozen struct {
	AccountAmount int64
	HomeAmount    int64
	Rate          pgtype.Numeric
	RateDate      *time.Time
}

// ledgerFreeze converts amount (in currency) into the account's and the home currency
// with the BNR rate of `on`. 422 fx_rate_unavailable when a rate is missing.
func ledgerFreeze(ctx context.Context, q *store.Queries, amount int64, currency, accountCurrency, home string, on time.Time) (ledgerFrozen, error) {
	row, err := q.LedgerFreezeAmounts(ctx, store.LedgerFreezeAmountsParams{
		AmountMinor: amount, Currency: currency, AccountCurrency: accountCurrency, HomeCurrency: home, OnDate: on,
	})
	if err != nil {
		return ledgerFrozen{}, fmt.Errorf("freeze amounts: %w", err)
	}
	homeAmount := ledgerNumericInt64(row.HomeAmountMinor)
	if homeAmount == nil || !row.FxRate.Valid {
		return ledgerFrozen{}, apierr.FxRateUnavailable(currency, home)
	}
	accountAmount := ledgerNumericInt64(row.AccountAmountMinor)
	if accountAmount == nil {
		return ledgerFrozen{}, apierr.FxRateUnavailable(currency, accountCurrency)
	}
	if *homeAmount < 1 || *accountAmount < 1 {
		return ledgerFrozen{}, apierr.Validation(apierr.Field("amountMinor", "too_small",
			"This amount is too small to convert."))
	}
	return ledgerFrozen{AccountAmount: *accountAmount, HomeAmount: *homeAmount, Rate: row.FxRate, RateDate: row.FxRateDate}, nil
}

// ledgerTxInput is the editable part of a transaction, from a create or update request.
type ledgerTxInput struct {
	Kind        gen.EntryKind
	Title       *string
	Note        *string
	OccurredOn  time.Time
	OccurredAt  *time.Time
	CategoryID  uuid.UUID
	AccountID   uuid.UUID
	AmountMinor int64
	Currency    string
}

type ledgerTxResolved struct {
	Kind     store.EntryKind
	Title    string
	Note     *string
	Category store.Category
	Account  store.Account
	Frozen   ledgerFrozen
}

// ledgerResolveTx validates a transaction's fields against the household and freezes its
// amounts. prev is the transaction being edited (nil on create): an archived category or
// account it already uses stays allowed.
func (s *Server) ledgerResolveTx(ctx context.Context, q *store.Queries, h householdInfo, in ledgerTxInput, prev *store.Transaction) (ledgerTxResolved, error) {
	var errs []apierr.FieldError
	res := ledgerTxResolved{Kind: store.EntryKind(in.Kind)}
	if !res.Kind.Valid() {
		errs = append(errs, apierr.Field("kind", "invalid", "Pick expense or income."))
	}
	if in.AmountMinor < 1 {
		errs = append(errs, apierr.Field("amountMinor", "too_small", "Enter an amount above zero."))
	} else if amountTooLarge(in.AmountMinor) {
		errs = append(errs, tooLargeField("amountMinor"))
	}
	if _, err := s.ledgerCurrency(ctx, q, "currency", in.Currency, &errs); err != nil {
		return res, err
	}
	var err error
	res.Category, err = ledgerPickCategory(ctx, q, h.ID, in.CategoryID, res.Kind, prev != nil && prev.CategoryID == in.CategoryID, &errs)
	if err != nil {
		return res, err
	}
	res.Account, err = ledgerPickAccount(ctx, q, h.ID, in.AccountID, prev != nil && prev.AccountID == in.AccountID, &errs)
	if err != nil {
		return res, err
	}
	title := ""
	if in.Title != nil {
		title = strings.TrimSpace(*in.Title)
	}
	if title == "" {
		title = res.Category.Name // contract: defaults to the category's name
	}
	if utf8.RuneCountInString(title) > 80 {
		errs = append(errs, apierr.Field("title", "too_long", "Titles can be up to 80 characters."))
	}
	res.Title = title
	res.Note = ledgerNote(in.Note, &errs)
	if err := ledgerErrs(errs); err != nil {
		return res, err
	}
	// DB doc § 6: recompute only when amount, currency, account or date change. Rate
	// changes after entry (e.g. today's BNR rate arriving at 13:30) never move a total.
	if prev != nil && prev.AmountMinor == in.AmountMinor && prev.Currency == in.Currency &&
		prev.AccountID == in.AccountID && prev.OccurredOn.Equal(in.OccurredOn) && prev.HomeCurrency == h.HomeCurrency {
		res.Frozen = ledgerFrozen{AccountAmount: prev.AccountAmountMinor, HomeAmount: prev.HomeAmountMinor,
			Rate: prev.FxRate, RateDate: prev.FxRateDate}
		return res, nil
	}
	res.Frozen, err = ledgerFreeze(ctx, q, in.AmountMinor, in.Currency, res.Account.Currency, h.HomeCurrency, in.OccurredOn)
	return res, err
}

// ledgerPickCategory loads a category for a transaction or subscription and checks its kind.
func ledgerPickCategory(ctx context.Context, q *store.Queries, household, id uuid.UUID, kind store.EntryKind, keep bool, errs *[]apierr.FieldError) (store.Category, error) {
	c, err := q.LedgerGetCategory(ctx, store.LedgerGetCategoryParams{ID: id, HouseholdID: household})
	if dbx.IsNoRows(err) {
		*errs = append(*errs, apierr.Field("categoryId", "not_found", "This category doesn't exist."))
		return c, nil
	}
	if err != nil {
		return c, fmt.Errorf("get category: %w", err)
	}
	if kind.Valid() && c.Kind != kind {
		*errs = append(*errs, apierr.Field("categoryId", "kind_mismatch", "Pick a category of the same kind ("+string(kind)+")."))
	}
	if c.ArchivedAt != nil && !keep {
		*errs = append(*errs, apierr.Field("categoryId", "archived", "This category is archived."))
	}
	return c, nil
}

// ledgerPickAccount loads an account for a transaction or subscription.
func ledgerPickAccount(ctx context.Context, q *store.Queries, household, id uuid.UUID, keep bool, errs *[]apierr.FieldError) (store.Account, error) {
	a, err := q.LedgerGetAccount(ctx, store.LedgerGetAccountParams{ID: id, HouseholdID: household})
	if dbx.IsNoRows(err) {
		*errs = append(*errs, apierr.Field("accountId", "not_found", "This account doesn't exist."))
		return a, nil
	}
	if err != nil {
		return a, fmt.Errorf("get account: %w", err)
	}
	if a.ArchivedAt != nil && !keep {
		*errs = append(*errs, apierr.Field("accountId", "archived", "This account is archived."))
	}
	return a, nil
}

// CreateTransaction adds an expense or income; with `repeat`, also its subscription.
func (s *Server) CreateTransaction(ctx context.Context, request gen.CreateTransactionRequestObject) (gen.CreateTransactionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Transaction
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		id := ledgerNewID(body.Id)
		existing := func() (bool, error) {
			row, err := q.LedgerGetTransactionAny(ctx, id)
			return ledgerExisting(h.ID, row.HouseholdID, row.DeletedAt, err)
		}
		if body.Id != nil {
			if found, err := existing(); err != nil || found {
				if err == nil {
					out, err = ledgerTransactionOut(ctx, q, h.ID, id)
				}
				return err
			}
		}

		occurredOn := dayFromAPI(body.OccurredOn)
		res, err := s.ledgerResolveTx(ctx, q, h, ledgerTxInput{
			Kind: body.Kind, Title: body.Title, Note: body.Note, OccurredOn: occurredOn, OccurredAt: body.OccurredAt,
			CategoryID: body.CategoryId, AccountID: body.AccountId, AmountMinor: body.AmountMinor, Currency: body.Currency,
		}, nil)
		if err != nil {
			return err
		}

		var recurringID *uuid.UUID
		var occurrenceOn *time.Time
		if body.Repeat != nil {
			freq, interval, err := ledgerRepeatRule(*body.Repeat)
			if err != nil {
				return err
			}
			subID := uuid.Must(uuid.NewV7())
			if _, err := q.LedgerInsertSubscription(ctx, store.LedgerInsertSubscriptionParams{
				ID: subID, HouseholdID: h.ID, Kind: res.Kind, Title: res.Title, Note: res.Note,
				AmountMinor: body.AmountMinor, Currency: body.Currency,
				AccountID: res.Account.ID, AccountCurrency: res.Account.Currency, CategoryID: res.Category.ID,
				Frequency: store.RecurrenceFrequency(freq), IntervalCount: int16(interval),
				StartsOn: occurredOn, NextDueOn: recurring.Occurrence(occurredOn, freq, interval, 1),
				CreatedBy: &p.UserID,
			}); err != nil {
				return fmt.Errorf("insert subscription: %w", err)
			}
			recurringID, occurrenceOn = &subID, &occurredOn
		}

		_, err = q.LedgerInsertTransaction(ctx, store.LedgerInsertTransactionParams{
			ID: id, HouseholdID: h.ID, Kind: res.Kind, Status: store.TransactionStatusPosted,
			Title: res.Title, Note: res.Note, OccurredOn: occurredOn, OccurredAt: body.OccurredAt,
			CategoryID: res.Category.ID, AccountID: res.Account.ID, AccountCurrency: res.Account.Currency,
			AmountMinor: body.AmountMinor, Currency: body.Currency, AccountAmountMinor: res.Frozen.AccountAmount,
			HomeCurrency: h.HomeCurrency, HomeAmountMinor: res.Frozen.HomeAmount,
			FxRate: res.Frozen.Rate, FxRateDate: res.Frozen.RateDate,
			RecurringID: recurringID, RecurringOccurrenceOn: occurrenceOn, CreatedBy: &p.UserID,
		})
		if dbx.IsNoRows(err) { // same id inserted concurrently
			found, err := existing()
			if err != nil {
				return err
			}
			if !found {
				return ledgerIDTaken()
			}
			if recurringID != nil { // don't leave the duplicate subscription behind
				return apierr.Conflict("id_taken", "This transaction was just added. Refresh to see it.")
			}
		} else if err != nil {
			return err
		}
		out, err = ledgerTransactionOut(ctx, q, h.ID, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.CreateTransaction201JSONResponse(out), nil
}

// ledgerRepeatRule validates a repeat rule (interval defaults to 1).
func ledgerRepeatRule(r gen.RepeatRule) (recurring.Frequency, int, error) {
	var errs []apierr.FieldError
	freq := recurring.Frequency(r.Frequency)
	if !freq.Valid() {
		errs = append(errs, apierr.Field("repeat.frequency", "invalid", "Pick weekly, monthly or yearly."))
	}
	interval := 1
	if r.IntervalCount != nil {
		interval = *r.IntervalCount
	}
	if interval < 1 || interval > recurring.MaxInterval {
		errs = append(errs, apierr.Field("repeat.intervalCount", "out_of_range", "Repeat every 1 to 52 periods."))
	}
	return freq, interval, ledgerErrs(errs)
}

// GetTransaction returns one transaction.
func (s *Server) GetTransaction(ctx context.Context, request gen.GetTransactionRequestObject) (gen.GetTransactionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	out, err := ledgerTransactionOut(ctx, s.q, p.HouseholdID, request.Id)
	if err != nil {
		return nil, err
	}
	return gen.GetTransaction200JSONResponse(out), nil
}

// UpdateTransaction replaces a transaction's editable fields and re-freezes its amounts.
// Its status and subscription link stay as they are.
func (s *Server) UpdateTransaction(ctx context.Context, request gen.UpdateTransactionRequestObject) (gen.UpdateTransactionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("bad_request", "The request needs a body.")
	}
	body := *request.Body
	var out gen.Transaction
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		current, err := ledgerGetTx(ctx, q, h.ID, request.Id)
		if err != nil {
			return err
		}
		if current.RowVersion != body.RowVersion {
			return apierr.VersionConflict()
		}
		occurredOn := dayFromAPI(body.OccurredOn)
		res, err := s.ledgerResolveTx(ctx, q, h, ledgerTxInput{
			Kind: body.Kind, Title: &body.Title, Note: body.Note, OccurredOn: occurredOn, OccurredAt: body.OccurredAt,
			CategoryID: body.CategoryId, AccountID: body.AccountId, AmountMinor: body.AmountMinor, Currency: body.Currency,
		}, &current)
		if err != nil {
			return err
		}
		_, err = q.LedgerUpdateTransaction(ctx, store.LedgerUpdateTransactionParams{
			Kind: res.Kind, Title: res.Title, Note: res.Note, OccurredOn: occurredOn, OccurredAt: body.OccurredAt,
			CategoryID: res.Category.ID, AccountID: res.Account.ID, AccountCurrency: res.Account.Currency,
			AmountMinor: body.AmountMinor, Currency: body.Currency, AccountAmountMinor: res.Frozen.AccountAmount,
			HomeCurrency: h.HomeCurrency, HomeAmountMinor: res.Frozen.HomeAmount,
			FxRate: res.Frozen.Rate, FxRateDate: res.Frozen.RateDate,
			ID: current.ID, HouseholdID: h.ID, RowVersion: body.RowVersion,
		})
		if dbx.IsNoRows(err) {
			return apierr.VersionConflict()
		}
		if err != nil {
			return err
		}
		out, err = ledgerTransactionOut(ctx, q, h.ID, current.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.UpdateTransaction200JSONResponse(out), nil
}

// DeleteTransaction soft-deletes a transaction (Undo restores it).
func (s *Server) DeleteTransaction(ctx context.Context, request gen.DeleteTransactionRequestObject) (gen.DeleteTransactionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	_, err = s.q.LedgerSoftDeleteTransaction(ctx, store.LedgerSoftDeleteTransactionParams{ID: request.Id, HouseholdID: p.HouseholdID})
	if dbx.IsNoRows(err) {
		return nil, apierr.NotFound("transaction")
	}
	if err != nil {
		return nil, fmt.Errorf("delete transaction: %w", err)
	}
	return gen.DeleteTransaction204Response{}, nil
}

// RestoreTransaction undoes a delete.
func (s *Server) RestoreTransaction(ctx context.Context, request gen.RestoreTransactionRequestObject) (gen.RestoreTransactionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	var out gen.Transaction
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		_, err := q.LedgerRestoreTransaction(ctx, store.LedgerRestoreTransactionParams{ID: request.Id, HouseholdID: p.HouseholdID})
		if dbx.IsNoRows(err) {
			return apierr.NotFound("transaction")
		}
		if err != nil {
			return err // a restored subscription occurrence can collide (duplicate_occurrence)
		}
		out, err = ledgerTransactionOut(ctx, q, p.HouseholdID, request.Id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.RestoreTransaction200JSONResponse(out), nil
}

// ConfirmTransaction posts a pending subscription charge, optionally with the real amount.
func (s *Server) ConfirmTransaction(ctx context.Context, request gen.ConfirmTransactionRequestObject) (gen.ConfirmTransactionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	var out gen.Transaction
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		h, err := s.loadHousehold(ctx, q, p.HouseholdID)
		if err != nil {
			return err
		}
		t, err := ledgerGetTx(ctx, q, h.ID, request.Id)
		if err != nil {
			return err
		}
		if t.Status != store.TransactionStatusPending {
			return ledgerNotPending()
		}
		params := store.LedgerConfirmTransactionParams{
			AmountMinor: t.AmountMinor, AccountAmountMinor: t.AccountAmountMinor,
			HomeCurrency: t.HomeCurrency, HomeAmountMinor: t.HomeAmountMinor,
			FxRate: t.FxRate, FxRateDate: t.FxRateDate, ID: t.ID, HouseholdID: h.ID,
		}
		if request.Body != nil && request.Body.AmountMinor != nil {
			amount := *request.Body.AmountMinor
			if amount < 1 {
				return apierr.Validation(apierr.Field("amountMinor", "too_small", "Enter an amount above zero."))
			}
			if amountTooLarge(amount) {
				return apierr.Validation(tooLargeField("amountMinor"))
			}
			fr, err := ledgerFreeze(ctx, q, amount, t.Currency, t.AccountCurrency, h.HomeCurrency, t.OccurredOn)
			if err != nil {
				return err
			}
			params.AmountMinor, params.AccountAmountMinor = amount, fr.AccountAmount
			params.HomeCurrency, params.HomeAmountMinor = h.HomeCurrency, fr.HomeAmount
			params.FxRate, params.FxRateDate = fr.Rate, fr.RateDate
		}
		if _, err := q.LedgerConfirmTransaction(ctx, params); dbx.IsNoRows(err) {
			return ledgerNotPending()
		} else if err != nil {
			return err
		}
		out, err = ledgerTransactionOut(ctx, q, h.ID, t.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.ConfirmTransaction200JSONResponse(out), nil
}

// SkipTransaction marks a pending subscription charge as not happened this time.
func (s *Server) SkipTransaction(ctx context.Context, request gen.SkipTransactionRequestObject) (gen.SkipTransactionResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	var out gen.Transaction
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		t, err := ledgerGetTx(ctx, q, p.HouseholdID, request.Id)
		if err != nil {
			return err
		}
		if t.Status != store.TransactionStatusPending {
			return ledgerNotPending()
		}
		if _, err := q.LedgerSkipTransaction(ctx, store.LedgerSkipTransactionParams{ID: t.ID, HouseholdID: p.HouseholdID}); dbx.IsNoRows(err) {
			return ledgerNotPending()
		} else if err != nil {
			return err
		}
		out, err = ledgerTransactionOut(ctx, q, p.HouseholdID, t.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return gen.SkipTransaction200JSONResponse(out), nil
}

func ledgerNotPending() *apierr.Error {
	return apierr.Conflict("not_pending", "This payment isn't waiting for confirmation anymore.")
}

// ledgerGetTx loads a live transaction of the household (404 otherwise).
func ledgerGetTx(ctx context.Context, q *store.Queries, household, id uuid.UUID) (store.Transaction, error) {
	r, err := q.LedgerGetTransaction(ctx, store.LedgerGetTransactionParams{ID: id, HouseholdID: household})
	if dbx.IsNoRows(err) {
		return store.Transaction{}, apierr.NotFound("transaction")
	}
	if err != nil {
		return store.Transaction{}, fmt.Errorf("get transaction: %w", err)
	}
	return r.Transaction, nil
}

func ledgerTransactionOut(ctx context.Context, q *store.Queries, household, id uuid.UUID) (gen.Transaction, error) {
	r, err := q.LedgerGetTransaction(ctx, store.LedgerGetTransactionParams{ID: id, HouseholdID: household})
	if dbx.IsNoRows(err) {
		return gen.Transaction{}, apierr.NotFound("transaction")
	}
	if err != nil {
		return gen.Transaction{}, fmt.Errorf("get transaction: %w", err)
	}
	return ledgerTransaction(r.Transaction, r.Category, r.Account), nil
}
