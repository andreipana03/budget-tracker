package api

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// Principal is who is calling: the signed-in user, their session (device) and the
// household every money query must be scoped to.
type Principal struct {
	UserID      uuid.UUID
	SessionID   uuid.UUID
	HouseholdID uuid.UUID
}

// Authenticator turns a request's bearer token into a Principal. It must check the
// token, that the session is live, and that the user is a member of the household.
// It returns an *apierr.Error (401) when it can't.
type Authenticator interface {
	Authenticate(ctx context.Context, r *http.Request) (Principal, error)
}

type principalKey struct{}

// WithPrincipal stores p in ctx. The auth middleware does this; tests may too.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// PrincipalFrom returns the caller, if the request was authenticated.
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}

// principal is what protected handlers call first.
func principal(ctx context.Context) (Principal, error) {
	p, ok := PrincipalFrom(ctx)
	if !ok {
		return Principal{}, apierr.Unauthorized("unauthorized", "Sign in to continue.")
	}
	return p, nil
}

type httpKey struct{}

type httpPair struct {
	w http.ResponseWriter
	r *http.Request
}

// withHTTP keeps the raw writer and request reachable from strict handlers, which
// need them for the refresh cookie, the client IP and the user agent.
func withHTTP(ctx context.Context, w http.ResponseWriter, r *http.Request) context.Context {
	return context.WithValue(ctx, httpKey{}, httpPair{w: w, r: r})
}

// httpFrom returns the raw writer and request (nil, nil outside a request).
// Headers and cookies set on the writer before the handler returns are sent with the response.
func httpFrom(ctx context.Context) (http.ResponseWriter, *http.Request) {
	p, _ := ctx.Value(httpKey{}).(httpPair)
	return p.w, p.r
}
