-- Creating a new user with their household and first account (package signup).

-- name: SignupInsertUser :one
-- A NULL username is filled in from the email by the users_fill_username trigger.
INSERT INTO users (email, username, password_hash, password_changed_at, display_name, email_verified_at)
VALUES (sqlc.arg(email), sqlc.narg(username), sqlc.narg(password_hash), sqlc.narg(password_changed_at),
        sqlc.narg(display_name), sqlc.narg(email_verified_at))
RETURNING *;

-- name: SignupInsertHousehold :one
-- Defaults: RON, Europe/Bucharest, month start day 1. A trigger adds the default categories.
INSERT INTO households DEFAULT VALUES
RETURNING id, home_currency, timezone;

-- name: SignupInsertOwner :exec
INSERT INTO household_members (household_id, user_id, role)
VALUES (sqlc.arg(household_id), sqlc.arg(user_id), 'owner');

-- name: SignupInsertCashAccount :one
INSERT INTO accounts (household_id, name, type, currency, opening_balance_minor, opening_balance_on, sort_order, created_by)
VALUES (sqlc.arg(household_id), 'Cash', 'cash', sqlc.arg(currency), 0, sqlc.arg(opening_balance_on), 10, sqlc.arg(created_by))
RETURNING id;
