package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/config"
	"github.com/andreipana03/budget-tracker/backend/internal/mail"
	"github.com/andreipana03/budget-tracker/backend/internal/testdb"
)

// Integration tests for auth and /me, through the real router and Authenticator
// against the test database. Helpers are prefixed authT.

const authTPassword = "Sunny-Day-2026!"

type authTFakeGoogle struct {
	mu     sync.Mutex
	tokens map[string]auth.GoogleClaims
}

func (g *authTFakeGoogle) Verify(_ context.Context, idToken string) (auth.GoogleClaims, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	c, ok := g.tokens[idToken]
	if !ok {
		return auth.GoogleClaims{}, auth.ErrInvalidGoogleToken
	}
	return c, nil
}

func (g *authTFakeGoogle) add(token string, c auth.GoogleClaims) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.tokens[token] = c
}

type authTEnv struct {
	t      *testing.T
	pool   *pgxpool.Pool
	router http.Handler
	mail   *mail.Memory
	google *authTFakeGoogle
	offset atomic.Int64 // added to the real clock
	mu     sync.Mutex
	emails []string
}

func authTServer(t *testing.T, mutate func(*Deps)) *authTEnv {
	t.Helper()
	pool := testdb.Pool(t)
	env := &authTEnv{t: t, pool: pool, mail: &mail.Memory{}, google: &authTFakeGoogle{tokens: map[string]auth.GoogleClaims{}}}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	deps := Deps{
		Pool:   pool,
		Logger: logger,
		Clock:  clock.Func(func() time.Time { return time.Now().Add(time.Duration(env.offset.Load())) }),
		Config: config.Config{
			Env:             "test",
			AppBaseURL:      "http://app.test",
			JWTSecret:       []byte("integration-test-secret-0123456789abcdef"),
			AccessTokenTTL:  15 * time.Minute,
			SessionTTL:      90 * 24 * time.Hour,
			CookieName:      "bt_refresh",
			GoogleClientIDs: []string{"test-client-id"},
		},
		Mailer:   env.mail,
		MailSync: true,
		Google:   env.google,
	}
	if mutate != nil {
		mutate(&deps)
	}
	srv := NewServer(deps)
	env.router = NewRouter(srv, logger, RouterOptions{Authenticator: srv.Authenticator()})
	t.Cleanup(func() {
		env.mu.Lock()
		defer env.mu.Unlock()
		for _, e := range env.emails {
			_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, e)
		}
	})
	return env
}

func (e *authTEnv) advance(d time.Duration) { e.offset.Add(int64(d)) }

func (e *authTEnv) track(email string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.emails = append(e.emails, strings.ToLower(email))
}

type authTOpt func(*http.Request)

func authTBearer(token string) authTOpt {
	return func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) }
}

func authTCookie(value string) authTOpt {
	return func(r *http.Request) { r.AddCookie(&http.Cookie{Name: "bt_refresh", Value: value}) }
}

func authTHeader(k, v string) authTOpt { return func(r *http.Request) { r.Header.Set(k, v) } }

type authTResp struct {
	*httptest.ResponseRecorder
	t *testing.T
}

func (e *authTEnv) do(method, path string, body any, opts ...authTOpt) authTResp {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			e.t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")
	for _, o := range opts {
		o(req)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return authTResp{ResponseRecorder: rec, t: e.t}
}

func (r authTResp) expect(status int) authTResp {
	r.t.Helper()
	if r.Code != status {
		r.t.Fatalf("status = %d, want %d; body: %s", r.Code, status, r.Body.String())
	}
	return r
}

func (r authTResp) decode(v any) {
	r.t.Helper()
	if err := json.Unmarshal(r.Body.Bytes(), v); err != nil {
		r.t.Fatalf("decode %s: %v", r.Body.String(), err)
	}
}

type authTError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Fields  []struct {
		Field string `json:"field"`
		Code  string `json:"code"`
	} `json:"fields"`
}

func (r authTResp) errBody() authTError {
	r.t.Helper()
	var e authTError
	r.decode(&e)
	if e.Message == "" {
		r.t.Fatalf("error without a message: %s", r.Body.String())
	}
	return e
}

func (r authTResp) expectError(status int, code string) authTError {
	r.t.Helper()
	r.expect(status)
	e := r.errBody()
	if e.Code != code {
		r.t.Fatalf("code = %q, want %q; body: %s", e.Code, code, r.Body.String())
	}
	return e
}

func (r authTResp) cookie() *http.Cookie {
	for _, c := range r.Result().Cookies() {
		if c.Name == "bt_refresh" {
			return c
		}
	}
	return nil
}

