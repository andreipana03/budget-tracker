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
	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/config"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Deps is everything the handlers need. Pool may be nil in unit tests that only
// exercise the health check.
type Deps struct {
	Pool   *pgxpool.Pool
	Health HealthChecker
	Logger *slog.Logger
	Clock  clock.Clock
	Config config.Config
}

// Server implements the generated gen.StrictServerInterface.
type Server struct {
	pool   *pgxpool.Pool
	q      *store.Queries
	health HealthChecker
	logger *slog.Logger
	clock  clock.Clock
	cfg    config.Config
}

var _ gen.StrictServerInterface = (*Server)(nil)

// NewServer creates a Server.
func NewServer(d Deps) *Server {
	s := &Server{pool: d.Pool, health: d.Health, logger: d.Logger, clock: d.Clock, cfg: d.Config}
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
	return s
}
