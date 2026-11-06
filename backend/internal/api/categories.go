package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// ListCategories is not implemented yet.
func (s *Server) ListCategories(ctx context.Context, request gen.ListCategoriesRequestObject) (gen.ListCategoriesResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// CreateCategory is not implemented yet.
func (s *Server) CreateCategory(ctx context.Context, request gen.CreateCategoryRequestObject) (gen.CreateCategoryResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// UpdateCategory is not implemented yet.
func (s *Server) UpdateCategory(ctx context.Context, request gen.UpdateCategoryRequestObject) (gen.UpdateCategoryResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// DeleteCategory is not implemented yet.
func (s *Server) DeleteCategory(ctx context.Context, request gen.DeleteCategoryRequestObject) (gen.DeleteCategoryResponseObject, error) {
	return nil, apierr.NotImplemented()
}