type authTUser struct {
	ID              string   `json:"id"`
	Email           string   `json:"email"`
	EmailVerified   bool     `json:"emailVerified"`
	Username        string   `json:"username"`
	DisplayName     *string  `json:"displayName"`
	Region          string   `json:"region"`
	HasPassword     bool     `json:"hasPassword"`
	LinkedProviders []string `json:"linkedProviders"`
}

type authTAuth struct {
	AccessToken          string    `json:"accessToken"`
	AccessTokenExpiresAt time.Time `json:"accessTokenExpiresAt"`
	RefreshToken         *string   `json:"refreshToken"`
	IsNewUser            bool      `json:"isNewUser"`
	User                 authTUser `json:"user"`
}

func (r authTResp) auth() authTAuth {
	r.t.Helper()
	var a authTAuth
	r.decode(&a)
	if a.AccessToken == "" {
		r.t.Fatalf("no access token: %s", r.Body.String())
	}
	return a
}

// authTNames returns a fresh email and username.
func authTNames() (email, username string) {
	s := testdb.RandomSuffix()
	return "auth-" + s + "@example.test", "auth-" + s
}

type authTSignedIn struct {
	authTAuth
	email, username, cookie string
}

func (e *authTEnv) register(platform string) authTSignedIn {
	e.t.Helper()
	email, username := authTNames()
	e.track(email)
	r := e.do("POST", "/auth/register", map[string]any{
		"email": email, "username": username, "password": authTPassword, "platform": platform,
	}).expect(http.StatusCreated)
	s := authTSignedIn{authTAuth: r.auth(), email: email, username: username}
	if c := r.cookie(); c != nil {
		s.cookie = c.Value
	}
	return s
}

func (e *authTEnv) login(identifier, password, platform string) authTSignedIn {
	e.t.Helper()
	r := e.do("POST", "/auth/login", map[string]any{"identifier": identifier, "password": password, "platform": platform}).
		expect(http.StatusOK)
	s := authTSignedIn{authTAuth: r.auth()}
	if c := r.cookie(); c != nil {
		s.cookie = c.Value
	}
	return s
}

func (e *authTEnv) me(token string) authTUser {
	e.t.Helper()
	var u authTUser
	e.do("GET", "/me", nil, authTBearer(token)).expect(http.StatusOK).decode(&u)
	return u
}

var authTTokenPattern = regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)

func (e *authTEnv) mailToken(to, pathPart string) string {
	e.t.Helper()
	m, err := e.mail.Last(to)
	if err != nil {
		e.t.Fatal(err)
	}
	if !strings.Contains(m.Text, pathPart) {
		e.t.Fatalf("last mail to %s is not a %s mail: %s", to, pathPart, m.Text)
	}
	match := authTTokenPattern.FindStringSubmatch(m.Text)
	if match == nil {
		e.t.Fatalf("no token in mail: %s", m.Text)
	}
	return match[1]
}

