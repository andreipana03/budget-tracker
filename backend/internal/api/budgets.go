package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// GetBudgets is not implemented yet.
func (s *Server) GetBudgets(ctx context.Context, request gen.GetBudgetsRequestObject) (gen.GetBudgetsResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// SetBudgets is not implemented yet.
func (s *Server) SetBudgets(ctx context.Context, request gen.SetBudgetsRequestObject) (gen.SetBudgetsResponseObject, error) {
	return nil, apierr.NotImplemented()
}
