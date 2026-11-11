-- Sessions, identities and email-link tokens (DB doc § 4). Owned by the auth handlers.

-- name: AuthInsertSession :one
INSERT INTO sessions (user_id, refresh_token_hash, rotated_at, platform, device_name, user_agent,
                      ip_address, auth_method, created_at, last_used_at, expires_at)
VALUES (sqlc.arg(user_id), sqlc.arg(refresh_token_hash), sqlc.arg(now)::timestamptz, sqlc.arg(platform),
        sqlc.narg(device_name), sqlc.narg(user_agent), sqlc.narg(ip_address), sqlc.arg(auth_method),
        sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz, sqlc.arg(expires_at))
RETURNING *;

-- name: AuthLockSessionByToken :one
-- The session whose current or previous refresh token has this hash, locked so two
-- refreshes of the same session run one after the other.
SELECT * FROM sessions
 WHERE refresh_token_hash = sqlc.arg(token_hash) OR previous_refresh_token_hash = sqlc.arg(token_hash)
 LIMIT 1
   FOR UPDATE;

-- name: AuthRotateSession :exec
UPDATE sessions
   SET previous_refresh_token_hash = refresh_token_hash,
       refresh_token_hash          = sqlc.arg(new_hash),
       rotated_at                  = sqlc.arg(now)::timestamptz,
       last_used_at                = sqlc.arg(now)::timestamptz,
       expires_at                  = sqlc.arg(expires_at)
 WHERE id = sqlc.arg(id);

-- name: AuthTouchSession :exec
UPDATE sessions SET last_used_at = sqlc.arg(now)::timestamptz WHERE id = sqlc.arg(id);

-- name: AuthRevokeSession :exec
UPDATE sessions SET revoked_at = sqlc.arg(now)::timestamptz WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: AuthRevokeSessionByToken :exec
UPDATE sessions SET revoked_at = sqlc.arg(now)::timestamptz
 WHERE (refresh_token_hash = sqlc.arg(token_hash) OR previous_refresh_token_hash = sqlc.arg(token_hash))
   AND revoked_at IS NULL;

-- name: AuthRevokeUserSessions :exec
UPDATE sessions SET revoked_at = sqlc.arg(now)::timestamptz
 WHERE user_id = sqlc.arg(user_id) AND revoked_at IS NULL;

-- name: AuthRevokeOtherUserSessions :exec
UPDATE sessions SET revoked_at = sqlc.arg(now)::timestamptz
 WHERE user_id = sqlc.arg(user_id) AND id <> sqlc.arg(keep_session_id) AND revoked_at IS NULL;

-- name: AuthGetPrincipal :one
-- One query per authenticated request: the session is live and the user belongs to a
-- household (their first, by joined_at).
SELECT s.user_id, s.id AS session_id, m.household_id
  FROM sessions s
  JOIN LATERAL (
        SELECT hm.household_id
          FROM household_members hm
         WHERE hm.user_id = s.user_id
         ORDER BY hm.joined_at, hm.household_id
         LIMIT 1
       ) m ON true
 WHERE s.id = sqlc.arg(session_id)
   AND s.user_id = sqlc.arg(user_id)
   AND s.revoked_at IS NULL
   AND s.expires_at > sqlc.arg(now)::timestamptz;

-- name: AuthGetIdentity :one
SELECT * FROM user_identities WHERE provider = sqlc.arg(provider) AND provider_subject = sqlc.arg(subject);

-- name: AuthGetUserIdentityByProvider :one
SELECT * FROM user_identities WHERE user_id = sqlc.arg(user_id) AND provider = sqlc.arg(provider);

-- name: AuthInsertIdentity :exec
INSERT INTO user_identities (user_id, provider, provider_subject, email, email_verified, created_at, last_used_at)
VALUES (sqlc.arg(user_id), sqlc.arg(provider), sqlc.arg(subject), sqlc.narg(email), sqlc.arg(email_verified),
        sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz);

-- name: AuthTouchIdentity :exec
UPDATE user_identities
   SET email = sqlc.narg(email), email_verified = sqlc.arg(email_verified), last_used_at = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id);

-- name: AuthListUserProviders :many
SELECT provider FROM user_identities WHERE user_id = sqlc.arg(user_id) ORDER BY provider;

-- name: AuthInsertVerificationToken :exec
INSERT INTO verification_tokens (user_id, purpose, token_hash, email, expires_at, created_at)
VALUES (sqlc.arg(user_id), sqlc.arg(purpose), sqlc.arg(token_hash), sqlc.arg(email), sqlc.arg(expires_at), sqlc.arg(now)::timestamptz);

-- name: AuthConsumeVerificationToken :one
-- Marks a live token used and returns its user. Nothing comes back when the token is
-- unknown, used, expired, for another purpose, or for an address the user no longer has.
UPDATE verification_tokens vt
   SET consumed_at = sqlc.arg(now)::timestamptz
  FROM users u
 WHERE vt.token_hash = sqlc.arg(token_hash)
   AND vt.purpose = sqlc.arg(purpose)
   AND vt.consumed_at IS NULL
   AND vt.expires_at > sqlc.arg(now)::timestamptz
   AND u.id = vt.user_id
   AND u.email = vt.email
RETURNING vt.user_id;
