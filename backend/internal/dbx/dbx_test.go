package dbx_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

// A panicking callback must not leak its connection: after more panics than the pool
// has connections, the pool still serves queries.
func TestInTxReleasesTheConnectionOnPanic(t *testing.T) {
	shared := testdb.Pool(t)
	cfg := shared.Config().Copy()
	cfg.MaxConns = 2
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	for range 4 {
		func() {
			defer func() { _ = recover() }()
			_ = dbx.InTx(context.Background(), pool, func(pgx.Tx) error { panic("boom") })
		}()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var one int
	if err := pool.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		t.Fatalf("pool exhausted after panics: %v", err)
	}
}