func TestAuthRegisterThenMe(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")

	if !s.IsNewUser || s.RefreshToken != nil {
		t.Fatalf("web register: isNewUser=%v refreshToken=%v", s.IsNewUser, s.RefreshToken)
	}
	if s.User.Username != s.username || s.User.EmailVerified || !s.User.HasPassword || len(s.User.LinkedProviders) != 0 || s.User.Region != "RO" {
		t.Fatalf("user = %+v", s.User)
	}
	if d := time.Until(s.AccessTokenExpiresAt); d < 14*time.Minute || d > 16*time.Minute {
		t.Fatalf("access token expires in %v", d)
	}

	// Cookie attributes.
	r := env.do("POST", "/auth/login", map[string]any{"identifier": s.email, "password": authTPassword, "platform": "web"}).expect(http.StatusOK)
	raw := r.Header().Get("Set-Cookie")
	for _, want := range []string{"bt_refresh=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=7776000"} {
		if !strings.Contains(raw, want) {
			t.Fatalf("Set-Cookie %q lacks %q", raw, want)
		}
	}
	if strings.Contains(raw, "Secure") {
		t.Fatalf("Secure set although CookieSecure is false: %q", raw)
	}

	u := env.me(s.AccessToken)
	if u.ID != s.User.ID || u.Email != s.email {
		t.Fatalf("me = %+v", u)
	}

	// Household, membership, Cash account and session details.
	ctx := context.Background()
	var categories, cash int
	var device string
	if err := env.pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM categories c JOIN household_members m USING (household_id) WHERE m.user_id = u.id),
		       (SELECT count(*) FROM accounts a JOIN household_members m USING (household_id)
		         WHERE m.user_id = u.id AND a.name = 'Cash' AND a.type = 'cash' AND a.currency = 'RON' AND a.sort_order = 10),
		       (SELECT s.device_name || '|' || s.auth_method || '|' || s.platform FROM sessions s WHERE s.user_id = u.id ORDER BY s.created_at LIMIT 1)
		  FROM users u WHERE u.id = $1`, s.User.ID).Scan(&categories, &cash, &device); err != nil {
		t.Fatal(err)
	}
	if categories != 13 || cash != 1 || device != "Safari on macOS|password|web" {
		t.Fatalf("categories=%d cash=%d session=%q", categories, cash, device)
	}

	// The verification email went out.
	if tok := env.mailToken(s.email, "/verify-email?token="); tok == "" {
		t.Fatal("no verification token")
	}
	if m, _ := env.mail.Last(s.email); !strings.HasPrefix(m.Text, "Confirm your email address") ||
		!strings.Contains(m.Text, "http://app.test/verify-email?token=") {
		t.Fatalf("mail: %+v", m)
	}
}

func TestAuthRegisterValidation(t *testing.T) {
	env := authTServer(t, nil)
	email, _ := authTNames()
	env.track(email)

	e := env.do("POST", "/auth/register", map[string]any{
		"email": email, "username": "ab", "password": "short", "platform": "web",
	}).expectError(http.StatusUnprocessableEntity, "validation_failed")
	got := map[string]bool{}
	for _, f := range e.Fields {
		got[f.Field+":"+f.Code] = true
	}
	for _, want := range []string{"username:invalid_format", "password:too_short", "password:missing_uppercase", "password:missing_digit", "password:missing_symbol"} {
		if !got[want] {
			t.Errorf("missing field error %s in %+v", want, e.Fields)
		}
	}

	e = env.do("POST", "/auth/register", map[string]any{
		"email": email, "username": "Admin", "password": authTPassword, "platform": "web",
	}).expectError(http.StatusUnprocessableEntity, "validation_failed")
	if len(e.Fields) != 1 || e.Fields[0].Field != "username" || e.Fields[0].Code != "reserved" {
		t.Fatalf("reserved: %+v", e.Fields)
	}

	e = env.do("POST", "/auth/register", map[string]any{
		"email": "not-an-email", "username": "fine-name", "password": authTPassword, "platform": "web",
	}).expectError(http.StatusUnprocessableEntity, "validation_failed")
	if len(e.Fields) != 1 || e.Fields[0].Field != "email" {
		t.Fatalf("bad email: %+v", e.Fields)
	}

	// A password that merely contains the username is fine.
	_, username := authTNames()
	env.do("POST", "/auth/register", map[string]any{
		"email": email, "username": username, "password": "X" + username + "!1", "platform": "web",
	}).expect(http.StatusCreated)
}

func TestAuthRegisterTaken(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")

	_, otherUsername := authTNames()
	e := env.do("POST", "/auth/register", map[string]any{
		"email": strings.ToUpper(s.email), "username": otherUsername, "password": authTPassword, "platform": "web",
	}).expectError(http.StatusConflict, "email_taken")
	if len(e.Fields) != 1 || e.Fields[0].Field != "email" || e.Fields[0].Code != "taken" {
		t.Fatalf("fields = %+v", e.Fields)
	}

	otherEmail, _ := authTNames()
	env.track(otherEmail)
	e = env.do("POST", "/auth/register", map[string]any{
		"email": otherEmail, "username": strings.ToUpper(s.username), "password": authTPassword, "platform": "web",
	}).expectError(http.StatusConflict, "username_taken")
	if len(e.Fields) != 1 || e.Fields[0].Field != "username" || e.Fields[0].Code != "taken" {
		t.Fatalf("fields = %+v", e.Fields)
	}

	e = env.do("POST", "/auth/register", map[string]any{
		"email": s.email, "username": s.username, "password": authTPassword, "platform": "web",
	}).expectError(http.StatusConflict, "email_taken")
	if len(e.Fields) != 2 {
		t.Fatalf("both taken: %+v", e.Fields)
	}
}

func TestAuthLogin(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")

	byEmail := env.login("  "+strings.ToUpper(s.email)+" ", authTPassword, "web")
	if byEmail.cookie == "" || byEmail.RefreshToken != nil || byEmail.IsNewUser || byEmail.User.ID != s.User.ID {
		t.Fatalf("by email: %+v", byEmail)
	}
	byUsername := env.login(strings.ToUpper(s.username), authTPassword, "ios")
	if byUsername.cookie != "" || byUsername.RefreshToken == nil || byUsername.User.ID != s.User.ID {
		t.Fatalf("by username (ios): %+v", byUsername)
	}

	env.do("POST", "/auth/login", map[string]any{"identifier": s.email, "password": "Wrong-Pass-1", "platform": "web"}).
		expectError(http.StatusUnauthorized, "invalid_credentials")
	env.do("POST", "/auth/login", map[string]any{"identifier": "nobody-" + testdb.RandomSuffix(), "password": authTPassword, "platform": "web"}).
		expectError(http.StatusUnauthorized, "invalid_credentials")
	env.do("POST", "/auth/login", map[string]any{"identifier": s.email, "password": authTPassword, "platform": "android"}).
		expectError(http.StatusUnprocessableEntity, "validation_failed")

	var lastSignIn *time.Time
	if err := env.pool.QueryRow(context.Background(), `SELECT last_sign_in_at FROM users WHERE id = $1`, s.User.ID).Scan(&lastSignIn); err != nil || lastSignIn == nil {
		t.Fatalf("last_sign_in_at = %v, %v", lastSignIn, err)
	}
}

func TestAuthProtectedEndpoints(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("ios")

	env.do("GET", "/me", nil).expectError(http.StatusUnauthorized, "unauthorized")
	env.do("GET", "/me", nil, authTBearer("garbage")).expectError(http.StatusUnauthorized, "unauthorized")
	env.do("GET", "/me", nil, authTHeader("Authorization", "Basic abc")).expectError(http.StatusUnauthorized, "unauthorized")
	env.me(s.AccessToken)

	env.advance(16 * time.Minute)
	env.do("GET", "/me", nil, authTBearer(s.AccessToken)).expectError(http.StatusUnauthorized, "token_expired")

	// A token signed with another secret.
	other, _, _ := auth.NewTokens([]byte("some-other-secret-0123456789abcdef"), 0).Issue(
		uuid.MustParse(s.User.ID), uuid.MustParse(s.User.ID), time.Now().Add(16*time.Minute))
	env.do("GET", "/me", nil, authTBearer(other)).expectError(http.StatusUnauthorized, "unauthorized")
}

func TestAuthRefreshWeb(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")
	c1 := s.cookie
	if c1 == "" {
		t.Fatal("no cookie after register")
	}

	r := env.do("POST", "/auth/refresh", map[string]any{"platform": "web"}, authTCookie(c1)).expect(http.StatusOK)
	a := r.auth()
	c2 := r.cookie()
	if c2 == nil || c2.Value == c1 || a.RefreshToken != nil || a.IsNewUser || a.User.ID != s.User.ID {
		t.Fatalf("rotation: cookie=%v body=%+v", c2, a)
	}
	env.me(a.AccessToken)

	// The old token within the grace window: an access token only, cookie untouched.
	env.advance(10 * time.Second)
	r = env.do("POST", "/auth/refresh", map[string]any{"platform": "web"}, authTCookie(c1)).expect(http.StatusOK)
	if r.Header().Get("Set-Cookie") != "" {
		t.Fatalf("grace refresh changed the cookie: %q", r.Header().Get("Set-Cookie"))
	}
	if g := r.auth(); g.RefreshToken != nil {
		t.Fatal("grace refresh returned a refresh token")
	}

	// After the grace window, the old token means theft: the session is revoked.
	env.advance(25 * time.Second)
	r = env.do("POST", "/auth/refresh", map[string]any{"platform": "web"}, authTCookie(c1))
	r.expectError(http.StatusUnauthorized, "session_expired")
	if c := r.cookie(); c == nil || c.MaxAge >= 0 {
		t.Fatalf("cookie not cleared: %v", c)
	}
	env.do("POST", "/auth/refresh", map[string]any{"platform": "web"}, authTCookie(c2.Value)).
		expectError(http.StatusUnauthorized, "session_expired")
	env.do("GET", "/me", nil, authTBearer(a.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")

	// No token at all.
	env.do("POST", "/auth/refresh", map[string]any{"platform": "web"}).expectError(http.StatusUnauthorized, "session_expired")
	env.do("POST", "/auth/refresh", map[string]any{"platform": "web"}, authTCookie("unknown")).expectError(http.StatusUnauthorized, "session_expired")
}

func TestAuthRefreshIOS(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("ios")
	if s.RefreshToken == nil || s.cookie != "" {
		t.Fatalf("ios register: refresh=%v cookie=%q", s.RefreshToken, s.cookie)
	}
	r1 := *s.RefreshToken
	r := env.do("POST", "/auth/refresh", map[string]any{"platform": "ios", "refreshToken": r1}).expect(http.StatusOK)
	a := r.auth()
	if a.RefreshToken == nil || *a.RefreshToken == r1 || r.cookie() != nil {
		t.Fatalf("ios rotation: %+v", a)
	}
	r = env.do("POST", "/auth/refresh", map[string]any{"platform": "ios", "refreshToken": *a.RefreshToken}).expect(http.StatusOK)
	if b := r.auth(); b.RefreshToken == nil || *b.RefreshToken == *a.RefreshToken {
		t.Fatal("second rotation failed")
	}

	// Expired session.
	env.advance(91 * 24 * time.Hour)
	env.do("POST", "/auth/refresh", map[string]any{"platform": "ios", "refreshToken": *r.auth().RefreshToken}).
		expectError(http.StatusUnauthorized, "session_expired")
}

func TestAuthLogout(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")

	r := env.do("POST", "/auth/logout", nil, authTCookie(s.cookie)).expect(http.StatusNoContent)
	if c := r.cookie(); c == nil || c.MaxAge >= 0 {
		t.Fatalf("cookie not cleared: %v", c)
	}
	env.do("POST", "/auth/refresh", map[string]any{"platform": "web"}, authTCookie(s.cookie)).expectError(http.StatusUnauthorized, "session_expired")
	env.do("GET", "/me", nil, authTBearer(s.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")

	ios := env.login(s.username, authTPassword, "ios")
	env.do("POST", "/auth/logout", map[string]any{"refreshToken": *ios.RefreshToken}).expect(http.StatusNoContent)
	env.do("GET", "/me", nil, authTBearer(ios.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")

	// Always succeeds.
	env.do("POST", "/auth/logout", nil).expect(http.StatusNoContent)
	env.do("POST", "/auth/logout", map[string]any{"refreshToken": "nope"}).expect(http.StatusNoContent)
}

func TestAuthVerifyEmail(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")
	token := env.mailToken(s.email, "/verify-email")

	env.do("POST", "/auth/verify-email", map[string]any{"token": "wrong"}).expectError(http.StatusBadRequest, "invalid_token")
	env.do("POST", "/auth/verify-email", map[string]any{"token": token}).expect(http.StatusNoContent)
	if u := env.me(s.AccessToken); !u.EmailVerified {
		t.Fatal("email not verified")
	}
	env.do("POST", "/auth/verify-email", map[string]any{"token": token}).expectError(http.StatusBadRequest, "invalid_token")
	env.do("POST", "/me/resend-verification", nil, authTBearer(s.AccessToken)).expectError(http.StatusConflict, "already_verified")

	// Resend works for an unverified user, and expired links are refused.
	s2 := env.register("ios")
	env.do("POST", "/me/resend-verification", nil, authTBearer(s2.AccessToken)).expect(http.StatusNoContent)
	if n := len(env.mailsTo(s2.email)); n != 2 {
		t.Fatalf("mails to %s = %d, want 2", s2.email, n)
	}
	tok2 := env.mailToken(s2.email, "/verify-email")
	env.advance(25 * time.Hour)
	env.do("POST", "/auth/verify-email", map[string]any{"token": tok2}).expectError(http.StatusBadRequest, "invalid_token")
}

func (e *authTEnv) mailsTo(to string) []mail.Message {
	var out []mail.Message
	for _, m := range e.mail.Sent() {
		if m.To == to {
			out = append(out, m)
		}
	}
	return out
}

func TestAuthForgotAndResetPassword(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")
	other := env.login(s.username, authTPassword, "ios")

	before := len(env.mail.Sent())
	env.do("POST", "/auth/forgot-password", map[string]any{"email": "nobody-" + testdb.RandomSuffix() + "@example.test"}).expect(http.StatusNoContent)
	if len(env.mail.Sent()) != before {
		t.Fatal("mail sent for an unknown address")
	}
	env.do("POST", "/auth/forgot-password", map[string]any{"email": strings.ToUpper(s.email)}).expect(http.StatusNoContent)
	token := env.mailToken(s.email, "/reset-password")
	if m, _ := env.mail.Last(s.email); m.Subject != "Reset your password" {
		t.Fatalf("subject = %q", m.Subject)
	}

	e := env.do("POST", "/auth/reset-password", map[string]any{"token": token, "password": "weak"}).
		expectError(http.StatusUnprocessableEntity, "validation_failed")
	if len(e.Fields) == 0 || e.Fields[0].Field != "password" {
		t.Fatalf("fields = %+v", e.Fields)
	}
	// A verification token can't reset a password.
	verifyTok := ""
	for _, m := range env.mailsTo(s.email) {
		if strings.Contains(m.Text, "/verify-email") {
			verifyTok = authTTokenPattern.FindStringSubmatch(m.Text)[1]
		}
	}
	env.do("POST", "/auth/reset-password", map[string]any{"token": verifyTok, "password": "Brand-New-Pass-7"}).
		expectError(http.StatusBadRequest, "invalid_token")

	env.do("POST", "/auth/reset-password", map[string]any{"token": token, "password": "Brand-New-Pass-7"}).expect(http.StatusNoContent)
	env.do("POST", "/auth/reset-password", map[string]any{"token": token, "password": "Brand-New-Pass-8"}).
		expectError(http.StatusBadRequest, "invalid_token")

	// Every session is signed out.
	env.do("GET", "/me", nil, authTBearer(s.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")
	env.do("GET", "/me", nil, authTBearer(other.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")
	env.do("POST", "/auth/refresh", map[string]any{"platform": "ios", "refreshToken": *other.RefreshToken}).
		expectError(http.StatusUnauthorized, "session_expired")

	env.do("POST", "/auth/login", map[string]any{"identifier": s.email, "password": authTPassword, "platform": "web"}).
		expectError(http.StatusUnauthorized, "invalid_credentials")
	fresh := env.login(s.email, "Brand-New-Pass-7", "web")
	if !fresh.User.EmailVerified {
		t.Fatal("a used reset link should verify the address")
	}

	// Expired reset links are refused.
	env.do("POST", "/auth/forgot-password", map[string]any{"email": s.email}).expect(http.StatusNoContent)
	late := env.mailToken(s.email, "/reset-password")
	env.advance(61 * time.Minute)
	env.do("POST", "/auth/reset-password", map[string]any{"token": late, "password": "Brand-New-Pass-9"}).
		expectError(http.StatusBadRequest, "invalid_token")
}

func TestAuthChangePassword(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")
	other := env.login(s.username, authTPassword, "ios")

	env.do("POST", "/me/password", map[string]any{"newPassword": "Another-Pass-5"}, authTBearer(s.AccessToken)).
		expectError(http.StatusUnprocessableEntity, "validation_failed")
	env.do("POST", "/me/password", map[string]any{"currentPassword": "Wrong-Pass-1", "newPassword": "Another-Pass-5"}, authTBearer(s.AccessToken)).
		expectError(http.StatusUnauthorized, "invalid_credentials")
	e := env.do("POST", "/me/password", map[string]any{"currentPassword": authTPassword, "newPassword": s.username}, authTBearer(s.AccessToken)).
		expectError(http.StatusUnprocessableEntity, "validation_failed")
	if e.Fields[0].Field != "newPassword" {
		t.Fatalf("fields = %+v", e.Fields)
	}
	env.do("POST", "/me/password", map[string]any{"currentPassword": authTPassword, "newPassword": "Another-Pass-5"}, authTBearer(s.AccessToken)).
		expect(http.StatusNoContent)

	env.me(s.AccessToken) // this session stays
	env.do("GET", "/me", nil, authTBearer(other.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")
	env.login(s.email, "Another-Pass-5", "web")
}

func TestAuthDeleteMe(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")
	ctx := context.Background()
	var householdID string
	if err := env.pool.QueryRow(ctx, `SELECT household_id::text FROM household_members WHERE user_id = $1`, s.User.ID).Scan(&householdID); err != nil {
		t.Fatal(err)
	}

	r := env.do("DELETE", "/me", nil, authTBearer(s.AccessToken)).expect(http.StatusNoContent)
	if c := r.cookie(); c == nil || c.MaxAge >= 0 {
		t.Fatalf("cookie not cleared: %v", c)
	}
	env.do("GET", "/me", nil, authTBearer(s.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")

	var users, households, accounts, sessions int
	if err := env.pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM users WHERE id = $1),
		       (SELECT count(*) FROM households WHERE id = $2::uuid),
		       (SELECT count(*) FROM accounts WHERE household_id = $2::uuid),
		       (SELECT count(*) FROM sessions WHERE user_id = $1)`, s.User.ID, householdID).
		Scan(&users, &households, &accounts, &sessions); err != nil {
		t.Fatal(err)
	}
	if users+households+accounts+sessions != 0 {
		t.Fatalf("left behind: users=%d households=%d accounts=%d sessions=%d", users, households, accounts, sessions)
	}
}

