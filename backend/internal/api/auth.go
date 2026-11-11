package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/mail"
	"github.com/andreipana03/budget-tracker/backend/internal/ratelimit"
	"github.com/andreipana03/budget-tracker/backend/internal/signup"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// Auth endpoints (DB doc § 4). Shared helpers are in auth_session.go.

var errAuthNoBody = apierr.BadRequest("bad_request", "The request body is missing.")

// Register creates the user, their household and Cash account, sends the verification
// email and signs in.
func (s *Server) Register(ctx context.Context, request gen.RegisterRequestObject) (gen.RegisterResponseObject, error) {
	b := request.Body
	if b == nil {
		return nil, errAuthNoBody
	}
	if err := s.authLimit(ratelimit.Check{Key: "register:ip:" + s.authIPKey(ctx), Rule: authRuleRegisterIP}); err != nil {
		return nil, err
	}
	client, err := s.authClientFrom(ctx, b.Platform, b.DeviceName)
	if err != nil {
		return nil, err
	}

	email := auth.NormalizeEmail(string(b.Email))
	username := auth.NormalizeUsername(b.Username)
	var fields []apierr.FieldError
	if !auth.ValidEmail(email) {
		fields = append(fields, authEmailFieldError("email"))
	}
	if fe := auth.UsernameFieldError("username", auth.CheckUsername(username)); fe != nil {
		fields = append(fields, *fe)
	}
	fields = append(fields, auth.CheckPassword("password", b.Password, username, email)...)
	if len(fields) > 0 {
		return nil, apierr.Validation(fields...)
	}

	emailTaken, err := s.q.AuthEmailExists(ctx, email)
	if err != nil {
		return nil, fmt.Errorf("check email: %w", err)
	}
	usernameTaken, err := s.q.AuthUsernameExists(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("check username: %w", err)
	}
	if emailTaken || usernameTaken {
		return nil, authTakenError(emailTaken, usernameTaken)
	}

	hash, err := auth.HashPassword(b.Password)
	if err != nil {
		return nil, err
	}
	var (
		user        store.User
		issued      authIssued
		verifyToken string
	)
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.clock.Now()
		res, err := signup.Create(ctx, tx, signup.Params{Email: email, Username: &username, PasswordHash: &hash, Now: now})
		if err != nil {
			return err
		}
		user = res.User
		if err := q.AuthSetLastSignIn(ctx, store.AuthSetLastSignInParams{Now: now, ID: user.ID}); err != nil {
			return err
		}
		if issued, err = s.authStartSession(ctx, q, user.ID, client, store.AuthMethodPassword); err != nil {
			return err
		}
		verifyToken, err = s.authNewEmailToken(ctx, q, user, store.VerificationPurposeEmailVerification, authVerifyEmailTTL)
		return err
	})
	if err != nil {
		switch authConstraint(err) {
		case "users_email_key":
			return nil, authTakenError(true, false).Wrap(err)
		case "users_username_key":
			return nil, authTakenError(false, true).Wrap(err)
		}
		return nil, err
	}

	resp, err := s.authResponse(ctx, s.q, user, client.platform, issued, true)
	if err != nil {
		return nil, err
	}
	s.authSendMail(ctx, mail.VerifyEmail(user.Email, s.authLink("/verify-email", verifyToken)))
	return gen.Register201JSONResponse(resp), nil
}

// Login signs in with an email or username and a password.
func (s *Server) Login(ctx context.Context, request gen.LoginRequestObject) (gen.LoginResponseObject, error) {
	b := request.Body
	if b == nil {
		return nil, errAuthNoBody
	}
	identifier := strings.ToLower(strings.TrimSpace(b.Identifier))
	if err := s.authLimit(
		ratelimit.Check{Key: "login:ip:" + s.authIPKey(ctx), Rule: authRuleLoginIP},
		ratelimit.Check{Key: "login:id:" + identifier, Rule: authRuleLoginID},
	); err != nil {
		return nil, err
	}
	client, err := s.authClientFrom(ctx, b.Platform, b.DeviceName)
	if err != nil {
		return nil, err
	}

	var user store.User
	if strings.Contains(identifier, "@") {
		user, err = s.q.AuthGetUserByEmail(ctx, identifier)
	} else {
		user, err = s.q.AuthGetUserByUsername(ctx, identifier)
	}
	if err != nil && !dbx.IsNoRows(err) {
		return nil, fmt.Errorf("find user: %w", err)
	}
	if err != nil || user.PasswordHash == nil {
		auth.DummyVerify(b.Password) // same time as a real check
		return nil, errAuthInvalidCreds
	}
	ok, err := auth.VerifyPassword(b.Password, *user.PasswordHash)
	if err != nil {
		s.logger.ErrorContext(ctx, "stored password hash is unreadable", "user_id", user.ID, "error", err)
	}
	if !ok {
		return nil, errAuthInvalidCreds
	}

	var issued authIssued
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := q.AuthSetLastSignIn(ctx, store.AuthSetLastSignInParams{Now: s.clock.Now(), ID: user.ID}); err != nil {
			return err
		}
		issued, err = s.authStartSession(ctx, q, user.ID, client, store.AuthMethodPassword)
		return err
	})
	if err != nil {
		return nil, err
	}
	resp, err := s.authResponse(ctx, s.q, user, client.platform, issued, false)
	if err != nil {
		return nil, err
	}
	return gen.Login200JSONResponse(resp), nil
}

