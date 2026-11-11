package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/mail"
	"github.com/andreipana03/budget-tracker/backend/internal/ratelimit"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Shared pieces of the auth handlers: sessions, the refresh cookie, client details,
// email links and the bearer-token Authenticator.

const (
	authRefreshGrace      = 30 * time.Second // DB doc § 4: two tabs refreshing at once
	authVerifyEmailTTL    = 24 * time.Hour
	authResetPasswordTTL  = time.Hour
	authMailTimeout       = 30 * time.Second
	authDefaultSessionTTL = 90 * 24 * time.Hour
	authDefaultCookieName = "bt_refresh"
)

// Rate limits (in-memory, per IP and per identifier). Off when RATE_LIMIT_ENABLED=false.
var (
	authRuleLoginIP      = ratelimit.PerWindow(10, time.Minute)
	authRuleLoginID      = ratelimit.PerWindow(5, 15*time.Minute)
	authRuleRegisterIP   = ratelimit.PerWindow(10, time.Hour)
	authRuleGoogleIP     = ratelimit.PerWindow(20, time.Minute)
	authRuleForgotIP     = ratelimit.PerWindow(5, 15*time.Minute)
	authRuleForgotEmail  = ratelimit.PerWindow(3, time.Hour)
	authRuleTokenIP      = ratelimit.PerWindow(20, 15*time.Minute) // verify-email, reset-password
	authRuleResendUser   = ratelimit.PerWindow(1, time.Minute)
	authRulePasswordUser = ratelimit.PerWindow(5, 15*time.Minute)
)

var (
	errAuthSessionExpired = apierr.Unauthorized("session_expired", "Your session has ended. Sign in again.")
	errAuthInvalidCreds   = apierr.Unauthorized("invalid_credentials", "That email, username or password isn’t right.")
	errAuthInvalidToken   = apierr.BadRequest("invalid_token", "This link has expired or was already used. Ask for a new one.")
)

// authLimit answers 429 when any bucket is empty.
func (s *Server) authLimit(checks ...ratelimit.Check) error {
	if ok, wait := s.limiter.Allow(checks...); !ok {
		return apierr.RateLimited(wait)
	}
	return nil
}

// authClient is who is signing in from where.
type authClient struct {
	platform   store.ClientPlatform
	deviceName *string
	userAgent  *string
	ip         *netip.Addr
}

func authPlatform(p gen.Platform) (store.ClientPlatform, error) {
	cp := store.ClientPlatform(p)
	if !cp.Valid() {
		return "", apierr.Validation(apierr.Field("platform", "invalid", "Use web or ios."))
	}
	return cp, nil
}

// authClientFrom reads the platform, device name, user agent and IP of the request.
func (s *Server) authClientFrom(ctx context.Context, platform gen.Platform, deviceName *string) (authClient, error) {
	cp, err := authPlatform(platform)
	if err != nil {
		return authClient{}, err
	}
	c := authClient{platform: cp}
	_, r := httpFrom(ctx)
	ua := ""
	if r != nil {
		ua = r.UserAgent()
		if ip, ok := authClientIP(r, s.cfg.TrustProxy); ok {
			c.ip = &ip
		}
	}
	if ua != "" {
		c.userAgent = ptr(authTruncate(ua, 512))
	}
	name := ""
	if deviceName != nil {
		name = strings.TrimSpace(*deviceName)
	}
	if name == "" {
		name = auth.DeviceName(ua)
	}
	if name != "" {
		c.deviceName = ptr(authTruncate(name, 100))
	}
	return c, nil
}

