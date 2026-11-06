package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// ListAccounts is not implemented yet.
func (s *Server) ListAccounts(ctx context.Context, request gen.ListAccountsRequestObject) (gen.ListAccountsResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// CreateAccount is not implemented yet.
func (s *Server) CreateAccount(ctx context.Context, request gen.CreateAccountRequestObject) (gen.CreateAccountResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// UpdateAccount is not implemented yet.
func (s *Server) UpdateAccount(ctx context.Context, request gen.UpdateAccountRequestObject) (gen.UpdateAccountResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// DeleteAccount is not implemented yet.
func (s *Server) DeleteAccount(ctx context.Context, request gen.DeleteAccountRequestObject) (gen.DeleteAccountResponseObject, error) {
	return nil, apierr.NotImplemented()
}
