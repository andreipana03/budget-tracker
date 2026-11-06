package api

import (
	"context"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// Register is not implemented yet.
func (s *Server) Register(ctx context.Context, request gen.RegisterRequestObject) (gen.RegisterResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// Login is not implemented yet.
func (s *Server) Login(ctx context.Context, request gen.LoginRequestObject) (gen.LoginResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// SignInWithGoogle is not implemented yet.
func (s *Server) SignInWithGoogle(ctx context.Context, request gen.SignInWithGoogleRequestObject) (gen.SignInWithGoogleResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// RefreshSession is not implemented yet.
func (s *Server) RefreshSession(ctx context.Context, request gen.RefreshSessionRequestObject) (gen.RefreshSessionResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// SignOut is not implemented yet.
func (s *Server) SignOut(ctx context.Context, request gen.SignOutRequestObject) (gen.SignOutResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// VerifyEmail is not implemented yet.
func (s *Server) VerifyEmail(ctx context.Context, request gen.VerifyEmailRequestObject) (gen.VerifyEmailResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// RequestPasswordReset is not implemented yet.
func (s *Server) RequestPasswordReset(ctx context.Context, request gen.RequestPasswordResetRequestObject) (gen.RequestPasswordResetResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// ResetPassword is not implemented yet.
func (s *Server) ResetPassword(ctx context.Context, request gen.ResetPasswordRequestObject) (gen.ResetPasswordResponseObject, error) {
	return nil, apierr.NotImplemented()
}

// CheckUsername is not implemented yet.
func (s *Server) CheckUsername(ctx context.Context, request gen.CheckUsernameRequestObject) (gen.CheckUsernameResponseObject, error) {
	return nil, apierr.NotImplemented()
}
