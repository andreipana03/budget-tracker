package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// GetHousehold is not implemented yet.
func (s *Server) GetHousehold(ctx context.Context, request gen.GetHouseholdRequestObject) (gen.GetHouseholdResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// UpdateHousehold is not implemented yet.
func (s *Server) UpdateHousehold(ctx context.Context, request gen.UpdateHouseholdRequestObject) (gen.UpdateHouseholdResponseObject, error) {
	return nil, apierr.NotImplemented()
}
