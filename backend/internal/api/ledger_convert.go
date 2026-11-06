package api

import (
	"context"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/recurring"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Conversions from store rows to API objects for the ledger resources (accounts,
// categories, transactions, subscriptions), plus the small validation helpers they share.

func ledgerCategoryRef(c store.Category) gen.CategoryRef {
	return gen.CategoryRef{
		Id:      c.ID,
		Kind:    gen.EntryKind(c.Kind),
		Name:    c.Name,
		Color:   gen.CategoryColor(c.Color),
		Icon:    c.Icon,
		IsFixed: c.IsFixed,
	}
}

func ledgerAccountRef(a store.Account) gen.AccountRef {
	return gen.AccountRef{Id: a.ID, Name: a.Name, Type: gen.AccountType(a.Type), Currency: a.Currency}
}

func ledgerCategory(c store.Category) gen.Category {
	return gen.Category{
		Id:         c.ID,
		Kind:       gen.EntryKind(c.Kind),
		Name:       c.Name,
		Color:      gen.CategoryColor(c.Color),
		Icon:       c.Icon,
		IsFixed:    c.IsFixed,
		SortOrder:  int(c.SortOrder),
		SystemKey:  c.SystemKey,
		Archived:   c.ArchivedAt != nil,
		RowVersion: c.RowVersion,
	}
}

func ledgerAccount(a store.Account, balanceMinor int64, balanceHome pgtype.Numeric) gen.Account {
	return gen.Account{
		Id:                  a.ID,
		Name:                a.Name,
		Type:                gen.AccountType(a.Type),
		Currency:            a.Currency,
		OpeningBalanceMinor: a.OpeningBalanceMinor,
		OpeningBalanceOn:    apiDate(a.OpeningBalanceOn),
		IncludeInTotal:      a.IncludeInTotal,
		SortOrder:           int(a.SortOrder),
		Archived:            a.ArchivedAt != nil,
		BalanceMinor:        balanceMinor,
		BalanceHomeMinor:    ledgerNumericInt64(balanceHome),
		RowVersion:          a.RowVersion,
		CreatedAt:           a.CreatedAt,
		UpdatedAt:           a.UpdatedAt,
	}
}

// ledgerTransaction converts a transaction with its category and account.
func ledgerTransaction(t store.Transaction, c store.Category, a store.Account) gen.Transaction {
	rate := "1"
	if t.Currency != t.HomeCurrency {
		rate = numericString(t.FxRate)
	}
	return gen.Transaction{
		Id:                    t.ID,
		Kind:                  gen.EntryKind(t.Kind),
		Status:                gen.TransactionStatus(t.Status),
		Title:                 t.Title,
		Note:                  t.Note,
		OccurredOn:            apiDate(t.OccurredOn),
		OccurredAt:            t.OccurredAt,
		Category:              ledgerCategoryRef(c),
		Account:               ledgerAccountRef(a),
		AmountMinor:           t.AmountMinor,
		Currency:              t.Currency,
		AccountAmountMinor:    t.AccountAmountMinor,
		AccountCurrency:       t.AccountCurrency,
		HomeAmountMinor:       t.HomeAmountMinor,
		HomeCurrency:          t.HomeCurrency,
		FxRate:                rate,
		FxRateDate:            apiDatePtr(t.FxRateDate),
		RecurringId:           t.RecurringID,
		RecurringOccurrenceOn: apiDatePtr(t.RecurringOccurrenceOn),
		RowVersion:            t.RowVersion,
		CreatedAt:             t.CreatedAt,
		UpdatedAt:             t.UpdatedAt,
	}
}

// ledgerSubRow is a subscription with what its API object needs; the list and get
// queries both produce it.
type ledgerSubRow struct {
	R         store.RecurringTransaction
	A         store.Account
	C         store.Category
	HomeRate  pgtype.Numeric // home currency per one unit of R.Currency today; invalid when missing
	FromMinor int16
	HomeMinor int16
	HomeCode  string
}

// ledgerSubActive: switched on and not past its last day.
func ledgerSubActive(r store.RecurringTransaction) bool {
	return r.IsActive && (r.EndsOn == nil || !r.NextDueOn.After(*r.EndsOn))
}

// homeExact is the subscription's amount in home minor units at today's rate, exact
// (nil when the rate is missing).
func (row ledgerSubRow) homeExact() *big.Rat {
	amount := new(big.Rat).SetInt64(row.R.AmountMinor)
	if row.R.Currency == row.HomeCode {
		return amount
	}
	rate, ok := ledgerNumericRat(row.HomeRate)
	if !ok {
		return nil
	}
	amount.Mul(amount, rate)
	return amount.Mul(amount, ledgerPow10(int(row.HomeMinor)-int(row.FromMinor)))
}

// monthlyExact is the cost per month in home minor units, exact (nil without a rate).
func (row ledgerSubRow) monthlyExact() *big.Rat {
	home := row.homeExact()
	if home == nil {
		return nil
	}
	return recurring.MonthlyCost(home, recurring.Frequency(row.R.Frequency), int(row.R.IntervalCount))
}

func ledgerSubscription(row ledgerSubRow, today time.Time) gen.Subscription {
	r := row.R
	out := gen.Subscription{
		Id:            r.ID,
		Kind:          gen.EntryKind(r.Kind),
		Title:         r.Title,
		Note:          r.Note,
		AmountMinor:   r.AmountMinor,
		Currency:      r.Currency,
		Account:       ledgerAccountRef(row.A),
		Category:      ledgerCategoryRef(row.C),
		Frequency:     gen.Frequency(r.Frequency),
		IntervalCount: int(r.IntervalCount),
		StartsOn:      apiDate(r.StartsOn),
		NextDueOn:     apiDate(r.NextDueOn),
		EndsOn:        apiDatePtr(r.EndsOn),
		DaysUntilDue:  budget.DaysBetween(today, r.NextDueOn),
		IsActive:      r.IsActive,
		RowVersion:    r.RowVersion,
	}
	if home := row.homeExact(); home != nil {
		out.AmountHomeMinor = ptr(recurring.RoundHalfAway(home))
		out.MonthlyHomeMinor = ptr(recurring.RoundHalfAway(row.monthlyExact()))
	}
	return out
}

// ledgerSubTotals sums the active expense subscriptions (DB doc § 8), exactly, rounding once.
func ledgerSubTotals(rows []ledgerSubRow) subscriptionTotals {
	var t subscriptionTotals
	month := new(big.Rat)
	for _, row := range rows {
		if row.R.Kind != store.EntryKindExpense || !ledgerSubActive(row.R) {
			continue
		}
		t.ActiveCount++
		if row.R.Currency != row.HomeCode {
			t.IsApproximate = true
		}
		if m := row.monthlyExact(); m != nil {
			month.Add(month, m)
		}
	}
	t.PerMonthMinor = recurring.RoundHalfAway(month)
	t.PerYearMinor = recurring.RoundHalfAway(new(big.Rat).Mul(month, big.NewRat(12, 1)))
	return t
}

// ---------------------------------------------------------------- numeric helpers

func ledgerPow10(n int) *big.Rat {
	p := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(ledgerAbs(n))), nil)
	if n >= 0 {
		return new(big.Rat).SetInt(p)
	}
	return new(big.Rat).SetFrac(big.NewInt(1), p)
}