// SignInWithGoogle signs in or up with a Google ID token, linking accounts per DB doc § 4.
func (s *Server) SignInWithGoogle(ctx context.Context, request gen.SignInWithGoogleRequestObject) (gen.SignInWithGoogleResponseObject, error) {
	b := request.Body
	if b == nil {
		return nil, errAuthNoBody
	}
	if s.google == nil || len(s.cfg.GoogleClientIDs) == 0 {
		return nil, apierr.ServiceUnavailable("google_not_configured", "Google sign-in isn’t set up on this server.")
	}
	if err := s.authLimit(ratelimit.Check{Key: "google:ip:" + s.authIPKey(ctx), Rule: authRuleGoogleIP}); err != nil {
		return nil, err
	}
	client, err := s.authClientFrom(ctx, b.Platform, b.DeviceName)
	if err != nil {
		return nil, err
	}
	claims, err := s.google.Verify(ctx, b.IdToken)
	if err != nil {
		return nil, authInvalidGoogleToken().Wrap(err)
	}

	var res authGoogleResult
	run := func() error {
		return dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
			var err error
			res, err = s.authGoogleTx(ctx, tx, claims, client)
			return err
		})
	}
	err = run()
	if authConstraint(err) == "users_username_key" {
		err = run() // two sign-ups derived the same username at once; the retry picks the next one
	}
	if err != nil {
		return nil, err
	}
	resp, err := s.authResponse(ctx, s.q, res.user, client.platform, res.issued, res.isNew)
	if err != nil {
		return nil, err
	}
	return gen.SignInWithGoogle200JSONResponse(resp), nil
}

type authGoogleResult struct {
	user   store.User
	isNew  bool
	issued authIssued
}

func authInvalidGoogleToken() *apierr.Error {
	return apierr.Unauthorized("invalid_google_token", "We couldn’t confirm your Google sign-in. Try again.")
}

