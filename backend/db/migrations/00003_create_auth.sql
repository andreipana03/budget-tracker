-- +goose Up
-- People and how they sign in: email + password, Google, Sign in with Apple and passkeys.
-- One user can have several sign-in methods and several devices signed in at once.

CREATE TYPE auth_provider AS ENUM ('google', 'apple');
CREATE TYPE auth_method AS ENUM ('password', 'google', 'apple', 'passkey');
CREATE TYPE client_platform AS ENUM ('web', 'ios');
CREATE TYPE verification_purpose AS ENUM ('email_verification', 'password_reset');
CREATE TYPE webauthn_ceremony AS ENUM ('registration', 'authentication');

CREATE TABLE users (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- Stored lowercased and trimmed by the API, so the unique constraint is case-insensitive.
    email               text NOT NULL,
    email_verified_at   timestamptz,
    -- argon2id PHC string. NULL for people who only use Google, Apple or a passkey.
    password_hash       text,
    password_changed_at timestamptz,
    display_name        text,
    -- UI language (BCP 47 language, e.g. 'en') and formatting region (ISO 3166, e.g. 'RO' → 1.234,29 lei).
    locale              text NOT NULL DEFAULT 'en',
    region              text NOT NULL DEFAULT 'RO',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    last_sign_in_at     timestamptz,
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND email LIKE '_%@_%'),
    CONSTRAINT users_password_hash_argon2id CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
    CONSTRAINT users_display_name_length CHECK (char_length(display_name) <= 80),
    CONSTRAINT users_locale_format CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
    CONSTRAINT users_region_format CHECK (region ~ '^[A-Z]{2}$')
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Google and Apple accounts linked to a user (OpenID Connect).
CREATE TABLE user_identities (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider                auth_provider NOT NULL,
    -- The `sub` claim: the provider's stable id for this person. Emails can change; this can't.
    provider_subject        text NOT NULL,
    -- What the provider reported at the last sign-in. Apple may give a private relay address.
    email                   text,
    email_verified          boolean NOT NULL DEFAULT false,
    -- Apple only: encrypted by the API. Needed to revoke the Apple token when the user deletes their account.
    refresh_token_encrypted bytea,
    created_at              timestamptz NOT NULL DEFAULT now(),
    last_used_at            timestamptz,
    CONSTRAINT user_identities_provider_subject_key UNIQUE (provider, provider_subject),
    CONSTRAINT user_identities_user_provider_key UNIQUE (user_id, provider)
);

-- WebAuthn credentials (Face ID, Touch ID, iCloud Keychain, security keys).
-- Columns follow go-webauthn's Credential type. The WebAuthn user handle is users.id.
CREATE TABLE passkeys (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    credential_id    bytea NOT NULL,
    public_key       bytea NOT NULL,
    attestation_type text NOT NULL DEFAULT 'none',
    aaguid           uuid,
    sign_count       bigint NOT NULL DEFAULT 0,
    transports       text[] NOT NULL DEFAULT '{}',
    backup_eligible  boolean NOT NULL DEFAULT false,
    backup_state     boolean NOT NULL DEFAULT false,
    -- Shown in Settings so people can tell their passkeys apart, e.g. "iCloud Keychain".
    name             text NOT NULL DEFAULT 'Passkey',
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_used_at     timestamptz,
    CONSTRAINT passkeys_credential_id_key UNIQUE (credential_id),
    CONSTRAINT passkeys_sign_count_non_negative CHECK (sign_count >= 0),
    CONSTRAINT passkeys_name_length CHECK (char_length(name) BETWEEN 1 AND 60)
);

CREATE INDEX passkeys_user_id_idx ON passkeys (user_id);

-- Short-lived state between the two steps of a passkey ceremony (begin → finish).
CREATE TABLE webauthn_challenges (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- NULL for discoverable sign-in, where we don't know who is signing in yet.
    user_id      uuid REFERENCES users (id) ON DELETE CASCADE,
    ceremony     webauthn_ceremony NOT NULL,
    -- go-webauthn's SessionData, including the challenge.
    session_data jsonb NOT NULL,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_challenges_expires_at_idx ON webauthn_challenges (expires_at);

-- One row per signed-in device: web and iPhone can be signed in at the same time.
-- Access tokens are short-lived JWTs carrying `sid` = sessions.id; refresh tokens rotate.
CREATE TABLE sessions (
    id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id                     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- SHA-256 of the current refresh token. The token itself is never stored.
    refresh_token_hash          bytea NOT NULL,
    -- The token before the last rotation, accepted for a few seconds (two tabs refreshing at once).
    -- Presenting it later means it was stolen: revoke the session.
    previous_refresh_token_hash bytea,
    rotated_at                  timestamptz NOT NULL DEFAULT now(),
    platform                    client_platform NOT NULL,
    -- "iPhone 17 Pro", "Safari on macOS"
    device_name                 text,
    user_agent                  text,
    ip_address                  inet,
    auth_method                 auth_method NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    last_used_at                timestamptz NOT NULL DEFAULT now(),
    expires_at                  timestamptz NOT NULL,
    revoked_at                  timestamptz,
    CONSTRAINT sessions_refresh_token_hash_key UNIQUE (refresh_token_hash),
    CONSTRAINT sessions_refresh_token_hash_sha256 CHECK (octet_length(refresh_token_hash) = 32),
    CONSTRAINT sessions_previous_refresh_token_hash_sha256 CHECK (previous_refresh_token_hash IS NULL OR octet_length(previous_refresh_token_hash) = 32),
    CONSTRAINT sessions_expires_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_previous_refresh_token_hash_idx ON sessions (previous_refresh_token_hash)
    WHERE previous_refresh_token_hash IS NOT NULL;

-- Single-use links for email verification and password reset.
CREATE TABLE verification_tokens (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     verification_purpose NOT NULL,
    -- SHA-256 of a 32-byte random token sent in the link. The token itself is never stored.
    token_hash  bytea NOT NULL,
    -- The address the link was sent to. The token is void if users.email has changed since.
    email       text NOT NULL,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT verification_tokens_token_hash_sha256 CHECK (octet_length(token_hash) = 32),
    CONSTRAINT verification_tokens_expires_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX verification_tokens_user_purpose_idx ON verification_tokens (user_id, purpose)
    WHERE consumed_at IS NULL;

-- +goose Down
DROP TABLE verification_tokens;
DROP TABLE sessions;
DROP TABLE webauthn_challenges;
DROP TABLE passkeys;
DROP TABLE user_identities;
DROP TABLE users;
DROP TYPE webauthn_ceremony;
DROP TYPE verification_purpose;
DROP TYPE client_platform;
DROP TYPE auth_method;
DROP TYPE auth_provider;
