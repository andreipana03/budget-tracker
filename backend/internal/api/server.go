// Package api implements the HTTP handlers defined in api/openapi.yaml.
//
// Handlers live in one file per resource (auth.go, transactions.go, …). Protected
// handlers start with `p, err := principal(ctx)` and scope every query by
// p.HouseholdID. They return *apierr.Error for anything a client can act on.
package api

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/config"
	"github.com/andreipana03/budget-tracker/backend/internal/mail"
	"github.com/andreipana03/budget-tracker/backend/internal/ratelimit"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Deps is everything the handlers need. Pool may be nil in unit tests that only
// exercise the health check. The auth fields are optional: nil values fall back to
// safe defaults (log mailer, Google disabled, limits from Config.RateLimitEnabled).
type Deps struct {
	Pool   *pgxpool.Pool
	Health HealthChecker
	Logger *slog.Logger
	Clock  clock.Clock
	Config config.Config

	// Mailer sends verification and reset emails. Nil logs them instead.
	Mailer mail.Sender
	// MailSync sends emails before the handler returns (tests). Otherwise they go
	// out in the background so a slow mail server never delays a response.
	MailSync bool
	// Google verifies Google ID tokens. Nil (or no Config.GoogleClientIDs) answers
	// 503 google_not_configured.
	Google auth.GoogleVerifier
	// Limiter rate-limits sign-in and email endpoints. Nil builds one from
	// Config.RateLimitEnabled.
	Limiter *ratelimit.Limiter
}

// Server implements the generated gen.StrictServerInterface.
type Server struct {
	pool   *pgxpool.Pool
	q      *store.Queries
	health HealthChecker
	logger *slog.Logger
	clock  clock.Clock
	cfg    config.Config

	// Auth (auth.go, me.go).
	tokens   *auth.Tokens
	mailer   mail.Sender
	mailSync bool
	google   auth.GoogleVerifier
	limiter  *ratelimit.Limiter
}

var _ gen.StrictServerInterface = (*Server)(nil)

// NewServer creates a Server.
func NewServer(d Deps) *Server {
	s := &Server{pool: d.Pool, health: d.Health, logger: d.Logger, clock: d.Clock, cfg: d.Config,
		mailer: d.Mailer, mailSync: d.MailSync, google: d.Google, limiter: d.Limiter}
	if d.Pool != nil {
		s.q = store.New(d.Pool)
		if s.health == nil {
			s.health = s.q
		}
	}
	if s.clock == nil {
		s.clock = clock.Real{}
	}
	if s.logger == nil {
		s.logger = slog.New(slog.DiscardHandler)
	}
	s.tokens = auth.NewTokens(s.cfg.JWTSecret, s.cfg.AccessTokenTTL)
	if s.mailer == nil {
		s.mailer = mail.Log{Logger: s.logger}
	}
	if s.limiter == nil {
		s.limiter = ratelimit.New(s.cfg.RateLimitEnabled).WithClock(s.clock.Now)
	}
	return s
}