func (s *Server) authGoogleTx(ctx context.Context, tx pgx.Tx, claims auth.GoogleClaims, client authClient) (authGoogleResult, error) {
	q := store.New(tx)
	now := s.clock.Now()
	email := auth.NormalizeEmail(claims.Email)
	var emailPtr *string
	if email != "" {
		emailPtr = &email
	}
	var res authGoogleResult

	ident, err := q.AuthGetIdentity(ctx, store.AuthGetIdentityParams{Provider: store.AuthProviderGoogle, Subject: claims.Subject})
	switch {
	case err == nil:
		// Known Google account → that user.
		if res.user, err = q.AuthGetUser(ctx, ident.UserID); err != nil {
			return res, fmt.Errorf("load linked user: %w", err)
		}
		if err := q.AuthTouchIdentity(ctx, store.AuthTouchIdentityParams{Email: emailPtr, EmailVerified: claims.EmailVerified, Now: now, ID: ident.ID}); err != nil {
			return res, err
		}

	case dbx.IsNoRows(err):
		if !auth.ValidEmail(email) {
			return res, authInvalidGoogleToken().Wrap(errors.New("google token has no usable email"))
		}
		existing, err := q.AuthGetUserByEmailForUpdate(ctx, email)
		switch {
		case err == nil:
			if !claims.EmailVerified {
				return res, apierr.Conflict("email_taken", "An account with this email already exists. Sign in with your password instead.")
			}
			if _, err := q.AuthGetUserIdentityByProvider(ctx, store.AuthGetUserIdentityByProviderParams{UserID: existing.ID, Provider: store.AuthProviderGoogle}); err == nil {
				return res, apierr.Conflict("identity_conflict", "This account is already linked to a different Google account.")
			} else if !dbx.IsNoRows(err) {
				return res, err
			}
			if existing.EmailVerifiedAt == nil {
				// Someone may have registered this address without owning it: their
				// password must not survive the merge, nor their sessions.
				if err := q.AuthMergeUnverifiedUser(ctx, store.AuthMergeUnverifiedUserParams{Now: now, ID: existing.ID}); err != nil {
					return res, err
				}
				if err := q.AuthRevokeUserSessions(ctx, store.AuthRevokeUserSessionsParams{Now: now, UserID: existing.ID}); err != nil {
					return res, err
				}
			}
			if err := q.AuthInsertIdentity(ctx, store.AuthInsertIdentityParams{
				UserID: existing.ID, Provider: store.AuthProviderGoogle, Subject: claims.Subject,
				Email: emailPtr, EmailVerified: true, Now: now,
			}); err != nil {
				return res, err
			}
			if res.user, err = q.AuthGetUser(ctx, existing.ID); err != nil {
				return res, err
			}

		case dbx.IsNoRows(err):
			// DB doc § 4: a new account from Google only for an address Google has
			// verified. Otherwise anyone could claim someone else's email and keep a
			// linked identity even after the real owner resets the password.
			if !claims.EmailVerified {
				return res, apierr.Unauthorized("google_email_unverified",
					"Your Google account's email address isn't verified yet. Verify it with Google, or create an account with your email instead.")
			}
			var name *string
			if n := strings.TrimSpace(claims.Name); n != "" {
				name = ptr(authTruncate(n, 80))
			}
			created, err := signup.Create(ctx, tx, signup.Params{
				Email: email, DisplayName: name, EmailVerified: true, Now: now,
			})
			if err != nil {
				return res, err
			}
			if err := q.AuthInsertIdentity(ctx, store.AuthInsertIdentityParams{
				UserID: created.UserID, Provider: store.AuthProviderGoogle, Subject: claims.Subject,
				Email: emailPtr, EmailVerified: true, Now: now,
			}); err != nil {
				return res, err
			}
			res.user = created.User
			res.isNew = true

		default:
			return res, fmt.Errorf("find user by email: %w", err)
		}

	default:
		return res, fmt.Errorf("find identity: %w", err)
	}

	if err := q.AuthSetLastSignIn(ctx, store.AuthSetLastSignInParams{Now: now, ID: res.user.ID}); err != nil {
		return res, err
	}
	res.issued, err = s.authStartSession(ctx, q, res.user.ID, client, store.AuthMethodGoogle)
	return res, err
}

type authRefreshOutcome int

const (
	authRefreshInvalid authRefreshOutcome = iota
	authRefreshRotated
	authRefreshGraceOK
	authRefreshReused
)

