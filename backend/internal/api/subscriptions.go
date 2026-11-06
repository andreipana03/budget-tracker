package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// ListSubscriptions is not implemented yet.
func (s *Server) ListSubscriptions(ctx context.Context, request gen.ListSubscriptionsRequestObject) (gen.ListSubscriptionsResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// CreateSubscription is not implemented yet.
func (s *Server) CreateSubscription(ctx context.Context, request gen.CreateSubscriptionRequestObject) (gen.CreateSubscriptionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// UpdateSubscription is not implemented yet.
func (s *Server) UpdateSubscription(ctx context.Context, request gen.UpdateSubscriptionRequestObject) (gen.UpdateSubscriptionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// DeleteSubscription is not implemented yet.
func (s *Server) DeleteSubscription(ctx context.Context, request gen.DeleteSubscriptionRequestObject) (gen.DeleteSubscriptionResponseObject, error) {
	return nil, apierr.NotImplemented()
}
