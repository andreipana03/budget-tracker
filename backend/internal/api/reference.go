package api

import (
	"context"
	"fmt"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// ListCurrencies returns every supported currency.
func (s *Server) ListCurrencies(ctx context.Context, request gen.ListCurrenciesRequestObject) (gen.ListCurrenciesResponseObject, error) {
	if _, err := principal(ctx); err != nil {
		return nil, err
	}
	rows, err := s.q.LedgerListCurrencies(ctx)
	if err != nil {
		return nil, fmt.Errorf("list currencies: %w", err)
	}
	out := make(gen.ListCurrencies200JSONResponse, 0, len(rows))
	for _, c := range rows {
		out = append(out, gen.Currency{Code: c.Code, Name: c.Name, MinorUnits: int(c.MinorUnits)})
	}
	return out, nil
}

// GetFxQuote returns the BNR rate between two currencies on a day (default: the
// household's today), and optionally converts an amount with it.
func (s *Server) GetFxQuote(ctx context.Context, request gen.GetFxQuoteRequestObject) (gen.GetFxQuoteResponseObject, error) {
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
	if _, err := s.ledgerCurrency(ctx, s.q, "from", params.From, &errs); err != nil {
		return nil, err
	}
	if _, err := s.ledgerCurrency(ctx, s.q, "to", params.To, &errs); err != nil {
		return nil, err
	}
	if params.AmountMinor != nil && *params.AmountMinor < 0 {
		errs = append(errs, apierr.Field("amountMinor", "invalid", "The amount can't be negative."))
	}
	if err := ledgerErrs(errs); err != nil {
		return nil, err
	}
	on := h.Today
	if params.On != nil {
		on = dayFromAPI(*params.On)
	}
	row, err := s.q.LedgerFxQuote(ctx, store.LedgerFxQuoteParams{
		AmountMinor: deref(params.AmountMinor), FromCurrency: params.From, ToCurrency: params.To, OnDate: on,
	})
	if err != nil {
		return nil, fmt.Errorf("fx quote: %w", err)
	}
	if !row.Rate.Valid {
		return nil, apierr.FxRateUnavailable(params.From, params.To)
	}
	out := gen.FxQuote{
		From:     params.From,
		To:       params.To,
		On:       apiDate(on),
		Rate:     numericString(row.Rate),
		RateDate: apiDatePtr(row.RateDate),
	}
	if params.From == params.To {
		out.Rate, out.RateDate = "1", nil
	}
	if params.AmountMinor != nil {
		out.AmountMinor = ledgerNumericInt64(row.AmountMinor)
	}
	return gen.GetFxQuote200JSONResponse(out), nil
}