// RefreshSession rotates the refresh token and issues a new access token (DB doc § 4).
func (s *Server) RefreshSession(ctx context.Context, request gen.RefreshSessionRequestObject) (gen.RefreshSessionResponseObject, error) {
	b := request.Body
	if b == nil {
		return nil, errAuthNoBody
	}
	platform, err := authPlatform(b.Platform)
	if err != nil {
		return nil, err
	}
	fromBody := b.RefreshToken != nil && strings.TrimSpace(*b.RefreshToken) != ""
	fail := func() error {
		if platform == store.ClientPlatformWeb || !fromBody {
			s.authClearRefreshCookie(ctx)
		}
		return errAuthSessionExpired
	}
	raw := s.authPresentedRefreshToken(ctx, b.RefreshToken)
	if raw == "" {
		return nil, fail()
	}
	hash := auth.HashToken(raw)
	now := s.clock.Now()

	var (
		outcome authRefreshOutcome
		sess    store.Session
		newRaw  string
	)
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		var err error
		sess, err = q.AuthLockSessionByToken(ctx, hash)
		if dbx.IsNoRows(err) {
			outcome = authRefreshInvalid
			return nil
		}
		if err != nil {
			return err
		}
		if sess.RevokedAt != nil || !sess.ExpiresAt.After(now) {
			outcome = authRefreshInvalid
			return nil
		}
		if bytes.Equal(sess.RefreshTokenHash, hash) {
			var newHash []byte
			if newRaw, newHash, err = auth.NewOpaqueToken(); err != nil {
				return err
			}
			outcome = authRefreshRotated
			return q.AuthRotateSession(ctx, store.AuthRotateSessionParams{
				NewHash: newHash, Now: now, ExpiresAt: now.Add(s.authSessionTTL()), ID: sess.ID,
			})
		}
		// The token before the last rotation.
		if now.Sub(sess.RotatedAt) < authRefreshGrace {
			outcome = authRefreshGraceOK
			return q.AuthTouchSession(ctx, store.AuthTouchSessionParams{Now: now, ID: sess.ID})
		}
		outcome = authRefreshReused
		return q.AuthRevokeSession(ctx, store.AuthRevokeSessionParams{Now: now, ID: sess.ID})
	})
	if err != nil {
		return nil, err
	}
	switch outcome {
	case authRefreshInvalid:
		return nil, fail()
	case authRefreshReused:
		s.logger.WarnContext(ctx, "refresh token reused after rotation; session revoked", "session_id", sess.ID, "user_id", sess.UserID)
		return nil, fail()
	}

	user, err := s.q.AuthGetUser(ctx, sess.UserID)
	if err != nil {
		if dbx.IsNoRows(err) {
			return nil, fail()
		}
		return nil, err
	}
	access, exp, err := s.tokens.Issue(user.ID, sess.ID, now)
	if err != nil {
		return nil, err
	}
	// Where the new refresh token goes follows the SESSION's platform, never the request:
	// a web session's token stays in the HttpOnly cookie even if a script asks for
	// platform "ios" (which would hand it the raw token in the JSON body).
	// In the grace window newRaw is "": an access token only, and the cookie is left
	// alone so a late response can't overwrite the rotated one.
	resp, err := s.authResponse(ctx, s.q, user, sess.Platform, authIssued{sessionID: sess.ID, access: access, accessExp: exp, refresh: newRaw}, false)
	if err != nil {
		return nil, err
	}
	return gen.RefreshSession200JSONResponse(resp), nil
}

// SignOut revokes the presented refresh token's session and clears the cookie.
func (s *Server) SignOut(ctx context.Context, request gen.SignOutRequestObject) (gen.SignOutResponseObject, error) {
	var bodyToken *string
	if request.Body != nil {
		bodyToken = request.Body.RefreshToken
	}
	if raw := s.authPresentedRefreshToken(ctx, bodyToken); raw != "" && s.q != nil {
		if err := s.q.AuthRevokeSessionByToken(ctx, store.AuthRevokeSessionByTokenParams{Now: s.clock.Now(), TokenHash: auth.HashToken(raw)}); err != nil {
			s.logger.ErrorContext(ctx, "revoke session on sign-out failed", "error", err)
		}
	}
	s.authClearRefreshCookie(ctx)
	return gen.SignOut204Response{}, nil
}

// VerifyEmail confirms an address with the token from the verification link.
func (s *Server) VerifyEmail(ctx context.Context, request gen.VerifyEmailRequestObject) (gen.VerifyEmailResponseObject, error) {
	if err := s.authLimit(ratelimit.Check{Key: "token:ip:" + s.authIPKey(ctx), Rule: authRuleTokenIP}); err != nil {
		return nil, err
	}
	if request.Body == nil || strings.TrimSpace(request.Body.Token) == "" {
		return nil, errAuthInvalidToken
	}
	hash := auth.HashToken(strings.TrimSpace(request.Body.Token))
	err := dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.clock.Now()
		userID, err := q.AuthConsumeVerificationToken(ctx, store.AuthConsumeVerificationTokenParams{
			Now: now, TokenHash: hash, Purpose: store.VerificationPurposeEmailVerification,
		})
		if dbx.IsNoRows(err) {
			return errAuthInvalidToken
		}
		if err != nil {
			return err
		}
		return q.AuthMarkEmailVerified(ctx, store.AuthMarkEmailVerifiedParams{Now: now, ID: userID})
	})
	if err != nil {
		return nil, err
	}
	return gen.VerifyEmail204Response{}, nil
}

