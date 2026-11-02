// Package api implements the HTTP handlers defined in api/openapi.yaml.
package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
)

const databaseCheckTimeout = 2 * time.Second

// Queries is the subset of the generated store the handlers depend on.
type Queries interface {
	CountAppMetadata(ctx context.Context) (int64, error)
}

// Server implements the generated gen.StrictServerInterface.
type Server struct {
	queries Queries
	logger  *slog.Logger
}

var _ gen.StrictServerInterface = (*Server)(nil)

// NewServer creates a Server.
func NewServer(queries Queries, logger *slog.Logger) *Server {
	return &Server{queries: queries, logger: logger}
}

// GetHealth reports whether the API can reach its migrated database.
func (s *Server) GetHealth(ctx context.Context, _ gen.GetHealthRequestObject) (gen.GetHealthResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, databaseCheckTimeout)
	defer cancel()

	if _, err := s.queries.CountAppMetadata(ctx); err != nil {
		s.logger.WarnContext(ctx, "database health check failed", "error", err)
		return gen.GetHealth503JSONResponse{Status: gen.Degraded, Database: gen.Down}, nil
	}
	return gen.GetHealth200JSONResponse{Status: gen.Ok, Database: gen.Up}, nil
}