func TestAuthUpdateMe(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")
	taken := env.register("ios")

	var u authTUser
	_, newName := authTNames()
	env.do("PATCH", "/me", map[string]any{"displayName": "  Ana Pop ", "username": strings.ToUpper(newName), "region": "US"},
		authTBearer(s.AccessToken)).expect(http.StatusOK).decode(&u)
	if u.DisplayName == nil || *u.DisplayName != "Ana Pop" || u.Username != newName || u.Region != "US" {
		t.Fatalf("updated = %+v", u)
	}
	env.do("PATCH", "/me", map[string]any{"displayName": ""}, authTBearer(s.AccessToken)).expect(http.StatusOK).decode(&u)
	if u.DisplayName != nil || u.Username != newName {
		t.Fatalf("cleared = %+v", u)
	}
	// Keeping the same username is fine.
	env.do("PATCH", "/me", map[string]any{"username": newName}, authTBearer(s.AccessToken)).expect(http.StatusOK)

	e := env.do("PATCH", "/me", map[string]any{"username": taken.username}, authTBearer(s.AccessToken)).
		expectError(http.StatusConflict, "username_taken")
	if len(e.Fields) != 1 || e.Fields[0].Field != "username" || e.Fields[0].Code != "taken" {
		t.Fatalf("fields = %+v", e.Fields)
	}
	e = env.do("PATCH", "/me", map[string]any{"username": "root", "region": "ro", "displayName": strings.Repeat("a", 81)}, authTBearer(s.AccessToken)).
		expectError(http.StatusUnprocessableEntity, "validation_failed")
	if len(e.Fields) != 3 {
		t.Fatalf("fields = %+v", e.Fields)
	}
}

