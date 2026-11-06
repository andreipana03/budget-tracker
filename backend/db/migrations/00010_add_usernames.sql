-- +goose Up
-- Usernames: people sign in with their email or their username.
-- Stored lowercased (like emails), so the unique constraint is case-insensitive.
-- When none is given (Google sign-up, seeds, tests), one is derived from the email.

ALTER TABLE users ADD COLUMN username text;

-- +goose StatementBegin
-- 'Ana.Pop+uni@example.com' → 'ana.popuni', then 'ana.popuni2', 'ana.popuni3', … if taken.
-- Local parts shorter than 3 characters become 'user', 'user2', …
CREATE FUNCTION generate_username(p_email text) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    base      text;
    candidate text;
    n         integer := 1;
BEGIN
    base := left(regexp_replace(lower(split_part(btrim(p_email), '@', 1)), '[^a-z0-9._-]', '', 'g'), 26);
    IF char_length(base) < 3 THEN
        base := 'user';
    END IF;
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM users WHERE username = candidate) LOOP
        n := n + 1;
        candidate := base || n;
    END LOOP;
    RETURN candidate;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fill_username() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.username := generate_username(NEW.email);
    RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER users_fill_username
    BEFORE INSERT ON users
    FOR EACH ROW WHEN (NEW.username IS NULL) EXECUTE FUNCTION fill_username();

-- Existing users, one at a time so each sees the names given before it.
-- updated_at is left alone: nothing the person did changed.
ALTER TABLE users DISABLE TRIGGER users_set_updated_at;
-- +goose StatementBegin
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT id, email FROM users WHERE username IS NULL ORDER BY created_at, id LOOP
        UPDATE users SET username = generate_username(r.email) WHERE id = r.id;
    END LOOP;
END
$$;
-- +goose StatementEnd
ALTER TABLE users ENABLE TRIGGER users_set_updated_at;

ALTER TABLE users
    ALTER COLUMN username SET NOT NULL,
    ADD CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9._-]{3,30}$'),
    ADD CONSTRAINT users_username_key UNIQUE (username);

-- +goose Down
DROP TRIGGER users_fill_username ON users;
DROP FUNCTION fill_username();
DROP FUNCTION generate_username(text);
ALTER TABLE users DROP COLUMN username;
