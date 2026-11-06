package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// GetHome is not implemented yet.
func (s *Server) GetHome(ctx context.Context, request gen.GetHomeRequestObject) (gen.GetHomeResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// ListMonths is not implemented yet.
func (s *Server) ListMonths(ctx context.Context, request gen.ListMonthsRequestObject) (gen.ListMonthsResponseObject, error) {
	return nil, apierr.NotImplemented()
}