func TestAuthCheckUsername(t *testing.T) {
	env := authTServer(t, nil)
	s := env.register("web")
	check := func(name string) (available bool, reason string, normalized string) {
		var body struct {
			Username  string  `json:"username"`
			Available bool    `json:"available"`
			Reason    *string `json:"reason"`
		}
		env.do("GET", "/auth/username-available?username="+name, nil).expect(http.StatusOK).decode(&body)
		return body.Available, deref(body.Reason), body.Username
	}
	if ok, reason, _ := check("ab"); ok || reason != "invalid" {
		t.Fatalf("ab: %v %q", ok, reason)
	}
	if ok, reason, _ := check("admin"); ok || reason != "reserved" {
		t.Fatalf("admin: %v %q", ok, reason)
	}
	if ok, reason, _ := check(strings.ToUpper(s.username)); ok || reason != "taken" {
		t.Fatalf("taken: %v %q", ok, reason)
	}
	_, free := authTNames()
	if ok, reason, normalized := check(strings.ToUpper(free)); !ok || reason != "" || normalized != free {
		t.Fatalf("free: %v %q %q", ok, reason, normalized)
	}
	if _, reason, _ := check("admin-test"); reason == "reserved" || reason == "invalid" {
		t.Fatalf("admin-test must be allowed, got %q", reason)
	}
}

