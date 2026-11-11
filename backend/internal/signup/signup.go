// Package signup creates a new user with everything they need to start: a household
// (RON, Europe/Bucharest, month start day 1; the database adds the default categories),
// the owner membership and a "Cash" account. Used by password sign-up, Google
// sign-up and the admin-test seed.
package signup

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Params describes the new user. Email (and Username, when given) must already be
// normalized and validated by the caller.
type Params struct {
	Email string
	// Username nil lets the database derive one from the email (users_fill_username).
	Username *string
	// PasswordHash is an argon2id PHC string, or nil for Google-only accounts.
	PasswordHash  *string
	DisplayName   *string
	EmailVerified bool
	// Now is "now" for timestamps and the Cash account's opening day. Zero means time.Now().
	Now time.Time
}

// Result says what was created.
type Result struct {
	UserID      uuid.UUID
	HouseholdID uuid.UUID
	AccountID   uuid.UUID
	User        store.User
}

// Create inserts the user, household, owner membership and Cash account. Run it inside
// the caller's transaction (pass the pgx.Tx) so a failure leaves nothing behind.
// Unique violations (users_email_key, users_username_key) are returned unchanged for
// apierr.FromDB to map.
func Create(ctx context.Context, db store.DBTX, p Params) (Result, error) {
	now := p.Now
	if now.IsZero() {
		now = time.Now()
	}
	q := store.New(db)

	in := store.SignupInsertUserParams{
		Email:        p.Email,
		Username:     p.Username,
		PasswordHash: p.PasswordHash,
		DisplayName:  p.DisplayName,
	}
	if p.PasswordHash != nil {
		in.PasswordChangedAt = &now
	}
	if p.EmailVerified {
		in.EmailVerifiedAt = &now
	}
	user, err := q.SignupInsertUser(ctx, in)
	if err != nil {
		return Result{}, fmt.Errorf("signup: insert user: %w", err)
	}

	hh, err := q.SignupInsertHousehold(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("signup: insert household: %w", err)
	}
	if err := q.SignupInsertOwner(ctx, store.SignupInsertOwnerParams{HouseholdID: hh.ID, UserID: user.ID}); err != nil {
		return Result{}, fmt.Errorf("signup: insert membership: %w", err)
	}

	loc, err := time.LoadLocation(hh.Timezone)
	if err != nil {
		loc = time.UTC
	}
	accountID, err := q.SignupInsertCashAccount(ctx, store.SignupInsertCashAccountParams{
		HouseholdID:      hh.ID,
		Currency:         hh.HomeCurrency,
		OpeningBalanceOn: budget.Today(now, loc),
		CreatedBy:        &user.ID,
	})
	if err != nil {
		return Result{}, fmt.Errorf("signup: insert cash account: %w", err)
	}
	return Result{UserID: user.ID, HouseholdID: hh.ID, AccountID: accountID, User: user}, nil
}
