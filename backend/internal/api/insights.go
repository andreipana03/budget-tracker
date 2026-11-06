package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// GetInsights is not implemented yet.
func (s *Server) GetInsights(ctx context.Context, request gen.GetInsightsRequestObject) (gen.GetInsightsResponseObject, error) {
	return nil, apierr.NotImplemented()
}
