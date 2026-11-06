package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// publicOperations need no access token. Every other operation is denied unless the
// Authenticator accepts the request. Keep in sync with `security: []` in api/openapi.yaml
// (a test checks this).
var publicOperations = map[string]bool{
	"GetHealth":            true,
	"Register":             true,
	"Login":                true,
	"SignInWithGoogle":     true,
	"RefreshSession":       true,
	"SignOut":              true,
	"VerifyEmail":          true,
	"RequestPasswordReset": true,
	"ResetPassword":        true,
	"CheckUsername":        true,
}

// RouterOptions configures NewRouter.
type RouterOptions struct {
	AllowedOrigins []string
	// Authenticator checks bearer tokens. Nil rejects every protected operation.
	Authenticator Authenticator
	// Middlewares run around every request, after logging and recovery (rate limits, …).
	Middlewares []func(http.Handler) http.Handler
}

// NewRouter wires the middleware and the generated routes around a Server.
func NewRouter(server *Server, logger *slog.Logger, opts RouterOptions) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(requestLogger(logger))
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   opts.AllowedOrigins,
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Retry-After"},
		AllowCredentials: true, // the web app's refresh cookie
		MaxAge:           300,
	}))
	for _, mw := range opts.Middlewares {
		router.Use(mw)
	}

	writeErr := func(w http.ResponseWriter, r *http.Request, err error) { apierr.Write(w, r, logger, err) }
	router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, r, apierr.New(http.StatusNotFound, "not_found", "There's nothing here."))
	})
	router.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, r, apierr.New(http.StatusMethodNotAllowed, "method_not_allowed", "This method isn't allowed here."))
	})

	// Strict middlewares wrap in slice order, so the last one runs first:
	// httpContext → authenticate → handler.
	strict := gen.NewStrictHandlerWithOptions(server,
		[]gen.StrictMiddlewareFunc{authenticate(opts.Authenticator), httpContext},
		gen.StrictHTTPServerOptions{
			RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
				writeErr(w, r, apierr.BadRequest("bad_request", "The request body isn't valid JSON for this endpoint.").Wrap(err))
			},
			ResponseErrorHandlerFunc: writeErr,
		})

	return gen.HandlerWithOptions(strict, gen.ChiServerOptions{
		BaseRouter: router,
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeErr(w, r, apierr.BadRequest("invalid_parameter", err.Error()))
		},
	})
}

// httpContext makes the raw writer and request available to handlers (see httpFrom).
func httpContext(next gen.StrictHandlerFunc, _ string) gen.StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		return next(withHTTP(ctx, w, r), w, r, request)
	}
}

// authenticate denies every non-public operation that the Authenticator doesn't accept.
func authenticate(a Authenticator) gen.StrictMiddlewareFunc {
	return func(next gen.StrictHandlerFunc, operationID string) gen.StrictHandlerFunc {
		if publicOperations[operationID] {
			return next
		}
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
			if a == nil {
				return nil, apierr.Unauthorized("unauthorized", "Sign in to continue.")
			}
			p, err := a.Authenticate(ctx, r)
			if err != nil {
				return nil, err
			}
			return next(WithPrincipal(ctx, p), w, r, request)
		}
	}
}

// requestLogger logs one structured line for every completed request.
func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(wrapped, r)
			logger.InfoContext(r.Context(), "request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", wrapped.Status(),
				"duration", time.Since(start),
				"request_id", middleware.GetReqID(r.Context()),
			)
		})
	}
}
