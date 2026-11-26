package api

import (
	"net/http"
	"net/url"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

// Integration tests for transfers (DB doc § 6) and how Activity lists them. Same 2033
// calendar and BNR rates as ledger_test.go (EUR 4.9750 on 4 Mar, 4.9800 from 7 Mar).

func (e *ledgerTEnv) transfer(from, to uuid.UUID, on string, amount int64, extra map[string]any) gen.Transfer {
	e.t.Helper()
	body := map[string]any{"fromAccountId": from, "toAccountId": to, "occurredOn": on, "fromAmountMinor": amount}
	for k, v := range extra {
		body[k] = v
	}
	var tr gen.Transfer
	e.must(http.StatusCreated, http.MethodPost, "/transfers", body, &tr)
	return tr
}

func (e *ledgerTEnv) balances() map[string]int64 {
	e.t.Helper()
	var list gen.AccountList
	e.must(http.StatusOK, http.MethodGet, "/accounts?includeArchived=true", nil, &list)
	out := map[string]int64{}
	for _, a := range list.Items {
		out[a.Name] = a.BalanceMinor
	}
	return out
}

func TestLedgerTransfers(t *testing.T) {
	e := ledgerTSetup(t)
	ing := e.account("ING", "RON", 100000)
	cash := e.account("Cash", "RON", 0)
	rev := e.account("Revolut", "EUR", 0)

	// Same currency: both sides are the same amount, balances move, nothing is spending.
	atm := e.transfer(ing.Id, cash.Id, "2033-03-10", 20000, map[string]any{"note": " ATM ", "occurredAt": "2033-03-10T09:00:00Z"})
	ledgerTEq(t, "from", atm.FromAccount.Name, "ING")
	ledgerTEq(t, "to", atm.ToAccount.Name, "Cash")
	ledgerTEq(t, "to amount", atm.ToAmountMinor, int64(20000))
	ledgerTEq(t, "note trimmed", *atm.Note, "ATM")
	ledgerTEq(t, "to currency", atm.ToAccount.Currency, "RON")
	b := e.balances()
	ledgerTEq(t, "ing", b["ING"], int64(80000))
	ledgerTEq(t, "cash", b["Cash"], int64(20000))
	var budgets gen.BudgetMonth
	e.must(http.StatusOK, http.MethodGet, "/budgets?month=2033-03", nil, &budgets)
	ledgerTEq(t, "not spending", budgets.Totals.SpentMinor, int64(0))

	// Rules.
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transfers", map[string]any{
		"fromAccountId": ing.Id, "toAccountId": cash.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 100, "toAmountMinor": 99,
	})
	sameAccount := e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transfers", map[string]any{
		"fromAccountId": ing.Id, "toAccountId": ing.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 100,
	})
	ledgerTEq(t, "same account field", (*sameAccount.Fields)[0].Field, "toAccountId")
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transfers", map[string]any{
		"fromAccountId": ing.Id, "toAccountId": uuid.Must(uuid.NewV7()), "occurredOn": "2033-03-10", "fromAmountMinor": 100,
	})

	// Exchange: what arrived is stored as sent; left out, it's converted at that day's BNR rate.
	exchange := e.transfer(ing.Id, rev.Id, "2033-03-10", 10000, map[string]any{"toAmountMinor": 1990})
	ledgerTEq(t, "arrived as sent", exchange.ToAmountMinor, int64(1990))
	converted := e.transfer(ing.Id, rev.Id, "2033-03-07", 9960, nil)
	ledgerTEq(t, "converted at 4.98", converted.ToAmountMinor, int64(2000))
	b = e.balances()
	ledgerTEq(t, "ing after exchanges", b["ING"], int64(80000-10000-9960))
	ledgerTEq(t, "revolut", b["Revolut"], int64(1990+2000))

	sek := e.account("SEK Card", "SEK", 0)
	e.fails(http.StatusUnprocessableEntity, "fx_rate_unavailable", http.MethodPost, "/transfers", map[string]any{
		"fromAccountId": ing.Id, "toAccountId": sek.Id, "occurredOn": "1990-01-02", "fromAmountMinor": 100,
	})

	// Edit: a note change keeps what arrived; a new amount converts again; stale versions fail.
	var edited gen.Transfer
	put := map[string]any{
		"fromAccountId": ing.Id, "toAccountId": rev.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 10000,
		"note": "Holiday", "rowVersion": exchange.RowVersion,
	}
	e.must(http.StatusOK, http.MethodPut, "/transfers/"+exchange.Id.String(), put, &edited)
	ledgerTEq(t, "kept arrival", edited.ToAmountMinor, int64(1990))
	ledgerTEq(t, "note", *edited.Note, "Holiday")
	ledgerTEq(t, "version moved", edited.RowVersion > exchange.RowVersion, true)
	e.fails(http.StatusConflict, "version_conflict", http.MethodPut, "/transfers/"+exchange.Id.String(), put)
	put["fromAmountMinor"], put["rowVersion"] = 4980, edited.RowVersion
	e.must(http.StatusOK, http.MethodPut, "/transfers/"+exchange.Id.String(), put, &edited)
	ledgerTEq(t, "reconverted", edited.ToAmountMinor, int64(1000))

	// Swap the direction of the ATM withdrawal.
	var swapped gen.Transfer
	e.must(http.StatusOK, http.MethodPut, "/transfers/"+atm.Id.String(), map[string]any{
		"fromAccountId": cash.Id, "toAccountId": ing.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 5000,
		"rowVersion": atm.RowVersion,
	}, &swapped)
	ledgerTEq(t, "swapped from", swapped.FromAccount.Name, "Cash")
	ledgerTEq(t, "note cleared", swapped.Note == nil, true)
	ledgerTEq(t, "occurredAt cleared", swapped.OccurredAt == nil, true)

	// Archived accounts: not offered for new transfers, kept on the ones that use them.
	var archived gen.Account
	e.must(http.StatusOK, http.MethodPut, "/accounts/"+cash.Id.String(), map[string]any{
		"name": "Cash", "type": "cash", "currency": "RON", "openingBalanceMinor": 0, "openingBalanceOn": "2033-03-01",
		"includeInTotal": true, "sortOrder": 1, "archived": true, "rowVersion": cash.RowVersion,
	}, &archived)
	e.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transfers", map[string]any{
		"fromAccountId": ing.Id, "toAccountId": cash.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 100,
	})
	e.must(http.StatusOK, http.MethodPut, "/transfers/"+atm.Id.String(), map[string]any{
		"fromAccountId": cash.Id, "toAccountId": ing.Id, "occurredOn": "2033-03-11", "fromAmountMinor": 5000,
		"rowVersion": swapped.RowVersion,
	}, nil)

	// Delete with Undo.
	before := e.balances()
	e.must(http.StatusNoContent, http.MethodDelete, "/transfers/"+converted.Id.String(), nil, nil)
	ledgerTEq(t, "ing back", e.balances()["ING"], before["ING"]+9960)
	e.fails(http.StatusNotFound, "not_found", http.MethodGet, "/transfers/"+converted.Id.String(), nil)
	e.fails(http.StatusNotFound, "not_found", http.MethodDelete, "/transfers/"+converted.Id.String(), nil)
	var restored gen.Transfer
	e.must(http.StatusOK, http.MethodPost, "/transfers/"+converted.Id.String()+"/restore", nil, &restored)
	ledgerTEq(t, "restored", restored.ToAmountMinor, int64(2000))
	ledgerTEq(t, "ing restored", e.balances()["ING"], before["ING"])
	e.fails(http.StatusNotFound, "not_found", http.MethodPost, "/transfers/"+converted.Id.String()+"/restore", nil)

	// An account with transfers is archived, not deleted.
	var res gen.DeleteResult
	e.must(http.StatusOK, http.MethodDelete, "/accounts/"+rev.Id.String(), nil, &res)
	ledgerTEq(t, "revolut archived", res.Outcome, gen.DeleteResultOutcomeArchived)
}

