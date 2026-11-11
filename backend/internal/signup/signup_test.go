package signup_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/signup"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

func TestCreate(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	email := "signup-" + testdb.RandomSuffix() + "@example.test"
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email) })

	// 23:30 UTC on 5 Nov is already 6 Nov in Bucharest: the Cash account opens on the household's day.
	now := time.Date(2026, 11, 5, 23, 30, 0, 0, time.UTC)
	name := "Ana"
	var res signup.Result
	err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		var err error
		res, err = signup.Create(ctx, tx, signup.Params{Email: email, DisplayName: &name, EmailVerified: true, Now: now})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.User.Username == "" || res.User.Username[:7] != "signup-" {
		t.Fatalf("derived username = %q", res.User.Username)
	}
	if res.User.EmailVerifiedAt == nil || res.User.PasswordHash != nil || res.User.DisplayName == nil {
		t.Fatalf("user = %+v", res.User)
	}

	var currency, tz string
	var startDay, categories int
	var role string
	if err := pool.QueryRow(ctx, `
		SELECT h.home_currency, h.timezone, h.month_start_day, m.role,
		       (SELECT count(*) FROM categories c WHERE c.household_id = h.id)
		  FROM households h JOIN household_members m ON m.household_id = h.id
		 WHERE h.id = $1 AND m.user_id = $2`, res.HouseholdID, res.UserID).
		Scan(&currency, &tz, &startDay, &role, &categories); err != nil {
		t.Fatal(err)
	}
	if currency != "RON" || tz != "Europe/Bucharest" || startDay != 1 || role != "owner" || categories != 13 {
		t.Fatalf("household: %s %s %d %s %d categories", currency, tz, startDay, role, categories)
	}

	var accName, accType, accCurrency string
	var opening int64
	var openingOn time.Time
	var sortOrder int
	if err := pool.QueryRow(ctx, `
		SELECT name, type::text, currency, opening_balance_minor, opening_balance_on, sort_order
		  FROM accounts WHERE id = $1 AND household_id = $2 AND created_by = $3`, res.AccountID, res.HouseholdID, res.UserID).
		Scan(&accName, &accType, &accCurrency, &opening, &openingOn, &sortOrder); err != nil {
		t.Fatal(err)
	}
	if accName != "Cash" || accType != "cash" || accCurrency != "RON" || opening != 0 || sortOrder != 10 ||
		openingOn.Format("2006-01-02") != "2026-11-06" {
		t.Fatalf("account: %s %s %s %d %s %d", accName, accType, accCurrency, opening, openingOn, sortOrder)
	}
}

func TestCreateDuplicateEmailRollsBack(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	f := testdb.NewHousehold(t, pool)
	err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		_, err := signup.Create(ctx, tx, signup.Params{Email: f.Email})
		return err
	})
	if err == nil {
		t.Fatal("duplicate email accepted")
	}
}
