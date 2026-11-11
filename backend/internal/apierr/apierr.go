// Package apierr is the one error type handlers return. The router turns it into the
// spec's Error body ({code, message, fields}) with the right HTTP status. Any other
// error becomes a logged 500 "internal".
package apierr

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// FieldError points at one request field. Field names are the camelCase JSON names.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error is an error a client can act on.
type Error struct {
	Status     int
	Code       string
	Message    string
	Fields     []FieldError
	RetryAfter time.Duration // sets Retry-After on 429
	Cause      error         // logged, never sent
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Cause)
	}
	return e.Code + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Cause }

// New makes an error with any status and code.
func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

// Wrap attaches the underlying cause (for logs).
func (e *Error) Wrap(cause error) *Error {
	c := *e
	c.Cause = cause
	return &c
}

// Field is shorthand for a FieldError.
func Field(field, code, message string) FieldError {
	return FieldError{Field: field, Code: code, Message: message}
}

// Validation is 422 validation_failed with one entry per bad field.
func Validation(fields ...FieldError) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: "validation_failed",
		Message: "Some fields need another look.", Fields: fields}
}

func BadRequest(code, message string) *Error { return New(http.StatusBadRequest, code, message) }

func Unauthorized(code, message string) *Error { return New(http.StatusUnauthorized, code, message) }

func Forbidden(message string) *Error { return New(http.StatusForbidden, "forbidden", message) }

// NotFound is 404 not_found. `what` is a noun for the message ("transaction").
func NotFound(what string) *Error {
	return New(http.StatusNotFound, "not_found", "This "+what+" doesn't exist or was deleted.")
}

func Conflict(code, message string) *Error { return New(http.StatusConflict, code, message) }

// VersionConflict answers a write whose rowVersion is stale.
func VersionConflict() *Error {
	return Conflict("version_conflict", "This was changed somewhere else. Refresh and try again.")
}

func Unprocessable(code, message string) *Error {
	return New(http.StatusUnprocessableEntity, code, message)
}

// FxRateUnavailable is the answer when no BNR rate exists for a conversion.
func FxRateUnavailable(from, to string) *Error {
	return Unprocessable("fx_rate_unavailable",
		fmt.Sprintf("There's no exchange rate from %s to %s for that day yet.", from, to))
}

func RateLimited(retryAfter time.Duration) *Error {
	return &Error{Status: http.StatusTooManyRequests, Code: "rate_limited",
		Message: "Too many attempts. Wait a moment and try again.", RetryAfter: retryAfter}
}

func ServiceUnavailable(code, message string) *Error {
	return New(http.StatusServiceUnavailable, code, message)
}

func NotImplemented() *Error {
	return New(http.StatusNotImplemented, "not_implemented", "This isn't available yet.")
}

// Internal hides the cause from the client and logs it.
func Internal(cause error) *Error {
	return &Error{Status: http.StatusInternalServerError, Code: "internal",
		Message: "Something went wrong on our side. Try again.", Cause: cause}
}

// constraintErrors maps database constraint names to client errors.
// Handlers can still check constraints themselves for friendlier field errors.
var constraintErrors = map[string]*Error{
	"users_email_key":                       Conflict("email_taken", "An account with this email already exists."),
	"users_username_key":                    Conflict("username_taken", "This username is taken."),
	"accounts_household_name_key":           Conflict("name_taken", "You already have an account with this name."),
	"categories_household_name_key":         Conflict("name_taken", "You already have a category with this name."),
	"budgets_category_scope_month_key":      Conflict("budget_exists", "This category already has a budget for that month."),
	"transactions_recurring_occurrence_key": Conflict("duplicate_occurrence", "This payment is already recorded."),
}

// FromDB turns known PostgreSQL errors into client errors. It returns nil when err is
// not a constraint violation it knows, so callers can fall back to Internal.
func FromDB(err error) *Error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return nil
	}
	if e, ok := constraintErrors[pgErr.ConstraintName]; ok {
		return e.Wrap(err)
	}
	switch pgErr.Code {
	case "23503": // foreign_key_violation
		return Unprocessable("invalid_reference", "That account, category or subscription doesn't exist here.").Wrap(err)
	case "23514", "22001": // check_violation, string_data_right_truncation
		return Validation(Field(constraintField(pgErr.ConstraintName), "invalid", "This value isn't allowed.")).Wrap(err)
	case "23505":
		return Conflict("already_exists", "This already exists.").Wrap(err)
	}
	return nil
}

// constraintField guesses the field from a "<table>_<column>_<what>" constraint name.
func constraintField(constraint string) string {
	parts := strings.Split(constraint, "_")
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

// As converts any error into an *Error: client errors pass through, known database
// errors are mapped, everything else is Internal.
func As(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	if e := FromDB(err); e != nil {
		return e
	}
	return Internal(err)
}

type body struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Fields  []FieldError `json:"fields,omitempty"`
}

// Write sends err as the spec's Error body. 5xx errors are logged with their cause.
func Write(w http.ResponseWriter, r *http.Request, logger *slog.Logger, err error) {
	e := As(err)
	if e.Status >= 500 && logger != nil {
		logger.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path,
			"code", e.Code, "error", err)
	}
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(e.RetryAfter.Round(time.Second).Seconds())))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(body{Code: e.Code, Message: e.Message, Fields: e.Fields})
}
