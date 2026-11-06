// Package testdb gives integration tests a real PostgreSQL database.
//
// Tests that call Pool are skipped unless TEST_DATABASE_URL is set (`make test` sets it
// and migrates the database with `make test-db`). Tests never roll back: each one
// creates its own user and household with random names, so tests and packages can run
// in parallel against the same database.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	once    sync.Once
	pool    *pgxpool.Pool
	poolErr error
)

// Pool returns a pool shared by the whole test binary, or skips the test.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set; run `make test-db` and `make test`")
	}
	once.Do(func() {
		pool, poolErr = pgxpool.New(context.Background(), url)
		if poolErr == nil {
			poolErr = pool.Ping(context.Background())
		}
	})
	if poolErr != nil {
		t.Fatalf("connect to the test database: %v", poolErr)
	}
	return pool
}

// Fixture is a user who owns a household, created directly in SQL (no signup logic).
type Fixture struct {
	UserID      uuid.UUID
	HouseholdID uuid.UUID
	Email       string
	Username    string
}

// RandomSuffix returns 10 random lowercase hex characters, for unique names.
func RandomSuffix() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// NewHousehold creates a user, a household (RON, Europe/Bucharest, month start day 1,
// the 13 default categories) and the owner membership. The user (and so the household
// and all its data) is deleted when the test ends.
func NewHousehold(t testing.TB, p *pgxpool.Pool) Fixture {
	t.Helper()
	ctx := context.Background()
	suffix := RandomSuffix()
	f := Fixture{
		UserID:      uuid.Must(uuid.NewV7()),
		HouseholdID: uuid.Must(uuid.NewV7()),
		Email:       "test-" + suffix + "@example.test",
		Username:    "test-" + suffix,
	}
	if _, err := p.Exec(ctx, `INSERT INTO users (id, email, username, email_verified_at) VALUES ($1, $2, $3, now())`,
		f.UserID, f.Email, f.Username); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := p.Exec(ctx, `INSERT INTO households (id) VALUES ($1)`, f.HouseholdID); err != nil {
		t.Fatalf("insert household: %v", err)
	}
	if _, err := p.Exec(ctx, `INSERT INTO household_members (household_id, user_id) VALUES ($1, $2)`,
		f.HouseholdID, f.UserID); err != nil {
		t.Fatalf("insert membership: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, f.UserID)
	})
	return f
}
