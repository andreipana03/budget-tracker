package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

// Integration tests for the ledger endpoints (household, reference, accounts, categories,
// transactions, subscriptions). They run in 2033 with their own BNR rates so they never
// collide with the dev seed or other tests:
//
//	EUR: Fri 2033-03-04 4.9750, Mon 2033-03-07 4.9800
//	JPY: Fri 2033-03-04 0.03125
//
// Today is Tue 2033-03-15 (Europe/Bucharest).

var ledgerTNow = time.Date(2033, time.March, 15, 10, 0, 0, 0, time.UTC)

type ledgerTAuth struct{ p Principal }

func (a ledgerTAuth) Authenticate(context.Context, *http.Request) (Principal, error) { return a.p, nil }

type ledgerTEnv struct {
	t    *testing.T
	pool *pgxpool.Pool
	f    testdb.Fixture
	h    http.Handler
}

func ledgerTSetup(t *testing.T) *ledgerTEnv {
	t.Helper()
	pool := testdb.Pool(t)
	ledgerTRates(t, pool)
	f := testdb.NewHousehold(t, pool)
	return ledgerTEnvFor(t, pool, f)
}

func ledgerTEnvFor(t *testing.T, pool *pgxpool.Pool, f testdb.Fixture) *ledgerTEnv {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := NewServer(Deps{Pool: pool, Logger: logger, Clock: clock.Fixed{T: ledgerTNow}})
	h := NewRouter(srv, logger, RouterOptions{Authenticator: ledgerTAuth{Principal{
		UserID: f.UserID, SessionID: uuid.Must(uuid.NewV7()), HouseholdID: f.HouseholdID,
	}}})
	return &ledgerTEnv{t: t, pool: pool, f: f, h: h}
}

