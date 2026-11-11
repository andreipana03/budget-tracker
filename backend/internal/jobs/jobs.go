// Package jobs runs the background work the API needs, in-process
// (docs/database/postgres-schema-and-business-rules.md § 6, § 8, § 10):
//
//   - BNR exchange rates: a backfill from the yearly files on startup when recent
//     banking days are missing, then the daily file on weekdays after 13:30 Bucharest time.
//   - Subscriptions coming due: pending transactions, every 15 minutes.
//   - Cleanup of expired passkey challenges, email tokens and sessions, every 6 hours.
//
// Each run is one database transaction guarded by pg_try_advisory_xact_lock, so when
// several API instances run, only one does a given job at a time; the others skip it.
// Session-level advisory locks are never used: pooled connections are shared.
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Advisory lock keys, one per job ("BT" + number).
const (
	lockBNR           int64 = 0x4254_0001
	lockSubscriptions int64 = 0x4254_0002
	lockCleanup       int64 = 0x4254_0003
)

// How often each job runs. Every job also runs once at startup.
const (
	bnrEvery           = 30 * time.Minute
	subscriptionsEvery = 15 * time.Minute
	cleanupEvery       = 6 * time.Hour
	// A run that started before shutdown may finish, but never takes longer than this.
	jobTimeout = 2 * time.Minute
)

// Options configures a Runner.
type Options struct {
	Pool   *pgxpool.Pool
	Logger *slog.Logger
	// Clock defaults to the system clock.
	Clock clock.Clock
	// HTTPClient fetches BNR's files; defaults to a client with a 30 s timeout.
	HTTPClient *http.Client
	// BNRBaseURL is config.BNRBaseURL (https://curs.bnr.ro, or a test server).
	BNRBaseURL string
}

// Runner schedules the jobs. Create it with New, call Start, and Wait after the
// context passed to Start is done.
type Runner struct {
	pool    *pgxpool.Pool
	logger  *slog.Logger
	clock   clock.Clock
	http    *http.Client
	bnrBase string
	wg      sync.WaitGroup

	// Test-only: limit the subscription and cleanup jobs to one household / user so
	// tests sharing a database never touch each other's rows. nil in production.
	householdScope *uuid.UUID
	userScope      *uuid.UUID
}

// New builds a Runner.
func New(o Options) *Runner {
	r := &Runner{pool: o.Pool, logger: o.Logger, clock: o.Clock, http: o.HTTPClient, bnrBase: BNRBaseURL(o.BNRBaseURL)}
	if r.logger == nil {
		r.logger = slog.Default()
	}
	if r.clock == nil {
		r.clock = clock.Real{}
	}
	if r.http == nil {
		r.http = DefaultHTTPClient()
	}
	return r
}

// DefaultHTTPClient is the client used for BNR when none is given.
func DefaultHTTPClient() *http.Client { return &http.Client{Timeout: 30 * time.Second} }

// Start runs every job once now and then on its schedule, until ctx is done.
// It returns immediately.
func (r *Runner) Start(ctx context.Context) {
	r.logger.Info("jobs started", "bnr_base_url", r.bnrBase)
	r.loop(ctx, bnrEvery, r.RunBNR)
	r.loop(ctx, subscriptionsEvery, r.RunSubscriptions)
	r.loop(ctx, cleanupEvery, r.RunCleanup)
}

// Wait blocks until every loop has stopped and every running job has finished.
func (r *Runner) Wait() { r.wg.Wait() }

func (r *Runner) loop(ctx context.Context, every time.Duration, run func(context.Context) error) {
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			// A run in progress finishes even when shutdown starts (bounded by jobTimeout);
			// no new run starts afterwards. Errors are logged by run and retried next tick.
			jobCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), jobTimeout)
			_ = run(jobCtx)
			cancel()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// RunBNR runs the exchange-rate job once.
func (r *Runner) RunBNR(ctx context.Context) error { return r.run(ctx, "bnr_rates", lockBNR, r.bnr) }

// RunSubscriptions runs the subscriptions job once.
func (r *Runner) RunSubscriptions(ctx context.Context) error {
	return r.run(ctx, "subscriptions", lockSubscriptions, r.subscriptions)
}

// RunCleanup runs the cleanup job once.
func (r *Runner) RunCleanup(ctx context.Context) error {
	return r.run(ctx, "cleanup", lockCleanup, r.cleanup)
}

type jobFunc func(ctx context.Context, tx pgx.Tx, now time.Time) error

// run executes fn in one transaction holding the job's advisory lock. It recovers
// panics and logs start, finish and errors. When another instance holds the lock the
// run is skipped. The error is returned for tests; the scheduler only logs it.
func (r *Runner) run(ctx context.Context, name string, lockKey int64, fn jobFunc) (err error) {
	start := time.Now()
	log := r.logger.With("job", name)
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v", p)
			log.Error("job panicked", "error", err, "stack", string(debug.Stack()))
			return
		}
		if err != nil {
			log.Error("job failed", "error", err, "duration", time.Since(start))
		}
	}()

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	// After a commit this is a no-op; after an error or a panic it releases the lock.
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	locked, err := store.New(tx).JobsTryLock(ctx, lockKey)
	if err != nil {
		return fmt.Errorf("lock: %w", err)
	}
	if !locked {
		log.Info("job skipped: another instance is running it")
		return nil
	}
	log.Info("job started")
	if err := fn(ctx, tx, r.clock.Now()); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	log.Info("job finished", "duration", time.Since(start))
	return nil
}
