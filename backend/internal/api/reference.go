package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// ListCurrencies is not implemented yet.
func (s *Server) ListCurrencies(ctx context.Context, request gen.ListCurrenciesRequestObject) (gen.ListCurrenciesResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// GetFxQuote is not implemented yet.
func (s *Server) GetFxQuote(ctx context.Context, request gen.GetFxQuoteRequestObject) (gen.GetFxQuoteResponseObject, error) {
	return nil, apierr.NotImplemented()
}
