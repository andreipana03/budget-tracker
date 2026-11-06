package api

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/andreipana03/budget-tracker/backend/internal/api/gen"
	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/mail"
	"github.com/andreipana03/budget-tracker/backend/internal/ratelimit"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

var meRegionPattern = regexp.MustCompile(`^[A-Z]{2}$`)

// meLoadUser reads the signed-in user (401 if they no longer exist).
func (s *Server) meLoadUser(ctx context.Context, p Principal) (store.User, error) {
	user, err := s.q.AuthGetUser(ctx, p.UserID)
	if dbx.IsNoRows(err) {
		return store.User{}, apierr.Unauthorized("unauthorized", "Sign in to continue.")
	}
	if err != nil {
		return store.User{}, fmt.Errorf("load user: %w", err)
	}
	return user, nil
}

// GetMe returns the signed-in user.
func (s *Server) GetMe(ctx context.Context, _ gen.GetMeRequestObject) (gen.GetMeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	user, err := s.meLoadUser(ctx, p)
	if err != nil {
		return nil, err
	}
	body, err := s.authUserBody(ctx, s.q, user)
	if err != nil {
		return nil, err
	}
	return gen.GetMe200JSONResponse(body), nil
}

// UpdateMe changes the display name, username or formatting region.
func (s *Server) UpdateMe(ctx context.Context, request gen.UpdateMeRequestObject) (gen.UpdateMeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	b := request.Body
	if b == nil {
		return nil, errAuthNoBody
	}
	user, err := s.meLoadUser(ctx, p)
	if err != nil {
		return nil, err
	}

	params := store.AuthUpdateProfileParams{ID: user.ID}
	var fields []apierr.FieldError
	if b.DisplayName != nil {
		name := strings.TrimSpace(*b.DisplayName)
		params.SetDisplayName = true
		switch {
		case utf8.RuneCountInString(name) > 80:
			fields = append(fields, apierr.Field("displayName", "too_long", "Use at most 80 characters."))
		case name != "":
			params.DisplayName = &name
		}
	}
	if b.Username != nil {
		username := auth.NormalizeUsername(*b.Username)
		if fe := auth.UsernameFieldError("username", auth.CheckUsername(username)); fe != nil && username != user.Username {
			fields = append(fields, *fe)
		} else if username != user.Username {
			params.Username = &username
		}
	}
	if b.Region != nil {
		if !meRegionPattern.MatchString(*b.Region) {
			fields = append(fields, apierr.Field("region", "invalid_format", "Use a two-letter region code, like RO."))
		} else {
			params.Region = b.Region
		}
	}
	if len(fields) > 0 {
		return nil, apierr.Validation(fields...)
	}
	if params.Username != nil {
		taken, err := s.q.AuthUsernameExists(ctx, *params.Username)
		if err != nil {
			return nil, fmt.Errorf("check username: %w", err)
		}
		if taken {
			return nil, authTakenError(false, true)
		}
	}

	updated, err := s.q.AuthUpdateProfile(ctx, params)
	if err != nil {
		if authConstraint(err) == "users_username_key" {
			return nil, authTakenError(false, true).Wrap(err)
		}
		return nil, err
	}
	body, err := s.authUserBody(ctx, s.q, updated)
	if err != nil {
		return nil, err
	}
	return gen.UpdateMe200JSONResponse(body), nil
}

// DeleteMe deletes the user. Cascades remove their sessions, identities and tokens, and
// a household left without members goes with all of its data.
func (s *Server) DeleteMe(ctx context.Context, _ gen.DeleteMeRequestObject) (gen.DeleteMeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.q.AuthDeleteUser(ctx, p.UserID); err != nil {
		return nil, fmt.Errorf("delete user: %w", err)
	}
	s.authClearRefreshCookie(ctx)
	return gen.DeleteMe204Response{}, nil
}

// ChangePassword changes the password (or sets one for a Google-only account) and signs
// out every other session.
func (s *Server) ChangePassword(ctx context.Context, request gen.ChangePasswordRequestObject) (gen.ChangePasswordResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	b := request.Body
	if b == nil {
		return nil, errAuthNoBody
	}
	if err := s.authLimit(ratelimit.Check{Key: "password:user:" + p.UserID.String(), Rule: authRulePasswordUser}); err != nil {
		return nil, err
	}
	user, err := s.meLoadUser(ctx, p)
	if err != nil {
		return nil, err
	}
	if user.PasswordHash != nil {
		if b.CurrentPassword == nil || *b.CurrentPassword == "" {
			return nil, apierr.Validation(apierr.Field("currentPassword", "required", "Enter your current password."))
		}
		ok, err := auth.VerifyPassword(*b.CurrentPassword, *user.PasswordHash)
		if err != nil {
			s.logger.ErrorContext(ctx, "stored password hash is unreadable", "user_id", user.ID, "error", err)
		}
		if !ok {
			return nil, apierr.Unauthorized("invalid_credentials", "Your current password isn’t right.")
		}
	}
	if fields := auth.CheckPassword("newPassword", b.NewPassword, user.Username, user.Email); len(fields) > 0 {
		return nil, apierr.Validation(fields...)
	}
	hash, err := auth.HashPassword(b.NewPassword)
	if err != nil {
		return nil, err
	}
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.clock.Now()
		if err := q.AuthSetPassword(ctx, store.AuthSetPasswordParams{PasswordHash: hash, Now: now, ID: user.ID}); err != nil {
			return err
		}
		return q.AuthRevokeOtherUserSessions(ctx, store.AuthRevokeOtherUserSessionsParams{Now: now, UserID: user.ID, KeepSessionID: p.SessionID})
	})
	if err != nil {
		return nil, err
	}
	return gen.ChangePassword204Response{}, nil
}

// ResendVerification sends the email verification link again.
func (s *Server) ResendVerification(ctx context.Context, _ gen.ResendVerificationRequestObject) (gen.ResendVerificationResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	user, err := s.meLoadUser(ctx, p)
	if err != nil {
		return nil, err
	}
	if user.EmailVerifiedAt != nil {
		return nil, apierr.Conflict("already_verified", "Your email address is already confirmed.")
	}
	if err := s.authLimit(ratelimit.Check{Key: "resend:user:" + user.ID.String(), Rule: authRuleResendUser}); err != nil {
		return nil, err
	}
	token, err := s.authNewEmailToken(ctx, s.q, user, store.VerificationPurposeEmailVerification, authVerifyEmailTTL)
	if err != nil {
		return nil, err
	}
	s.authSendMail(ctx, mail.VerifyEmail(user.Email, s.authLink("/verify-email", token)))
	return gen.ResendVerification204Response{}, nil
}