func TestAuthGoogle(t *testing.T) {
	env := authTServer(t, nil)

	// New user.
	email, _ := authTNames()
	env.track(email)
	sub := "google-sub-" + testdb.RandomSuffix()
	env.google.add("tok-new", auth.GoogleClaims{Subject: sub, Email: strings.ToUpper(email), EmailVerified: true, Name: "Ana Pop"})
	a := env.do("POST", "/auth/google", map[string]any{"idToken": "tok-new", "platform": "web"}).expect(http.StatusOK).auth()
	if !a.IsNewUser || a.User.Email != email || !a.User.EmailVerified || a.User.HasPassword ||
		a.User.DisplayName == nil || *a.User.DisplayName != "Ana Pop" || strings.Join(a.User.LinkedProviders, ",") != "google" {
		t.Fatalf("new google user: %+v", a)
	}
	if want := strings.Split(email, "@")[0]; a.User.Username != want {
		t.Fatalf("username = %q, want %q", a.User.Username, want)
	}
	var method string
	_ = env.pool.QueryRow(context.Background(), `SELECT auth_method::text FROM sessions WHERE user_id = $1`, a.User.ID).Scan(&method)
	if method != "google" {
		t.Fatalf("auth_method = %q", method)
	}

	// Known subject → same user, even if Google now reports another address.
	env.google.add("tok-again", auth.GoogleClaims{Subject: sub, Email: "changed-" + email, EmailVerified: true})
	b := env.do("POST", "/auth/google", map[string]any{"idToken": "tok-again", "platform": "ios"}).expect(http.StatusOK).auth()
	if b.IsNewUser || b.User.ID != a.User.ID || b.RefreshToken == nil {
		t.Fatalf("known subject: %+v", b)
	}

	// Verified email of an existing, verified password user → linked, password kept.
	pw := env.register("web")
	env.do("POST", "/auth/verify-email", map[string]any{"token": env.mailToken(pw.email, "/verify-email")}).expect(http.StatusNoContent)
	env.google.add("tok-link", auth.GoogleClaims{Subject: "google-sub-" + testdb.RandomSuffix(), Email: pw.email, EmailVerified: true})
	c := env.do("POST", "/auth/google", map[string]any{"idToken": "tok-link", "platform": "web"}).expect(http.StatusOK).auth()
	if c.IsNewUser || c.User.ID != pw.User.ID || !c.User.HasPassword || strings.Join(c.User.LinkedProviders, ",") != "google" {
		t.Fatalf("link verified: %+v", c)
	}
	env.me(pw.AccessToken) // their session survives

	// A second Google account for the same user is refused.
	env.google.add("tok-second", auth.GoogleClaims{Subject: "google-sub-" + testdb.RandomSuffix(), Email: pw.email, EmailVerified: true})
	env.do("POST", "/auth/google", map[string]any{"idToken": "tok-second", "platform": "web"}).expectError(http.StatusConflict, "identity_conflict")

	// Unverified registration of the address → merged: password cleared, sessions revoked.
	squatter := env.register("ios")
	env.google.add("tok-merge", auth.GoogleClaims{Subject: "google-sub-" + testdb.RandomSuffix(), Email: squatter.email, EmailVerified: true})
	d := env.do("POST", "/auth/google", map[string]any{"idToken": "tok-merge", "platform": "web"}).expect(http.StatusOK).auth()
	if d.IsNewUser || d.User.ID != squatter.User.ID || d.User.HasPassword || !d.User.EmailVerified {
		t.Fatalf("merge: %+v", d)
	}
	env.do("GET", "/me", nil, authTBearer(squatter.AccessToken)).expectError(http.StatusUnauthorized, "unauthorized")
	env.do("POST", "/auth/refresh", map[string]any{"platform": "ios", "refreshToken": *squatter.RefreshToken}).
		expectError(http.StatusUnauthorized, "session_expired")
	env.do("POST", "/auth/login", map[string]any{"identifier": squatter.email, "password": authTPassword, "platform": "web"}).
		expectError(http.StatusUnauthorized, "invalid_credentials")
	env.me(d.AccessToken)

	// Google-only users can set a password without a current one.
	env.do("POST", "/me/password", map[string]any{"newPassword": "First-Pass-42"}, authTBearer(d.AccessToken)).expect(http.StatusNoContent)
	if u := env.me(d.AccessToken); !u.HasPassword {
		t.Fatal("password not set")
	}

	// Unverified Google email matching an account → refused.
	other := env.register("web")
	env.google.add("tok-unverified", auth.GoogleClaims{Subject: "google-sub-" + testdb.RandomSuffix(), Email: other.email, EmailVerified: false})
	env.do("POST", "/auth/google", map[string]any{"idToken": "tok-unverified", "platform": "web"}).expectError(http.StatusConflict, "email_taken")

	// Bad token.
	env.do("POST", "/auth/google", map[string]any{"idToken": "forged", "platform": "web"}).expectError(http.StatusUnauthorized, "invalid_google_token")

	// Not configured.
	off := authTServer(t, func(d *Deps) { d.Config.GoogleClientIDs = nil })
	off.do("POST", "/auth/google", map[string]any{"idToken": "tok-new", "platform": "web"}).expectError(http.StatusServiceUnavailable, "google_not_configured")
}

