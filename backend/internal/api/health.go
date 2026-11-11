package api

import (
	"context"
	"time"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
)

const databaseCheckTimeout = 2 * time.Second

// HealthChecker proves the database is reachable and migrated.
type HealthChecker interface {
	CountAppMetadata(ctx context.Context) (int64, error)
}

// GetHealth reports whether the API can reach its migrated database.
func (s *Server) GetHealth(ctx context.Context, _ gen.GetHealthRequestObject) (gen.GetHealthResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, databaseCheckTimeout)
	defer cancel()

	if _, err := s.health.CountAppMetadata(ctx); err != nil {
		s.logger.WarnContext(ctx, "database health check failed", "error", err)
		return gen.GetHealth503JSONResponse{Status: gen.HealthResponseStatusDegraded, Database: gen.HealthResponseDatabaseDown}, nil
	}
	return gen.GetHealth200JSONResponse{Status: gen.HealthResponseStatusOk, Database: gen.HealthResponseDatabaseUp}, nil
}