func TestLedgerTransferIdempotentAndIsolated(t *testing.T) {
	e := ledgerTSetup(t)
	other := ledgerTEnvFor(t, e.pool, testdb.NewHousehold(t, e.pool))
	ing := e.account("ING", "RON", 0)
	cash := e.account("Cash", "RON", 0)

	id := uuid.Must(uuid.NewV7())
	first := e.transfer(ing.Id, cash.Id, "2033-03-10", 500, map[string]any{"id": id})
	second := e.transfer(ing.Id, cash.Id, "2033-03-10", 500, map[string]any{"id": id})
	ledgerTEq(t, "same id", second.Id, first.Id)
	ledgerTEq(t, "one transfer", e.balances()["Cash"], int64(500))

	// Another household can't see, change, delete or reuse it, nor use these accounts.
	other.fails(http.StatusNotFound, "not_found", http.MethodGet, "/transfers/"+id.String(), nil)
	other.fails(http.StatusNotFound, "not_found", http.MethodDelete, "/transfers/"+id.String(), nil)
	other.fails(http.StatusNotFound, "not_found", http.MethodPut, "/transfers/"+id.String(), map[string]any{
		"fromAccountId": ing.Id, "toAccountId": cash.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 1, "rowVersion": first.RowVersion,
	})
	otherA, otherB := other.account("A", "RON", 0), other.account("B", "RON", 0)
	other.fails(http.StatusConflict, "id_taken", http.MethodPost, "/transfers", map[string]any{
		"id": id, "fromAccountId": otherA.Id, "toAccountId": otherB.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 1,
	})
	other.fails(http.StatusUnprocessableEntity, "validation_failed", http.MethodPost, "/transfers", map[string]any{
		"fromAccountId": ing.Id, "toAccountId": otherB.Id, "occurredOn": "2033-03-10", "fromAmountMinor": 1,
	})
}

