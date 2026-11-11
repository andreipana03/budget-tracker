package auth

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/coreos/go-oidc/v3/oidc"
)

// GoogleJWKSURL is where Google publishes the keys that sign its ID tokens.
const GoogleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

// googleIssuers are the two spellings Google uses for `iss`.
var googleIssuers = []string{"accounts.google.com", "https://accounts.google.com"}

// ErrInvalidGoogleToken means the ID token isn't one we accept.
var ErrInvalidGoogleToken = errors.New("auth: invalid Google ID token")

// GoogleClaims is what we use from a verified Google ID token.
type GoogleClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

// GoogleVerifier checks a Google ID token. Tests use a fake.
type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (GoogleClaims, error)
}

// OIDCGoogleVerifier verifies ID tokens against Google's published keys and checks
// the audience against our client ids and the issuer against both Google spellings.
type OIDCGoogleVerifier struct {
	verifier  *oidc.IDTokenVerifier
	clientIDs []string
}

// NewGoogleVerifier builds a verifier. keysCtx must outlive the server: the key set
// uses it to fetch and refresh Google's keys.
func NewGoogleVerifier(keysCtx context.Context, clientIDs []string) *OIDCGoogleVerifier {
	keys := oidc.NewRemoteKeySet(keysCtx, GoogleJWKSURL)
	v := oidc.NewVerifier("https://accounts.google.com", keys, &oidc.Config{
		SkipClientIDCheck: true, // checked below against every configured client id
		SkipIssuerCheck:   true, // Google uses two issuer spellings; checked below
	})
	return &OIDCGoogleVerifier{verifier: v, clientIDs: slices.Clone(clientIDs)}
}

// Verify checks the signature, expiry, audience and issuer.
func (g *OIDCGoogleVerifier) Verify(ctx context.Context, idToken string) (GoogleClaims, error) {
	tok, err := g.verifier.Verify(ctx, idToken)
	if err != nil {
		return GoogleClaims{}, fmt.Errorf("%w: %v", ErrInvalidGoogleToken, err)
	}
	if !slices.Contains(googleIssuers, tok.Issuer) {
		return GoogleClaims{}, fmt.Errorf("%w: issuer %q", ErrInvalidGoogleToken, tok.Issuer)
	}
	audOK := false
	for _, aud := range tok.Audience {
		if slices.Contains(g.clientIDs, aud) {
			audOK = true
			break
		}
	}
	if !audOK {
		return GoogleClaims{}, fmt.Errorf("%w: audience %v", ErrInvalidGoogleToken, tok.Audience)
	}
	var c struct {
		Email         string `json:"email"`
		EmailVerified any    `json:"email_verified"` // bool, or "true" in some older tokens
		Name          string `json:"name"`
	}
	if err := tok.Claims(&c); err != nil {
		return GoogleClaims{}, fmt.Errorf("%w: claims: %v", ErrInvalidGoogleToken, err)
	}
	if tok.Subject == "" {
		return GoogleClaims{}, fmt.Errorf("%w: no subject", ErrInvalidGoogleToken)
	}
	verified := false
	switch v := c.EmailVerified.(type) {
	case bool:
		verified = v
	case string:
		verified = v == "true"
	}
	return GoogleClaims{Subject: tok.Subject, Email: c.Email, EmailVerified: verified, Name: c.Name}, nil
}
