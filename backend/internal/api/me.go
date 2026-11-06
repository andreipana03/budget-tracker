package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// GetMe is not implemented yet.
func (s *Server) GetMe(ctx context.Context, request gen.GetMeRequestObject) (gen.GetMeResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// UpdateMe is not implemented yet.
func (s *Server) UpdateMe(ctx context.Context, request gen.UpdateMeRequestObject) (gen.UpdateMeResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// DeleteMe is not implemented yet.
func (s *Server) DeleteMe(ctx context.Context, request gen.DeleteMeRequestObject) (gen.DeleteMeResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// ChangePassword is not implemented yet.
func (s *Server) ChangePassword(ctx context.Context, request gen.ChangePasswordRequestObject) (gen.ChangePasswordResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// ResendVerification is not implemented yet.
func (s *Server) ResendVerification(ctx context.Context, request gen.ResendVerificationRequestObject) (gen.ResendVerificationResponseObject, error) {
	return nil, apierr.NotImplemented()
}
