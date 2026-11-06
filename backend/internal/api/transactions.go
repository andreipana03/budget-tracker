package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// ListTransactions is not implemented yet.
func (s *Server) ListTransactions(ctx context.Context, request gen.ListTransactionsRequestObject) (gen.ListTransactionsResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// CreateTransaction is not implemented yet.
func (s *Server) CreateTransaction(ctx context.Context, request gen.CreateTransactionRequestObject) (gen.CreateTransactionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// GetTransaction is not implemented yet.
func (s *Server) GetTransaction(ctx context.Context, request gen.GetTransactionRequestObject) (gen.GetTransactionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// UpdateTransaction is not implemented yet.
func (s *Server) UpdateTransaction(ctx context.Context, request gen.UpdateTransactionRequestObject) (gen.UpdateTransactionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// DeleteTransaction is not implemented yet.
func (s *Server) DeleteTransaction(ctx context.Context, request gen.DeleteTransactionRequestObject) (gen.DeleteTransactionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// RestoreTransaction is not implemented yet.
func (s *Server) RestoreTransaction(ctx context.Context, request gen.RestoreTransactionRequestObject) (gen.RestoreTransactionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// ConfirmTransaction is not implemented yet.
func (s *Server) ConfirmTransaction(ctx context.Context, request gen.ConfirmTransactionRequestObject) (gen.ConfirmTransactionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// SkipTransaction is not implemented yet.
func (s *Server) SkipTransaction(ctx context.Context, request gen.SkipTransactionRequestObject) (gen.SkipTransactionResponseObject, error) {
	return nil, apierr.NotImplemented()
}
