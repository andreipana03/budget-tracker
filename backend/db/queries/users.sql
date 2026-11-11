-- Users: lookups and profile changes. Emails and usernames are stored normalized
-- (lower(trim())), so equality here is case-insensitive.

-- name: AuthGetUser :one
SELECT * FROM users WHERE id = sqlc.arg(id);

-- name: AuthGetUserForUpdate :one
SELECT * FROM users WHERE id = sqlc.arg(id) FOR UPDATE;

-- name: AuthGetUserByEmail :one
SELECT * FROM users WHERE email = sqlc.arg(email);

-- name: AuthGetUserByEmailForUpdate :one
SELECT * FROM users WHERE email = sqlc.arg(email) FOR UPDATE;

-- name: AuthGetUserByUsername :one
SELECT * FROM users WHERE username = sqlc.arg(username);

-- name: AuthEmailExists :one
SELECT EXISTS (SELECT 1 FROM users WHERE email = sqlc.arg(email));

-- name: AuthUsernameExists :one
SELECT EXISTS (SELECT 1 FROM users WHERE username = sqlc.arg(username));

-- name: AuthSetLastSignIn :exec
UPDATE users SET last_sign_in_at = sqlc.arg(now)::timestamptz WHERE id = sqlc.arg(id);

-- name: AuthSetPassword :exec
UPDATE users SET password_hash = sqlc.arg(password_hash)::text, password_changed_at = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id);

-- name: AuthMarkEmailVerified :exec
UPDATE users SET email_verified_at = COALESCE(email_verified_at, sqlc.arg(now)::timestamptz) WHERE id = sqlc.arg(id);

-- name: AuthMergeUnverifiedUser :exec
-- Google proved the address belongs to someone else than whoever registered it
-- unverified: the address is now verified and the old password must not survive.
UPDATE users SET email_verified_at = sqlc.arg(now)::timestamptz, password_hash = NULL, password_changed_at = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id);

-- name: AuthUpdateProfile :one
UPDATE users
   SET display_name = CASE WHEN sqlc.arg(set_display_name)::boolean THEN sqlc.narg(display_name) ELSE display_name END,
       username     = COALESCE(sqlc.narg(username), username),
       region       = COALESCE(sqlc.narg(region), region)
 WHERE id = sqlc.arg(id)
RETURNING *;

-- name: AuthDeleteUser :execrows
-- Cascades to identities, sessions, tokens and memberships; a household left without
-- members is deleted with all of its data.
DELETE FROM users WHERE id = sqlc.arg(id);
