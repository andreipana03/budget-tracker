package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Issuer is the `iss` claim of every access token.
const Issuer = "budget-tracker"

// Access-token errors. Anything that isn't ErrTokenExpired is ErrTokenInvalid.
var (
	ErrTokenExpired = errors.New("auth: access token expired")
	ErrTokenInvalid = errors.New("auth: access token invalid")
)

// AccessClaims is what an access token carries: {sub, sid, iat, exp, iss}.
type AccessClaims struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	ExpiresAt time.Time
}

type jwtClaims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

// Tokens signs and checks HS256 access tokens.
type Tokens struct {
	secret []byte
	ttl    time.Duration
}

// NewTokens returns a signer. ttl defaults to 15 minutes.
func NewTokens(secret []byte, ttl time.Duration) *Tokens {
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	return &Tokens{secret: secret, ttl: ttl}
}

// Issue signs an access token for a session.
func (t *Tokens) Issue(userID, sessionID uuid.UUID, now time.Time) (string, time.Time, error) {
	if len(t.secret) == 0 {
		return "", time.Time{}, errors.New("auth: no JWT secret configured")
	}
	now = now.Truncate(time.Second)
	exp := now.Add(t.ttl)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtClaims{
		SessionID: sessionID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			Issuer:    Issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	})
	s, err := tok.SignedString(t.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: sign access token: %w", err)
	}
	return s, exp, nil
}

// Parse checks an access token's signature (HS256 only), issuer and expiry at now.
func (t *Tokens) Parse(token string, now time.Time) (AccessClaims, error) {
	if len(t.secret) == 0 || token == "" {
		return AccessClaims{}, ErrTokenInvalid
	}
	var c jwtClaims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(Issuer),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return AccessClaims{}, ErrTokenExpired
		}
		return AccessClaims{}, ErrTokenInvalid
	}
	uid, err1 := uuid.Parse(c.Subject)
	sid, err2 := uuid.Parse(c.SessionID)
	if err1 != nil || err2 != nil || c.ExpiresAt == nil {
		return AccessClaims{}, ErrTokenInvalid
	}
	return AccessClaims{UserID: uid, SessionID: sid, ExpiresAt: c.ExpiresAt.Time}, nil
}

// NewOpaqueToken returns 32 random bytes as unpadded base64url (sent to the client)
// and the SHA-256 of that string (stored). Used for refresh and email-link tokens.
func NewOpaqueToken() (raw string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, fmt.Errorf("auth: read random token: %w", err)
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, HashToken(raw), nil
}

// HashToken is the SHA-256 of a raw opaque token, as stored in the database.
func HashToken(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}