func ledgerTRates(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO fx_rates (source, base_currency, quote_currency, rate_date, rate) VALUES
			('BNR', 'RON', 'EUR', '2033-03-04', 4.9750),
			('BNR', 'RON', 'EUR', '2033-03-07', 4.9800),
			('BNR', 'RON', 'JPY', '2033-03-04', 0.03125)
		ON CONFLICT DO NOTHING`)
	if err != nil {
		t.Fatalf("insert rates: %v", err)
	}
}

// do sends a request and decodes the JSON answer into out (when non-nil and 2xx).
func (e *ledgerTEnv) do(method, path string, body any, out any) (int, gen.Error) {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("encode body: %v", err)
		}
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var apiErr gen.Error
	if rec.Code >= 300 {
		_ = json.Unmarshal(rec.Body.Bytes(), &apiErr)
		return rec.Code, apiErr
	}
	if out != nil && rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			e.t.Fatalf("%s %s: decode %s: %v", method, path, rec.Body.String(), err)
		}
	}
	return rec.Code, apiErr
}

// must is do + a status check.
func (e *ledgerTEnv) must(want int, method, path string, body any, out any) {
	e.t.Helper()
	if code, apiErr := e.do(method, path, body, out); code != want {
		e.t.Fatalf("%s %s: status %d (%s: %s %v), want %d", method, path, code, apiErr.Code, apiErr.Message, apiErr.Fields, want)
	}
}

// fails checks a status and an error code.
func (e *ledgerTEnv) fails(wantStatus int, wantCode, method, path string, body any) gen.Error {
	e.t.Helper()
	code, apiErr := e.do(method, path, body, nil)
	if code != wantStatus || apiErr.Code != wantCode {
		e.t.Fatalf("%s %s: got %d %q (%s), want %d %q", method, path, code, apiErr.Code, apiErr.Message, wantStatus, wantCode)
	}
	return apiErr
}

func (e *ledgerTEnv) category(systemKey string) uuid.UUID {
	e.t.Helper()
	var id uuid.UUID
	if err := e.pool.QueryRow(context.Background(),
		`SELECT id FROM categories WHERE household_id = $1 AND system_key = $2`, e.f.HouseholdID, systemKey).Scan(&id); err != nil {
		e.t.Fatalf("category %s: %v", systemKey, err)
	}
	return id
}

func (e *ledgerTEnv) account(name, currency string, opening int64) gen.Account {
	e.t.Helper()
	var a gen.Account
	e.must(http.StatusCreated, http.MethodPost, "/accounts", map[string]any{
		"name": name, "type": "bank", "currency": currency, "openingBalanceMinor": opening, "openingBalanceOn": "2033-03-01",
	}, &a)
	return a
}

func (e *ledgerTEnv) expense(account uuid.UUID, category uuid.UUID, on string, amount int64, currency string, extra map[string]any) gen.Transaction {
	e.t.Helper()
	body := map[string]any{
		"kind": "expense", "occurredOn": on, "categoryId": category, "accountId": account,
		"amountMinor": amount, "currency": currency,
	}
	for k, v := range extra {
		body[k] = v
	}
	var tx gen.Transaction
	e.must(http.StatusCreated, http.MethodPost, "/transactions", body, &tx)
	return tx
}

func ledgerTEq[T comparable](t *testing.T, what string, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
}

func ledgerTDate(t *testing.T, d *gen.Transaction) string { return d.OccurredOn.Format(time.DateOnly) }

// ---------------------------------------------------------------- household & reference

func TestLedgerHousehold(t *testing.T) {
	e := ledgerTSetup(t)
	var h gen.Household
	e.must(http.StatusOK, http.MethodGet, "/household", nil, &h)
	ledgerTEq(t, "home", h.HomeCurrency, "RON")
	ledgerTEq(t, "today", h.Today.Format(time.DateOnly), "2033-03-15")
	ledgerTEq(t, "month", h.CurrentMonth, "2033-03")
	ledgerTEq(t, "can change", h.CanChangeHomeCurrency, true)

	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPatch, "/household", map[string]any{"timezone": "Mars/Olympus"})
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPatch, "/household", map[string]any{"monthStartDay": 29})
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPatch, "/household", map[string]any{"name": "  "})
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPatch, "/household", map[string]any{"homeCurrency": "XYZ"})

	e.must(http.StatusOK, http.MethodPatch, "/household", map[string]any{
		"name": " Home ", "timezone": "Pacific/Kiritimati", "monthStartDay": 16, "homeCurrency": "EUR",
	}, &h)
	ledgerTEq(t, "name", h.Name, "Home")
	ledgerTEq(t, "home", h.HomeCurrency, "EUR")
	ledgerTEq(t, "zone", h.Timezone, "Pacific/Kiritimati")
	// 10:00 UTC is midnight of the next day in UTC+14, and 16 March starts the March budget month.
	ledgerTEq(t, "today", h.Today.Format(time.DateOnly), "2033-03-16")
	ledgerTEq(t, "month", h.CurrentMonth, "2033-03")
	e.must(http.StatusOK, http.MethodPatch, "/household", map[string]any{"homeCurrency": "RON", "monthStartDay": 1, "timezone": "Europe/Bucharest"}, &h)

	// Once there is a transaction the home currency is locked.
	acc := e.account("Card", "RON", 0)
	e.expense(acc.Id, e.category("groceries"), "2033-03-10", 1000, "RON", nil)
	e.must(http.StatusOK, http.MethodGet, "/household", nil, &h)
	ledgerTEq(t, "can change", h.CanChangeHomeCurrency, false)
	e.fails(http.StatusConflict, "home_currency_locked", http.MethodPatch, "/household", map[string]any{"homeCurrency": "EUR"})
	// Sending the current one is not a change.
	e.must(http.StatusOK, http.MethodPatch, "/household", map[string]any{"homeCurrency": "RON"}, &h)
}

func TestLedgerReference(t *testing.T) {
	e := ledgerTSetup(t)
	var cur []gen.Currency
	e.must(http.StatusOK, http.MethodGet, "/currencies", nil, &cur)
	byCode := map[string]int{}
	for _, c := range cur {
		byCode[c.Code] = c.MinorUnits
	}
	ledgerTEq(t, "RON minor", byCode["RON"], 2)
	ledgerTEq(t, "JPY minor", byCode["JPY"], 0)

	var q gen.FxQuote
	e.must(http.StatusOK, http.MethodGet, "/fx/quote?from=EUR&to=RON&on=2033-03-06&amountMinor=999", nil, &q)
	ledgerTEq(t, "rate", q.Rate, "4.9750000000")
	ledgerTEq(t, "rate date", q.RateDate.Format(time.DateOnly), "2033-03-04")
	ledgerTEq(t, "amount", *q.AmountMinor, int64(4970)) // 999 × 4.975 = 4970.025

	// Default day is the household's today; no amount → no amountMinor.
	q = gen.FxQuote{}
	e.must(http.StatusOK, http.MethodGet, "/fx/quote?from=EUR&to=RON", nil, &q)
	ledgerTEq(t, "on", q.On.Format(time.DateOnly), "2033-03-15")
	ledgerTEq(t, "rate", q.Rate, "4.9800000000")
	if q.AmountMinor != nil {
		t.Fatalf("amountMinor = %d, want none", *q.AmountMinor)
	}

	e.must(http.StatusOK, http.MethodGet, "/fx/quote?from=RON&to=RON&amountMinor=123", nil, &q)
	ledgerTEq(t, "same rate", q.Rate, "1")
	if q.RateDate != nil || *q.AmountMinor != 123 {
		t.Fatalf("same currency quote = %+v", q)
	}

	e.fails(http.StatusUnprocessableEntity, "fx_rate_unavailable", http.MethodGet, "/fx/quote?from=SEK&to=RON&on=1990-01-02", nil)
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodGet, "/fx/quote?from=XYZ&to=RON", nil)
}

// ---------------------------------------------------------------- accounts

func TestLedgerAccounts(t *testing.T) {
	e := ledgerTSetup(t)
	ron := e.account("ING Card", "RON", 10000)
	eur := e.account("Revolut", "EUR", 5000)
	ledgerTEq(t, "rowVersion set", ron.RowVersion > 0, true)
	ledgerTEq(t, "eur balance", eur.BalanceMinor, int64(5000))
	ledgerTEq(t, "eur ≈ home", *eur.BalanceHomeMinor, int64(24900)) // 50 € × 4.98

	// A credit card with a negative balance converts with half-away-from-zero rounding.
	var card gen.Account
	e.must(http.StatusCreated, http.MethodPost, "/accounts", map[string]any{
		"name": "Credit", "type": "credit_card", "currency": "EUR", "openingBalanceMinor": -1001,
		"openingBalanceOn": "2033-03-01", "includeInTotal": false,
	}, &card)
	ledgerTEq(t, "negative ≈ home", *card.BalanceHomeMinor, int64(-4985)) // −10.01 × 4.98 = −49.8498

	// Spending moves the balance (in the account's currency).
	e.expense(eur.Id, e.category("fun"), "2033-03-06", 999, "EUR", nil)
	e.expense(ron.Id, e.category("groceries"), "2033-03-06", 2500, "RON", nil)

	var list gen.AccountList
	e.must(http.StatusOK, http.MethodGet, "/accounts", nil, &list)
	ledgerTEq(t, "items", len(list.Items), 3)
	ledgerTEq(t, "order", list.Items[0].Name, "ING Card")
	ledgerTEq(t, "ron balance", list.Items[0].BalanceMinor, int64(7500))
	ledgerTEq(t, "eur balance", list.Items[1].BalanceMinor, int64(4001))
	ledgerTEq(t, "eur ≈", *list.Items[1].BalanceHomeMinor, int64(19925)) // 40.01 × 4.98 = 199.2498
	ledgerTEq(t, "total", list.TotalHomeMinor, int64(7500+19925))           // the card isn't included
	ledgerTEq(t, "≈", list.TotalIsApproximate, true)
	ledgerTEq(t, "home", list.HomeCurrency, "RON")

	// Optimistic concurrency.
	update := map[string]any{
		"name": "ING", "type": "bank", "currency": "RON", "openingBalanceMinor": 10000, "openingBalanceOn": "2033-03-01",
		"includeInTotal": true, "sortOrder": 5, "archived": false, "rowVersion": ron.RowVersion,
	}
	var updated gen.Account
	e.must(http.StatusOK, http.MethodPut, "/accounts/"+ron.Id.String(), update, &updated)
	ledgerTEq(t, "renamed", updated.Name, "ING")
	ledgerTEq(t, "version moved", updated.RowVersion > ron.RowVersion, true)
	e.fails(http.StatusConflict, "version_conflict", http.MethodPut, "/accounts/"+ron.Id.String(), update)

	// Currency is locked once used.
	update["rowVersion"], update["currency"] = updated.RowVersion, "EUR"
	e.fails(http.StatusConflict, "account_currency_locked", http.MethodPut, "/accounts/"+ron.Id.String(), update)
	// …but not on an unused account.
	var empty gen.Account
	e.must(http.StatusCreated, http.MethodPost, "/accounts", map[string]any{"name": "Spare", "type": "cash", "currency": "RON"}, &empty)
	ledgerTEq(t, "opening day defaults to today", empty.OpeningBalanceOn.Format(time.DateOnly), "2033-03-15")
	e.must(http.StatusOK, http.MethodPut, "/accounts/"+empty.Id.String(), map[string]any{
		"name": "Spare", "type": "cash", "currency": "USD", "openingBalanceMinor": 0, "openingBalanceOn": "2033-03-15",
		"includeInTotal": true, "sortOrder": 9, "archived": true, "rowVersion": empty.RowVersion,
	}, &empty)
	ledgerTEq(t, "currency changed", empty.Currency, "USD")
	ledgerTEq(t, "archived", empty.Archived, true)

	// Archived accounts leave the default list and the total.
	e.must(http.StatusOK, http.MethodGet, "/accounts", nil, &list)
	ledgerTEq(t, "without archived", len(list.Items), 3)
	e.must(http.StatusOK, http.MethodGet, "/accounts?includeArchived=true", nil, &list)
	ledgerTEq(t, "with archived", len(list.Items), 4)

	// Names are unique.
	e.fails(http.StatusConflict, "name_taken", http.MethodPost, "/accounts", map[string]any{"name": "revolut", "type": "bank", "currency": "EUR"})
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/accounts", map[string]any{"name": "X", "type": "piggy", "currency": "RON"})

	// Delete: archive when it has history, delete otherwise.
	var res gen.DeleteResult
	e.must(http.StatusOK, http.MethodDelete, "/accounts/"+eur.Id.String(), nil, &res)
	ledgerTEq(t, "eur outcome", res.Outcome, gen.DeleteResultOutcomeArchived)
	e.must(http.StatusOK, http.MethodDelete, "/accounts/"+empty.Id.String(), nil, &res)
	ledgerTEq(t, "empty outcome", res.Outcome, gen.DeleteResultOutcomeDeleted)
	e.must(http.StatusOK, http.MethodGet, "/accounts?includeArchived=true", nil, &list)
	ledgerTEq(t, "after deletes", len(list.Items), 3)
	e.fails(http.StatusNotFound, "not_found", http.MethodDelete, "/accounts/"+empty.Id.String(), nil)
}

func TestLedgerIdempotentCreateAndIsolation(t *testing.T) {
	e := ledgerTSetup(t)
	other := ledgerTEnvFor(t, e.pool, testdb.NewHousehold(t, e.pool))

	id := uuid.Must(uuid.NewV7())
	body := map[string]any{"id": id, "name": "Cash", "type": "cash", "currency": "RON"}
	var first, second gen.Account
	e.must(http.StatusCreated, http.MethodPost, "/accounts", body, &first)
	e.must(http.StatusCreated, http.MethodPost, "/accounts", body, &second)
	ledgerTEq(t, "same id", second.Id, id)
	ledgerTEq(t, "same version", second.RowVersion, first.RowVersion)
	other.fails(http.StatusConflict, "id_taken", http.MethodPost, "/accounts", body)

	// Idempotent transaction create.
	txID := uuid.Must(uuid.NewV7())
	tx1 := e.expense(id, e.category("groceries"), "2033-03-10", 1500, "RON", map[string]any{"id": txID})
	tx2 := e.expense(id, e.category("groceries"), "2033-03-10", 1500, "RON", map[string]any{"id": txID})
	ledgerTEq(t, "same tx", tx2.Id, tx1.Id)
	var page gen.TransactionPage
	e.must(http.StatusOK, http.MethodGet, "/transactions", nil, &page)
	ledgerTEq(t, "one row", len(page.Items), 1)

	// Another household sees none of it.
	other.fails(http.StatusNotFound, "not_found", http.MethodGet, "/transactions/"+txID.String(), nil)
	other.fails(http.StatusNotFound, "not_found", http.MethodDelete, "/transactions/"+txID.String(), nil)
	other.fails(http.StatusNotFound, "not_found", http.MethodPost, "/transactions/"+txID.String()+"/skip", nil)
	other.fails(http.StatusNotFound, "not_found", http.MethodDelete, "/accounts/"+id.String(), nil)
	other.fails(http.StatusNotFound, "not_found", http.MethodPut, "/accounts/"+id.String(), map[string]any{
		"name": "Mine", "type": "cash", "currency": "RON", "openingBalanceMinor": 0, "openingBalanceOn": "2033-03-01",
		"includeInTotal": true, "sortOrder": 0, "archived": false, "rowVersion": first.RowVersion,
	})
	// …and can't use its account or category.
	other.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transactions", map[string]any{
		"kind": "expense", "occurredOn": "2033-03-10", "categoryId": e.category("groceries"), "accountId": id,
		"amountMinor": 100, "currency": "RON",
	})
	other.must(http.StatusOK, http.MethodGet, "/transactions", nil, &page)
	ledgerTEq(t, "other sees nothing", len(page.Items), 0)
	var cats []gen.Category
	other.must(http.StatusOK, http.MethodGet, "/categories", nil, &cats)
	for _, c := range cats {
		if c.Id == e.category("groceries") {
			t.Fatal("other household sees our category")
		}
	}
}

// ---------------------------------------------------------------- categories

func TestLedgerCategories(t *testing.T) {
	e := ledgerTSetup(t)
	var cats []gen.Category
	e.must(http.StatusOK, http.MethodGet, "/categories", nil, &cats)
	ledgerTEq(t, "defaults", len(cats), 13)
	ledgerTEq(t, "first", cats[0].Name, "Groceries")
	ledgerTEq(t, "last kind", cats[12].Kind, gen.EntryKindIncome)
	ledgerTEq(t, "system key", *cats[0].SystemKey, "groceries")

	var c gen.Category
	e.must(http.StatusCreated, http.MethodPost, "/categories", map[string]any{
		"kind": "expense", "name": "Gym", "color": "teal", "icon": "barbell", "isFixed": true,
	}, &c)
	ledgerTEq(t, "sort after defaults", c.SortOrder, 90)
	if c.SystemKey != nil {
		t.Fatal("custom category has a system key")
	}
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/categories", map[string]any{
		"kind": "income", "name": "Rent in", "color": "green", "icon": "house", "isFixed": true,
	})
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/categories", map[string]any{
		"kind": "expense", "name": "Bad", "color": "red", "icon": "Bad_Icon",
	})
	e.fails(http.StatusConflict, "name_taken", http.MethodPost, "/categories", map[string]any{
		"kind": "expense", "name": "gym", "color": "teal", "icon": "barbell",
	})
	// Same name is fine for the other kind.
	e.must(http.StatusCreated, http.MethodPost, "/categories", map[string]any{
		"kind": "income", "name": "Gym", "color": "green", "icon": "barbell",
	}, nil)

	upd := map[string]any{"name": "Fitness", "color": "mint", "icon": "barbell", "isFixed": false, "sortOrder": 5,
		"archived": false, "rowVersion": c.RowVersion}
	var u gen.Category
	e.must(http.StatusOK, http.MethodPut, "/categories/"+c.Id.String(), upd, &u)
	ledgerTEq(t, "renamed", u.Name, "Fitness")
	ledgerTEq(t, "kind kept", u.Kind, gen.EntryKindExpense)
	e.fails(http.StatusConflict, "version_conflict", http.MethodPut, "/categories/"+c.Id.String(), upd)

	// Delete: unused → deleted; used → archived.
	var res gen.DeleteResult
	e.must(http.StatusOK, http.MethodDelete, "/categories/"+c.Id.String(), nil, &res)
	ledgerTEq(t, "unused", res.Outcome, gen.DeleteResultOutcomeDeleted)
	acc := e.account("Card", "RON", 0)
	e.expense(acc.Id, e.category("fun"), "2033-03-10", 100, "RON", nil)
	e.must(http.StatusOK, http.MethodDelete, "/categories/"+e.category("fun").String(), nil, &res)
	ledgerTEq(t, "used", res.Outcome, gen.DeleteResultOutcomeArchived)
	e.must(http.StatusOK, http.MethodGet, "/categories", nil, &cats)
	ledgerTEq(t, "fun hidden, gym income added", len(cats), 13)
	e.must(http.StatusOK, http.MethodGet, "/categories?includeArchived=true", nil, &cats)
	ledgerTEq(t, "with archived", len(cats), 14)
	// An archived category can't be picked for a new transaction.
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transactions", map[string]any{
		"kind": "expense", "occurredOn": "2033-03-10", "categoryId": e.category("fun"), "accountId": acc.Id,
		"amountMinor": 100, "currency": "RON",
	})
}

// ---------------------------------------------------------------- transactions

func TestLedgerTransactionAmounts(t *testing.T) {
	e := ledgerTSetup(t)
	ron := e.account("ING", "RON", 0)
	eur := e.account("Revolut", "EUR", 0)
	jpy := e.account("Japan", "JPY", 0)
	fun := e.category("fun")

	// 9,99 € on Sunday on a RON account: Friday's rate.
	tx := e.expense(ron.Id, fun, "2033-03-06", 999, "EUR", map[string]any{"title": "  Steam  "})
	ledgerTEq(t, "title trimmed", tx.Title, "Steam")
	ledgerTEq(t, "account amount", tx.AccountAmountMinor, int64(4970))
	ledgerTEq(t, "account currency", tx.AccountCurrency, "RON")
	ledgerTEq(t, "home amount", tx.HomeAmountMinor, int64(4970))
	ledgerTEq(t, "rate", tx.FxRate, "4.9750000000")
	ledgerTEq(t, "rate date", tx.FxRateDate.Format(time.DateOnly), "2033-03-04")
	ledgerTEq(t, "status", tx.Status, gen.TransactionStatusPosted)
	ledgerTEq(t, "category ref", tx.Category.Name, "Fun")
	ledgerTEq(t, "account ref", tx.Account.Name, "ING")

	// EUR on a EUR account: account amount unchanged, home converted with Monday's rate.
	tx = e.expense(eur.Id, fun, "2033-03-07", 1000, "EUR", nil)
	ledgerTEq(t, "eur account amount", tx.AccountAmountMinor, int64(1000))
	ledgerTEq(t, "eur home", tx.HomeAmountMinor, int64(4980))
	ledgerTEq(t, "title defaults to category", tx.Title, "Fun")

	// RON at home: rate "1", no rate date.
	tx = e.expense(ron.Id, fun, "2033-03-07", 1234, "RON", map[string]any{"note": "", "occurredAt": "2033-03-07T19:14:00+02:00"})
	ledgerTEq(t, "rate", tx.FxRate, "1")
	if tx.FxRateDate != nil || tx.Note != nil {
		t.Fatalf("rate date %v, note %v; want none", tx.FxRateDate, tx.Note)
	}
	ledgerTEq(t, "occurredAt", tx.OccurredAt.UTC().Format(time.RFC3339), "2033-03-07T17:14:00Z")

	// JPY (0 minor units): 1236 ¥ × 0.03125 = 38,625 lei → 3863 bani (half away from zero).
	tx = e.expense(ron.Id, fun, "2033-03-08", 1236, "JPY", nil)
	ledgerTEq(t, "jpy home", tx.HomeAmountMinor, int64(3863))
	// 10,00 lei on a JPY account: 32 ¥ per leu → 320 ¥.
	tx = e.expense(jpy.Id, fun, "2033-03-08", 1000, "RON", nil)
	ledgerTEq(t, "jpy account amount", tx.AccountAmountMinor, int64(320))
	ledgerTEq(t, "home", tx.HomeAmountMinor, int64(1000))

	// Missing rate → 422, nothing saved.
	e.fails(http.StatusUnprocessableEntity, "fx_rate_unavailable", http.MethodPost, "/transactions", map[string]any{
		"kind": "expense", "occurredOn": "1990-01-02", "categoryId": fun, "accountId": ron.Id, "amountMinor": 100, "currency": "SEK",
	})
	// Kind must match the category.
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transactions", map[string]any{
		"kind": "income", "occurredOn": "2033-03-08", "categoryId": fun, "accountId": ron.Id, "amountMinor": 100, "currency": "RON",
	})
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transactions", map[string]any{
		"kind": "expense", "occurredOn": "2033-03-08", "categoryId": fun, "accountId": ron.Id, "amountMinor": 0, "currency": "RON",
	})

	// Update re-freezes the amounts and keeps optimistic concurrency.
	var upd gen.Transaction
	put := map[string]any{
		"kind": "expense", "title": "Steam", "occurredOn": "2033-03-07", "categoryId": fun, "accountId": eur.Id,
		"amountMinor": 2000, "currency": "EUR", "rowVersion": tx.RowVersion,
	}
	e.must(http.StatusOK, http.MethodPut, "/transactions/"+tx.Id.String(), put, &upd)
	ledgerTEq(t, "updated account", upd.Account.Name, "Revolut")
	ledgerTEq(t, "updated account amount", upd.AccountAmountMinor, int64(2000))
	ledgerTEq(t, "updated home", upd.HomeAmountMinor, int64(9960))
	ledgerTEq(t, "updated rate date", upd.FxRateDate.Format(time.DateOnly), "2033-03-07")
	e.fails(http.StatusConflict, "version_conflict", http.MethodPut, "/transactions/"+tx.Id.String(), put)

	var got gen.Transaction
	e.must(http.StatusOK, http.MethodGet, "/transactions/"+tx.Id.String(), nil, &got)
	ledgerTEq(t, "get", got.HomeAmountMinor, int64(9960))
}

func TestLedgerTransactionPagination(t *testing.T) {
	e := ledgerTSetup(t)
	acc := e.account("ING", "RON", 0)
	groceries, salary := e.category("groceries"), e.category("salary")
	at := "2033-03-10T12:00:00Z"
	type spec struct {
		on string
		at any
	}
	specs := []spec{
		{"2033-03-10", at}, {"2033-03-10", at}, {"2033-03-10", at}, // equal everything but id
		{"2033-03-10", "2033-03-10T18:30:00Z"},
		{"2033-03-10", nil}, {"2033-03-10", nil}, // NULL occurred_at sorts last within the day
		{"2033-03-11", nil}, {"2033-03-09", "2033-03-09T08:00:00Z"}, {"2033-03-12", at},
	}
	var created []gen.Transaction
	for i, s := range specs {
		extra := map[string]any{"title": "Shop " + string(rune('A'+i))}
		if s.at != nil {
			extra["occurredAt"] = s.at
		}
		created = append(created, e.expense(acc.Id, groceries, s.on, int64(100*(i+1)), "RON", extra))
	}
	// Income on 10 March, and a pending one that must not count in the totals.
	e.must(http.StatusCreated, http.MethodPost, "/transactions", map[string]any{
		"kind": "income", "occurredOn": "2033-03-10", "categoryId": salary, "accountId": acc.Id, "amountMinor": 50000, "currency": "RON",
	}, nil)
	ledgerTInsertPending(t, e, acc.Id, groceries, "2033-03-10", 7777)

	want := append([]gen.Transaction(nil), created...)
	sort.SliceStable(want, func(i, j int) bool {
		a, b := want[i], want[j]
		if !a.OccurredOn.Equal(b.OccurredOn.Time) {
			return a.OccurredOn.After(b.OccurredOn.Time)
		}
		if (a.OccurredAt == nil) != (b.OccurredAt == nil) {
			return a.OccurredAt != nil
		}
		if a.OccurredAt != nil && !a.OccurredAt.Equal(*b.OccurredAt) {
			return a.OccurredAt.After(*b.OccurredAt)
		}
		return a.Id.String() > b.Id.String()
	})

	var got []gen.Transaction
	cursor := ""
	pages := 0
	for {
		path := "/transactions?kind=expense&status=posted&limit=2"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		var page gen.TransactionPage
		e.must(http.StatusOK, http.MethodGet, path, nil, &page)
		pages++
		got = append(got, page.Items...)
		// Every day in the page has a total over all matching rows of that day.
		for _, d := range page.DayTotals {
			if d.Date.Format(time.DateOnly) == "2033-03-10" {
				ledgerTEq(t, "10 Mar expenses", d.ExpenseHomeMinor, int64(100+200+300+400+500+600))
				ledgerTEq(t, "10 Mar income (kind filter)", d.IncomeHomeMinor, int64(0))
			}
		}
		if page.NextCursor == nil {
			break
		}
		cursor = *page.NextCursor
	}
	ledgerTEq(t, "pages", pages, 5)
	ledgerTEq(t, "count", len(got), len(want))
	for i := range want {
		if got[i].Id != want[i].Id {
			t.Fatalf("position %d: got %s (%s), want %s (%s)", i, got[i].Title, got[i].Id, want[i].Title, want[i].Id)
		}
	}

	// Without filters: the pending one shows with its status; income counts in day totals.
	var page gen.TransactionPage
	e.must(http.StatusOK, http.MethodGet, "/transactions?from=2033-03-10&to=2033-03-10", nil, &page)
	ledgerTEq(t, "10 Mar rows", len(page.Items), 8)
	pending := 0
	for _, tx := range page.Items {
		if tx.Status == gen.TransactionStatusPending {
			pending++
		}
	}
	ledgerTEq(t, "pending listed", pending, 1)
	ledgerTEq(t, "one day", len(page.DayTotals), 1)
	ledgerTEq(t, "expenses (posted only)", page.DayTotals[0].ExpenseHomeMinor, int64(2100))
	ledgerTEq(t, "income", page.DayTotals[0].IncomeHomeMinor, int64(50000))
	ledgerTEq(t, "home currency", page.HomeCurrency, "RON")

	// Month filter (budget period) and bad input.
	e.must(http.StatusOK, http.MethodGet, "/transactions?month=2033-02", nil, &page)
	ledgerTEq(t, "february empty", len(page.Items), 0)
	if page.Items == nil || page.DayTotals == nil {
		t.Fatal("empty page must have [] arrays")
	}
	e.must(http.StatusOK, http.MethodGet, "/transactions?month=2033-03&status=pending", nil, &page)
	ledgerTEq(t, "pending in march", len(page.Items), 1)
	ledgerTEq(t, "pending day totals are zero", page.DayTotals[0].ExpenseHomeMinor, int64(0))
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodGet, "/transactions?cursor=nonsense", nil)
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodGet, "/transactions?limit=500", nil)
}

func ledgerTInsertPending(t *testing.T, e *ledgerTEnv, account, category uuid.UUID, on string, amount int64) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := e.pool.QueryRow(context.Background(), `
		INSERT INTO transactions (household_id, kind, status, title, occurred_on, category_id, account_id, account_currency,
		                          amount_minor, currency, account_amount_minor, home_currency, home_amount_minor)
		VALUES ($1, 'expense', 'pending', 'Netflix', $2, $3, $4, 'RON', $5, 'RON', $5, 'RON', $5)
		RETURNING id`, e.f.HouseholdID, on, category, account, amount).Scan(&id)
	if err != nil {
		t.Fatalf("insert pending: %v", err)
	}
	return id
}

func TestLedgerTransactionSearch(t *testing.T) {
	e := ledgerTSetup(t)
	acc := e.account("ING", "RON", 0)
	g := e.category("groceries")
	e.expense(acc.Id, g, "2033-03-10", 100, "RON", map[string]any{"title": "Lidl"})
	e.expense(acc.Id, g, "2033-03-10", 200, "RON", map[string]any{"title": "Glovo", "note": "pizza 50% off"})
	e.expense(acc.Id, g, "2033-03-10", 300, "RON", map[string]any{"title": "Mega_Image"})
	e.expense(acc.Id, g, "2033-03-10", 400, "RON", map[string]any{"title": "Kaufland", "note": "500 off"})

	count := func(q string) int {
		var page gen.TransactionPage
		e.must(http.StatusOK, http.MethodGet, "/transactions?q="+url.QueryEscape(q), nil, &page)
		return len(page.Items)
	}
	ledgerTEq(t, "lidl", count("LIDL"), 1)
	ledgerTEq(t, "note", count("Pizza"), 1)
	ledgerTEq(t, "literal %", count("50%"), 1)
	ledgerTEq(t, "literal _", count("_"), 1)
	ledgerTEq(t, "title + note", count("glovo pizza"), 1)
	ledgerTEq(t, "blank = everything", count("  "), 4)
	ledgerTEq(t, "none", count("zzz"), 0)
}

func TestLedgerDeleteRestoreConfirmSkip(t *testing.T) {
	e := ledgerTSetup(t)
	acc := e.account("ING", "RON", 0)
	g := e.category("groceries")
	tx := e.expense(acc.Id, g, "2033-03-10", 100, "RON", nil)

	e.must(http.StatusNoContent, http.MethodDelete, "/transactions/"+tx.Id.String(), nil, nil)
	e.fails(http.StatusNotFound, "not_found", http.MethodGet, "/transactions/"+tx.Id.String(), nil)
	e.fails(http.StatusNotFound, "not_found", http.MethodDelete, "/transactions/"+tx.Id.String(), nil)
	var restored gen.Transaction
	e.must(http.StatusOK, http.MethodPost, "/transactions/"+tx.Id.String()+"/restore", nil, &restored)
	ledgerTEq(t, "restored", restored.Id, tx.Id)
	e.fails(http.StatusNotFound, "not_found", http.MethodPost, "/transactions/"+tx.Id.String()+"/restore", nil)
	e.fails(http.StatusNotFound, "not_found", http.MethodPost, "/transactions/"+uuid.Must(uuid.NewV7()).String()+"/restore", nil)

	// Confirm / skip only work on pending charges.
	e.fails(http.StatusConflict, "not_pending", http.MethodPost, "/transactions/"+tx.Id.String()+"/confirm", nil)
	e.fails(http.StatusConflict, "not_pending", http.MethodPost, "/transactions/"+tx.Id.String()+"/skip", nil)

	p1 := ledgerTInsertPending(t, e, acc.Id, g, "2033-03-11", 3999)
	var c gen.Transaction
	e.must(http.StatusOK, http.MethodPost, "/transactions/"+p1.String()+"/confirm", nil, &c)
	ledgerTEq(t, "posted", c.Status, gen.TransactionStatusPosted)
	ledgerTEq(t, "amount kept", c.HomeAmountMinor, int64(3999))

	p2 := ledgerTInsertPending(t, e, acc.Id, g, "2033-03-12", 3999)
	e.must(http.StatusOK, http.MethodPost, "/transactions/"+p2.String()+"/confirm", map[string]any{"amountMinor": 4599}, &c)
	ledgerTEq(t, "new amount", c.AmountMinor, int64(4599))
	ledgerTEq(t, "new account amount", c.AccountAmountMinor, int64(4599))
	ledgerTEq(t, "new home", c.HomeAmountMinor, int64(4599))

	p3 := ledgerTInsertPending(t, e, acc.Id, g, "2033-03-13", 3999)
	var s gen.Transaction
	e.must(http.StatusOK, http.MethodPost, "/transactions/"+p3.String()+"/skip", nil, &s)
	ledgerTEq(t, "skipped", s.Status, gen.TransactionStatusSkipped)
	e.fails(http.StatusConflict, "not_pending", http.MethodPost, "/transactions/"+p3.String()+"/confirm", nil)

	// Balance counts posted only: 100 + 3999 + 4599.
	var list gen.AccountList
	e.must(http.StatusOK, http.MethodGet, "/accounts", nil, &list)
	ledgerTEq(t, "balance", list.Items[0].BalanceMinor, int64(-(100 + 3999 + 4599)))
}

// ---------------------------------------------------------------- subscriptions

func TestLedgerRepeatCreatesSubscription(t *testing.T) {
	e := ledgerTSetup(t)
	acc := e.account("ING", "RON", 0)
	tx := e.expense(acc.Id, e.category("fun"), "2033-01-31", 3999, "RON", map[string]any{
		"title": "Netflix", "repeat": map[string]any{"frequency": "monthly"},
	})
	if tx.RecurringId == nil || tx.RecurringOccurrenceOn.Format(time.DateOnly) != "2033-01-31" {
		t.Fatalf("transaction not linked: %+v", tx)
	}
	var list gen.SubscriptionList
	e.must(http.StatusOK, http.MethodGet, "/subscriptions", nil, &list)
	all := append(append(list.NextSevenDays, list.Later...), list.Paused...)
	ledgerTEq(t, "one subscription", len(all), 1)
	sub := all[0]
	ledgerTEq(t, "linked", sub.Id, *tx.RecurringId)
	ledgerTEq(t, "title", sub.Title, "Netflix")
	ledgerTEq(t, "starts", sub.StartsOn.Format(time.DateOnly), "2033-01-31")
	ledgerTEq(t, "next = occurrence 1", sub.NextDueOn.Format(time.DateOnly), "2033-02-28")
	ledgerTEq(t, "days until due", sub.DaysUntilDue, -15)
	ledgerTEq(t, "per month", list.PerMonthMinor, int64(3999))
}

func TestLedgerSubscriptions(t *testing.T) {
	e := ledgerTSetup(t)
	ron := e.account("ING", "RON", 0)
	eur := e.account("Revolut", "EUR", 0)
	create := func(body map[string]any) gen.Subscription {
		t.Helper()
		var s gen.Subscription
		e.must(http.StatusCreated, http.MethodPost, "/subscriptions", body, &s)
		return s
	}
	netflix := create(map[string]any{"kind": "expense", "title": "Netflix", "amountMinor": 3999, "currency": "RON",
		"accountId": ron.Id, "categoryId": e.category("fun"), "frequency": "monthly", "startsOn": "2032-12-31"})
	ledgerTEq(t, "netflix next (31st clamps, then returns)", netflix.NextDueOn.Format(time.DateOnly), "2033-03-31")
	ledgerTEq(t, "days", netflix.DaysUntilDue, 16)

	duo := create(map[string]any{"kind": "expense", "title": "Duolingo", "amountMinor": 5999, "currency": "EUR",
		"accountId": eur.Id, "categoryId": e.category("education"), "frequency": "yearly", "startsOn": "2032-03-20"})
	ledgerTEq(t, "duo next", duo.NextDueOn.Format(time.DateOnly), "2033-03-20")
	ledgerTEq(t, "duo home", *duo.AmountHomeMinor, int64(29875))   // 59.99 × 4.98 = 298.7502
	ledgerTEq(t, "duo monthly", *duo.MonthlyHomeMinor, int64(2490)) // 29875.02 / 12 = 2489.585

	gym := create(map[string]any{"kind": "expense", "title": "Gym", "amountMinor": 1000, "currency": "RON",
		"accountId": ron.Id, "categoryId": e.category("fun"), "frequency": "weekly", "intervalCount": 2, "startsOn": "2033-03-15"})
	ledgerTEq(t, "gym due today", gym.DaysUntilDue, 0)
	ledgerTEq(t, "gym monthly", *gym.MonthlyHomeMinor, int64(2167)) // 1000 × 52/12 / 2 = 2166.67

	allowance := create(map[string]any{"id": uuid.Must(uuid.NewV7()), "kind": "income", "title": "Allowance", "amountMinor": 120000,
		"currency": "RON", "accountId": ron.Id, "categoryId": e.category("allowance"), "frequency": "monthly", "startsOn": "2033-01-18"})
	ledgerTEq(t, "allowance next", allowance.NextDueOn.Format(time.DateOnly), "2033-03-18")

	// Validation.
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/subscriptions", map[string]any{
		"kind": "income", "title": "X", "amountMinor": 1, "currency": "RON", "accountId": ron.Id,
		"categoryId": e.category("fun"), "frequency": "monthly", "startsOn": "2033-01-01"})
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/subscriptions", map[string]any{
		"kind": "expense", "title": "X", "amountMinor": 1, "currency": "RON", "accountId": ron.Id,
		"categoryId": e.category("fun"), "frequency": "daily", "startsOn": "2033-01-01", "intervalCount": 60})

	// A budget for this month gives shareOfBudget.
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO budgets (household_id, category_id, scope, month, amount_minor)
		VALUES ($1, $2, 'ongoing', '2033-01-01', 100000), ($1, $3, 'single_month', '2033-03-01', 50000)`,
		e.f.HouseholdID, e.category("groceries"), e.category("fun")); err != nil {
		t.Fatalf("insert budgets: %v", err)
	}
	ledgerTInsertPending(t, e, ron.Id, e.category("fun"), "2033-03-14", 3999)

	var list gen.SubscriptionList
	e.must(http.StatusOK, http.MethodGet, "/subscriptions", nil, &list)
	// 3999 + 2489.585 + 2166.67 = 8655.25 → 8655
	ledgerTEq(t, "per month", list.PerMonthMinor, int64(8655))
	ledgerTEq(t, "per year", list.PerYearMinor, int64(103863)) // 8655.2517 × 12 = 103863.02
	ledgerTEq(t, "active (expense)", list.ActiveCount, 3)
	ledgerTEq(t, "≈", list.IsApproximate, true)
	if list.ShareOfBudget == nil || *list.ShareOfBudget != 8655.0/150000.0 {
		t.Fatalf("share = %v", list.ShareOfBudget)
	}
	names := func(subs []gen.Subscription) []string {
		var n []string
		for _, s := range subs {
			n = append(n, s.Title)
		}
		return n
	}
	ledgerTEq(t, "next 7 days", len(list.NextSevenDays), 3)
	ledgerTEq(t, "soonest first", names(list.NextSevenDays)[0]+","+names(list.NextSevenDays)[1]+","+names(list.NextSevenDays)[2],
		"Gym,Allowance,Duolingo")
	ledgerTEq(t, "next 7 days total (expenses only)", list.NextSevenDaysHomeMinor, int64(1000+29875))
	ledgerTEq(t, "later", len(list.Later), 1)
	ledgerTEq(t, "pending", list.PendingCount, 1)

	// Pause: moves to paused, leaves the totals; past transactions untouched.
	put := map[string]any{"title": "Netflix", "amountMinor": 3999, "currency": "RON", "accountId": ron.Id,
		"categoryId": e.category("fun"), "frequency": "monthly", "intervalCount": 1, "startsOn": "2032-12-31",
		"isActive": false, "rowVersion": netflix.RowVersion}
	var paused gen.Subscription
	e.must(http.StatusOK, http.MethodPut, "/subscriptions/"+netflix.Id.String(), put, &paused)
	ledgerTEq(t, "paused", paused.IsActive, false)
	e.fails(http.StatusConflict, "version_conflict", http.MethodPut, "/subscriptions/"+netflix.Id.String(), put)
	e.must(http.StatusOK, http.MethodGet, "/subscriptions", nil, &list)
	ledgerTEq(t, "paused list", len(list.Paused), 1)
	ledgerTEq(t, "later now empty", len(list.Later), 0)
	ledgerTEq(t, "per month without netflix", list.PerMonthMinor, int64(4656)) // 2489.585 + 2166.67

	// Changing the schedule recomputes the next charge from today.
	put["rowVersion"], put["isActive"], put["frequency"], put["startsOn"] = paused.RowVersion, true, "weekly", "2033-03-01"
	var weekly gen.Subscription
	e.must(http.StatusOK, http.MethodPut, "/subscriptions/"+netflix.Id.String(), put, &weekly)
	ledgerTEq(t, "weekly next", weekly.NextDueOn.Format(time.DateOnly), "2033-03-15")

	// Shared loaders used by Home and Insights.
	srv := NewServer(Deps{Pool: e.pool, Clock: clock.Fixed{T: ledgerTNow}})
	h, err := srv.loadHousehold(context.Background(), srv.q, e.f.HouseholdID)
	if err != nil {
		t.Fatal(err)
	}
	active, err := srv.activeSubscriptions(context.Background(), srv.q, h)
	if err != nil {
		t.Fatal(err)
	}
	ledgerTEq(t, "active subscriptions", len(active), 4)
	ledgerTEq(t, "soonest", active[0].DaysUntilDue <= active[1].DaysUntilDue, true)
	totals, err := srv.totalsOfSubscriptions(context.Background(), srv.q, h)
	if err != nil {
		t.Fatal(err)
	}
	ledgerTEq(t, "shared active count", totals.ActiveCount, 3)
	pending, err := srv.pendingTransactions(context.Background(), srv.q, h)
	if err != nil {
		t.Fatal(err)
	}
	ledgerTEq(t, "shared pending", len(pending), 1)
	recent, err := srv.recentTransactions(context.Background(), srv.q, h, 6)
	if err != nil {
		t.Fatal(err)
	}
	ledgerTEq(t, "shared recent (posted only)", len(recent), 0)

	// Delete.
	e.must(http.StatusNoContent, http.MethodDelete, "/subscriptions/"+gym.Id.String(), nil, nil)
	e.fails(http.StatusNotFound, "not_found", http.MethodDelete, "/subscriptions/"+gym.Id.String(), nil)
	e.must(http.StatusOK, http.MethodGet, "/subscriptions", nil, &list)
	ledgerTEq(t, "after delete", len(list.NextSevenDays)+len(list.Later)+len(list.Paused), 3)
}
