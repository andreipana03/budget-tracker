package jobs

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// How long finished rows are kept before cleanup deletes them.
const (
	tokenRetention   = 7 * 24 * time.Hour
	sessionRetention = 30 * 24 * time.Hour
)

// cleanup deletes expired passkey challenges, email tokens consumed or expired more
// than 7 days ago, and sessions expired or revoked more than 30 days ago.
func (r *Runner) cleanup(ctx context.Context, tx pgx.Tx, now time.Time) error {
	q := store.New(tx)
	challenges, err := q.JobsDeleteExpiredChallenges(ctx, store.JobsDeleteExpiredChallengesParams{Now: now, UserID: r.userScope})
	if err != nil {
		return fmt.Errorf("delete challenges: %w", err)
	}
	tokens, err := q.JobsDeleteOldVerificationTokens(ctx, store.JobsDeleteOldVerificationTokensParams{
		Cutoff: now.Add(-tokenRetention), UserID: r.userScope,
	})
	if err != nil {
		return fmt.Errorf("delete verification tokens: %w", err)
	}
	sessions, err := q.JobsDeleteOldSessions(ctx, store.JobsDeleteOldSessionsParams{
		Cutoff: now.Add(-sessionRetention), UserID: r.userScope,
	})
	if err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	r.logger.Info("cleanup done", "challenges", challenges, "verification_tokens", tokens, "sessions", sessions)
	return nil
}