// authClientIP is the caller's IP. Behind a trusted proxy (TRUST_PROXY, one hop) it's the
// LAST X-Forwarded-For entry: the one our proxy appended. Earlier entries come from the
// client and can be anything, so trusting them would let anyone dodge per-IP rate limits.
// Otherwise it's the connection's address.
func authClientIP(r *http.Request, trustProxy bool) (netip.Addr, bool) {
	if trustProxy {
		if values := r.Header.Values("X-Forwarded-For"); len(values) > 0 {
			hops := strings.Split(values[len(values)-1], ",")
			if ip, err := netip.ParseAddr(strings.TrimSpace(hops[len(hops)-1])); err == nil {
				return ip.Unmap(), true
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return ip.Unmap(), true
}

// authIPKey is the rate-limit key part for the caller's IP.
func (s *Server) authIPKey(ctx context.Context) string {
	_, r := httpFrom(ctx)
	if r == nil {
		return "unknown"
	}
	if ip, ok := authClientIP(r, s.cfg.TrustProxy); ok {
		return ip.String()
	}
	return "unknown"
}

func authTruncate(s string, maxRunes int) string {
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	return string([]rune(s)[:maxRunes])
}

func (s *Server) authSessionTTL() time.Duration {
	if s.cfg.SessionTTL > 0 {
		return s.cfg.SessionTTL
	}
	return authDefaultSessionTTL
}

// authIssued is a freshly signed access token, plus a refresh token when one was issued.
type authIssued struct {
	sessionID uuid.UUID
	access    string
	accessExp time.Time
	refresh   string // "" during the refresh grace window
}

// authStartSession creates a session (a signed-in device) and its tokens.
func (s *Server) authStartSession(ctx context.Context, q *store.Queries, userID uuid.UUID, c authClient, method store.AuthMethod) (authIssued, error) {
	now := s.clock.Now()
	raw, hash, err := auth.NewOpaqueToken()
	if err != nil {
		return authIssued{}, err
	}
	sess, err := q.AuthInsertSession(ctx, store.AuthInsertSessionParams{
		UserID:           userID,
		RefreshTokenHash: hash,
		Now:              now,
		Platform:         c.platform,
		DeviceName:       c.deviceName,
		UserAgent:        c.userAgent,
		IpAddress:        c.ip,
		AuthMethod:       method,
		ExpiresAt:        now.Add(s.authSessionTTL()),
	})
	if err != nil {
		return authIssued{}, fmt.Errorf("insert session: %w", err)
	}
	access, exp, err := s.tokens.Issue(userID, sess.ID, now)
	if err != nil {
		return authIssued{}, err
	}
	return authIssued{sessionID: sess.ID, access: access, accessExp: exp, refresh: raw}, nil
}

// authResponse builds the AuthResponse body. On the web the refresh token goes into
// the HttpOnly cookie; on iOS into the body.
func (s *Server) authResponse(ctx context.Context, q *store.Queries, user store.User, platform store.ClientPlatform, issued authIssued, isNew bool) (gen.AuthResponse, error) {
	u, err := s.authUserBody(ctx, q, user)
	if err != nil {
		return gen.AuthResponse{}, err
	}
	resp := gen.AuthResponse{
		AccessToken:          issued.access,
		AccessTokenExpiresAt: issued.accessExp.UTC(),
		IsNewUser:            isNew,
		User:                 u,
	}
	if issued.refresh != "" {
		if platform == store.ClientPlatformIos {
			resp.RefreshToken = ptr(issued.refresh)
		} else {
			s.authSetRefreshCookie(ctx, issued.refresh)
		}
	}
	return resp, nil
}

// authUserBody turns a users row into the API's User.
func (s *Server) authUserBody(ctx context.Context, q *store.Queries, user store.User) (gen.User, error) {
	providers, err := q.AuthListUserProviders(ctx, user.ID)
	if err != nil {
		return gen.User{}, fmt.Errorf("list providers: %w", err)
	}
	linked := make([]gen.AuthProvider, 0, len(providers))
	for _, p := range providers {
		linked = append(linked, gen.AuthProvider(p))
	}
	return gen.User{
		Id:              user.ID,
		Email:           user.Email,
		EmailVerified:   user.EmailVerifiedAt != nil,
		Username:        user.Username,
		DisplayName:     user.DisplayName,
		Region:          user.Region,
		HasPassword:     user.PasswordHash != nil,
		LinkedProviders: linked,
		CreatedAt:       user.CreatedAt.UTC(),
	}, nil
}

func (s *Server) authCookieName() string {
	if s.cfg.CookieName != "" {
		return s.cfg.CookieName
	}
	return authDefaultCookieName
}

func (s *Server) authSetRefreshCookie(ctx context.Context, value string) {
	w, _ := httpFrom(ctx)
	if w == nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     s.authCookieName(),
		Value:    value,
		Path:     "/",
		MaxAge:   int(s.authSessionTTL().Seconds()),
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) authClearRefreshCookie(ctx context.Context) {
	w, _ := httpFrom(ctx)
	if w == nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     s.authCookieName(),
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode,
	})
}

// authPresentedRefreshToken is the body token (iOS) or else the cookie (web).
func (s *Server) authPresentedRefreshToken(ctx context.Context, body *string) string {
	if body != nil && strings.TrimSpace(*body) != "" {
		return strings.TrimSpace(*body)
	}
	_, r := httpFrom(ctx)
	if r == nil {
		return ""
	}
	if c, err := r.Cookie(s.authCookieName()); err == nil {
		return c.Value
	}
	return ""
}

// authNewEmailToken stores a single-use email-link token and returns the raw token.
func (s *Server) authNewEmailToken(ctx context.Context, q *store.Queries, user store.User, purpose store.VerificationPurpose, ttl time.Duration) (string, error) {
	now := s.clock.Now()
	raw, hash, err := auth.NewOpaqueToken()
	if err != nil {
		return "", err
	}
	if err := q.AuthInsertVerificationToken(ctx, store.AuthInsertVerificationTokenParams{
		UserID: user.ID, Purpose: purpose, TokenHash: hash, Email: user.Email, ExpiresAt: now.Add(ttl), Now: now,
	}); err != nil {
		return "", fmt.Errorf("insert verification token: %w", err)
	}
	return raw, nil
}

func (s *Server) authLink(path, token string) string {
	return s.cfg.AppBaseURL + path + "?token=" + url.QueryEscape(token)
}

// authSendMail sends m without holding up the response (synchronously with MailSync).
// Failures are logged: the person can always ask for another link.
func (s *Server) authSendMail(ctx context.Context, m mail.Message) {
	send := func(ctx context.Context) {
		ctx, cancel := context.WithTimeout(ctx, authMailTimeout)
		defer cancel()
		if err := s.mailer.Send(ctx, m); err != nil {
			s.logger.ErrorContext(ctx, "send email failed", "subject", m.Subject, "error", err)
		}
	}
	if s.mailSync {
		send(context.WithoutCancel(ctx))
		return
	}
	go send(context.WithoutCancel(ctx))
}

// Authenticator returns the bearer-token Authenticator backed by this server's
// database, JWT secret and clock. Pass it in RouterOptions.
func (s *Server) Authenticator() Authenticator {
	return &sessionAuthenticator{q: s.q, tokens: s.tokens, clock: s.clock}
}

// sessionAuthenticator checks the access JWT, then in one query that its session is
// live and the user belongs to a household.
type sessionAuthenticator struct {
	q      *store.Queries
	tokens *auth.Tokens
	clock  clock.Clock
}

func (a *sessionAuthenticator) Authenticate(ctx context.Context, r *http.Request) (Principal, error) {
	unauthorized := apierr.Unauthorized("unauthorized", "Sign in to continue.")
	h := r.Header.Get("Authorization")
	scheme, token, ok := strings.Cut(h, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
		return Principal{}, unauthorized
	}
	now := a.clock.Now()
	claims, err := a.tokens.Parse(strings.TrimSpace(token), now)
	if errors.Is(err, auth.ErrTokenExpired) {
		return Principal{}, apierr.Unauthorized("token_expired", "Your sign-in needs a refresh.")
	}
	if err != nil || a.q == nil {
		return Principal{}, unauthorized
	}
	row, err := a.q.AuthGetPrincipal(ctx, store.AuthGetPrincipalParams{SessionID: claims.SessionID, UserID: claims.UserID, Now: now})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return Principal{}, unauthorized
		}
		if dbx.IsNoRows(err) {
			return Principal{}, unauthorized
		}
		return Principal{}, apierr.Internal(fmt.Errorf("authenticate: %w", err))
	}
	return Principal{UserID: row.UserID, SessionID: row.SessionID, HouseholdID: row.HouseholdID}, nil
}