// RequestPasswordReset emails a reset link. The answer is the same whether or not the
// address has an account.
func (s *Server) RequestPasswordReset(ctx context.Context, request gen.RequestPasswordResetRequestObject) (gen.RequestPasswordResetResponseObject, error) {
	if request.Body == nil {
		return nil, errAuthNoBody
	}
	email := auth.NormalizeEmail(string(request.Body.Email))
	if err := s.authLimit(
		ratelimit.Check{Key: "forgot:ip:" + s.authIPKey(ctx), Rule: authRuleForgotIP},
		ratelimit.Check{Key: "forgot:email:" + email, Rule: authRuleForgotEmail},
	); err != nil {
		return nil, err
	}
	if !auth.ValidEmail(email) {
		return nil, apierr.Validation(authEmailFieldError("email"))
	}
	user, err := s.q.AuthGetUserByEmail(ctx, email)
	if dbx.IsNoRows(err) {
		return gen.RequestPasswordReset204Response{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	token, err := s.authNewEmailToken(ctx, s.q, user, store.VerificationPurposePasswordReset, authResetPasswordTTL)
	if err != nil {
		return nil, err
	}
	s.authSendMail(ctx, mail.ResetPassword(user.Email, s.authLink("/reset-password", token)))
	return gen.RequestPasswordReset204Response{}, nil
}

// ResetPassword sets a new password with the token from the reset link and signs the
// user out everywhere.
func (s *Server) ResetPassword(ctx context.Context, request gen.ResetPasswordRequestObject) (gen.ResetPasswordResponseObject, error) {
	if err := s.authLimit(ratelimit.Check{Key: "token:ip:" + s.authIPKey(ctx), Rule: authRuleTokenIP}); err != nil {
		return nil, err
	}
	b := request.Body
	if b == nil {
		return nil, errAuthNoBody
	}
	if strings.TrimSpace(b.Token) == "" {
		return nil, errAuthInvalidToken
	}
	hash := auth.HashToken(strings.TrimSpace(b.Token))
	err := dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.clock.Now()
		userID, err := q.AuthConsumeVerificationToken(ctx, store.AuthConsumeVerificationTokenParams{
			Now: now, TokenHash: hash, Purpose: store.VerificationPurposePasswordReset,
		})
		if dbx.IsNoRows(err) {
			return errAuthInvalidToken
		}
		if err != nil {
			return err
		}
		user, err := q.AuthGetUserForUpdate(ctx, userID)
		if err != nil {
			return err
		}
		// A weak password rolls back, so the link can be used again.
		if fields := auth.CheckPassword("password", b.Password, user.Username, user.Email); len(fields) > 0 {
			return apierr.Validation(fields...)
		}
		ph, err := auth.HashPassword(b.Password)
		if err != nil {
			return err
		}
		if err := q.AuthSetPassword(ctx, store.AuthSetPasswordParams{PasswordHash: ph, Now: now, ID: user.ID}); err != nil {
			return err
		}
		// The link reached the inbox, so the address is proven too.
		if err := q.AuthMarkEmailVerified(ctx, store.AuthMarkEmailVerifiedParams{Now: now, ID: user.ID}); err != nil {
			return err
		}
		return q.AuthRevokeUserSessions(ctx, store.AuthRevokeUserSessionsParams{Now: now, UserID: user.ID})
	})
	if err != nil {
		return nil, err
	}
	return gen.ResetPassword204Response{}, nil
}

// CheckUsername says whether a username is valid and free.
func (s *Server) CheckUsername(ctx context.Context, request gen.CheckUsernameRequestObject) (gen.CheckUsernameResponseObject, error) {
	username := auth.NormalizeUsername(request.Params.Username)
	resp := gen.CheckUsername200JSONResponse{Username: username}
	if problem := auth.CheckUsername(username); problem != "" {
		resp.Reason = ptr(gen.UsernameAvailabilityReason(problem))
		return resp, nil
	}
	taken, err := s.q.AuthUsernameExists(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("check username: %w", err)
	}
	if taken {
		resp.Reason = ptr(gen.UsernameAvailabilityReasonTaken)
		return resp, nil
	}
	resp.Available = true
	return resp, nil
}

// authTakenError is 409 email_taken / username_taken with a "taken" entry per field.
func authTakenError(emailTaken, usernameTaken bool) *apierr.Error {
	var fields []apierr.FieldError
	if emailTaken {
		fields = append(fields, apierr.Field("email", "taken", "An account with this email already exists."))
	}
	if usernameTaken {
		fields = append(fields, apierr.Field("username", "taken", "This username is taken. Try another one."))
	}
	e := apierr.Conflict("username_taken", "This username is taken. Try another one.")
	if emailTaken {
		e = apierr.Conflict("email_taken", "An account with this email already exists. Try signing in instead.")
	}
	e.Fields = fields
	return e
}

func authEmailFieldError(field string) apierr.FieldError {
	return apierr.Field(field, "invalid_format", "Enter an email address like name@example.com.")
}

// authConstraint returns the violated constraint's name, or "".
func authConstraint(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}