func TestAuthRateLimits(t *testing.T) {
	env := authTServer(t, func(d *Deps) { d.Config.RateLimitEnabled = true })
	s := env.register("ios")

	for i := 0; i < 5; i++ {
		env.do("POST", "/auth/login", map[string]any{"identifier": s.username, "password": "Wrong-Pass-1", "platform": "web"}).
			expectError(http.StatusUnauthorized, "invalid_credentials")
	}
	r := env.do("POST", "/auth/login", map[string]any{"identifier": s.username, "password": authTPassword, "platform": "web"})
	r.expectError(http.StatusTooManyRequests, "rate_limited")
	if r.Header().Get("Retry-After") == "" {
		t.Fatal("no Retry-After")
	}

	env.do("POST", "/me/resend-verification", nil, authTBearer(s.AccessToken)).expect(http.StatusNoContent)
	env.do("POST", "/me/resend-verification", nil, authTBearer(s.AccessToken)).expectError(http.StatusTooManyRequests, "rate_limited")
	env.advance(61 * time.Second)
	env.do("POST", "/me/resend-verification", nil, authTBearer(s.AccessToken)).expect(http.StatusNoContent)

	for i := 0; i < 3; i++ {
		env.do("POST", "/auth/forgot-password", map[string]any{"email": s.email}).expect(http.StatusNoContent)
	}
	env.do("POST", "/auth/forgot-password", map[string]any{"email": s.email}).expectError(http.StatusTooManyRequests, "rate_limited")
}

func TestAuthClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "198.51.100.7:4321"
	r.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
	if ip, _ := authClientIP(r, false); ip.String() != "198.51.100.7" {
		t.Fatalf("untrusted: %v", ip)
	}
	if ip, _ := authClientIP(r, true); ip.String() != "203.0.113.9" {
		t.Fatalf("trusted: %v", ip)
	}
	r.Header.Set("X-Forwarded-For", "garbage")
	if ip, _ := authClientIP(r, true); ip.String() != "198.51.100.7" {
		t.Fatalf("garbage XFF: %v", ip)
	}
}