// Activity with includeTransfers: one order across transactions and transfers, paged by
// the same cursor, filtered the same way, and never part of the day totals.
func TestLedgerTransfersInActivity(t *testing.T) {
	e := ledgerTSetup(t)
	ing := e.account("ING", "RON", 0)
	cash := e.account("Cash", "RON", 0)
	groceries := e.category("groceries")

	type entry struct {
		id uuid.UUID
		on string
		at *time.Time
	}
	parse := func(s string) *time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return &v
	}
	var all []entry
	at := "2033-03-10T12:00:00Z"
	for i, s := range []struct {
		on, at   string
		transfer bool
	}{
		{"2033-03-10", at, false}, {"2033-03-10", at, true}, {"2033-03-10", at, false}, // equal but for the id
		{"2033-03-10", "2033-03-10T18:30:00Z", true},
		{"2033-03-10", "", false}, {"2033-03-10", "", true}, // no time: last in the day
		{"2033-03-11", "", true}, {"2033-03-09", "2033-03-09T08:00:00Z", false}, {"2033-03-12", at, true},
	} {
		extra := map[string]any{}
		var atPtr *time.Time
		if s.at != "" {
			extra["occurredAt"] = s.at
			atPtr = parse(s.at)
		}
		amount := int64(100 * (i + 1))
		if s.transfer {
			extra["note"] = "ATM"
			tr := e.transfer(ing.Id, cash.Id, s.on, amount, extra)
			all = append(all, entry{tr.Id, s.on, atPtr})
		} else {
			extra["title"] = "Lidl"
			tx := e.expense(ing.Id, groceries, s.on, amount, "RON", extra)
			all = append(all, entry{tx.Id, s.on, atPtr})
		}
	}
	sort.SliceStable(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if a.on != b.on {
			return a.on > b.on
		}
		if (a.at == nil) != (b.at == nil) {
			return a.at != nil
		}
		if a.at != nil && !a.at.Equal(*b.at) {
			return a.at.After(*b.at)
		}
		return a.id.String() > b.id.String()
	})

	// Pages of 2 hold 2 entries of either kind, in one order, with nothing lost or repeated.
	var got []uuid.UUID
	cursor := ""
	pages := 0
	for {
		path := "/transactions?includeTransfers=true&limit=2"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		var page gen.TransactionPage
		e.must(http.StatusOK, http.MethodGet, path, nil, &page)
		pages++
		if page.Transfers == nil {
			t.Fatal("transfers missing with includeTransfers")
		}
		ledgerTEq(t, "page size", len(page.Items)+len(*page.Transfers) <= 2, true)
		var merged []entry
		for _, tx := range page.Items {
			merged = append(merged, entry{id: tx.Id, on: tx.OccurredOn.Format(time.DateOnly), at: tx.OccurredAt})
		}
		for _, tr := range *page.Transfers {
			merged = append(merged, entry{id: tr.Id, on: tr.OccurredOn.Format(time.DateOnly), at: tr.OccurredAt})
		}
		sort.SliceStable(merged, func(i, j int) bool {
			return ledgerBefore(ledgerKey{On: dayOf(t, merged[i].on), At: merged[i].at, ID: merged[i].id},
				ledgerKey{On: dayOf(t, merged[j].on), At: merged[j].at, ID: merged[j].id})
		})
		for _, m := range merged {
			got = append(got, m.id)
		}
		for _, d := range page.DayTotals {
			if d.Date.Format(time.DateOnly) == "2033-03-10" {
				ledgerTEq(t, "10 Mar spent (no transfers)", d.ExpenseHomeMinor, int64(100+300+500))
			}
		}
		if page.NextCursor == nil {
			break
		}
		cursor = *page.NextCursor
	}
	ledgerTEq(t, "pages", pages, 5)
	ledgerTEq(t, "count", len(got), len(all))
	for i := range all {
		if got[i] != all[i].id {
			t.Fatalf("position %d: got %s, want %s", i, got[i], all[i].id)
		}
	}

	count := func(query string) (transactions, transfers int) {
		var page gen.TransactionPage
		e.must(http.StatusOK, http.MethodGet, "/transactions?includeTransfers=true&"+query, nil, &page)
		return len(page.Items), len(*page.Transfers)
	}
	var plain gen.TransactionPage
	e.must(http.StatusOK, http.MethodGet, "/transactions", nil, &plain)
	ledgerTEq(t, "not asked for", plain.Transfers == nil, true)
	_, n := count("kind=expense")
	ledgerTEq(t, "kind filter leaves transfers out", n, 0)
	_, n = count("status=posted")
	ledgerTEq(t, "status filter leaves transfers out", n, 0)
	_, n = count("categoryId=" + groceries.String())
	ledgerTEq(t, "category filter leaves transfers out", n, 0)
	txs, n := count("accountId=" + cash.Id.String())
	ledgerTEq(t, "cash: no expenses", txs, 0)
	ledgerTEq(t, "cash: transfers in", n, 5)
	_, n = count("q=atm")
	ledgerTEq(t, "search by note", n, 5)
	txs, n = count("q=" + url.QueryEscape("cash"))
	ledgerTEq(t, "search by account name", n, 5)
	ledgerTEq(t, "…not the expenses", txs, 0)
	txs, n = count("from=2033-03-11&to=2033-03-12")
	ledgerTEq(t, "range: transactions", txs, 0)
	ledgerTEq(t, "range: transfers", n, 2)
}

func dayOf(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}