func ledgerAbs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// ledgerNumericRat turns a numeric into an exact fraction.
func ledgerNumericRat(n pgtype.Numeric) (*big.Rat, bool) {
	if !n.Valid || n.NaN || n.InfinityModifier != pgtype.Finite || n.Int == nil {
		return nil, false
	}
	r := new(big.Rat).SetInt(n.Int)
	return r.Mul(r, ledgerPow10(int(n.Exp))), true
}

// ledgerNumericInt64 reads a whole-number numeric (a converted amount); nil when NULL.
func ledgerNumericInt64(n pgtype.Numeric) *int64 {
	r, ok := ledgerNumericRat(n)
	if !ok {
		return nil
	}
	v := recurring.RoundHalfAway(r) // already whole; rounding only guards against surprises
	return &v
}

// ---------------------------------------------------------------- validation helpers

var ledgerIconPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ledgerText trims s and checks its length in characters. Returns the trimmed value.
func ledgerText(field, s string, minLen, maxLen int, errs *[]apierr.FieldError) string {
	s = strings.TrimSpace(s)
	n := utf8.RuneCountInString(s)
	switch {
	case n == 0 && minLen > 0:
		*errs = append(*errs, apierr.Field(field, "required", "This can't be empty."))
	case n < minLen:
		*errs = append(*errs, apierr.Field(field, "too_short", "This is too short."))
	case n > maxLen:
		*errs = append(*errs, apierr.Field(field, "too_long", "This is too long."))
	}
	return s
}

// ledgerNote normalizes an optional note: empty means none.
func ledgerNote(note *string, errs *[]apierr.FieldError) *string {
	if note == nil {
		return nil
	}
	v := strings.TrimSpace(*note)
	if v == "" {
		return nil
	}
	if utf8.RuneCountInString(v) > 500 {
		*errs = append(*errs, apierr.Field("note", "too_long", "Notes can be up to 500 characters."))
	}
	return &v
}

// ledgerCurrency checks that a currency code is supported.
func (s *Server) ledgerCurrency(ctx context.Context, q *store.Queries, field, code string, errs *[]apierr.FieldError) (store.Currency, error) {
	c, err := q.LedgerGetCurrency(ctx, code)
	if dbx.IsNoRows(err) {
		*errs = append(*errs, apierr.Field(field, "unsupported", "This currency isn't supported."))
		return store.Currency{}, nil
	}
	return c, err
}

func ledgerErrs(errs []apierr.FieldError) error {
	if len(errs) > 0 {
		return apierr.Validation(errs...)
	}
	return nil
}

// ledgerNewID is the client's id or a new v7.
func ledgerNewID(id *uuid.UUID) uuid.UUID {
	if id != nil && *id != uuid.Nil {
		return *id
	}
	return uuid.Must(uuid.NewV7())
}

// ledgerIDTaken answers a create whose client id belongs to something else.
func ledgerIDTaken() *apierr.Error {
	return apierr.Conflict("id_taken", "This id is already used by something else.")
}
