package auth

import (
	"net/mail"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/andreipana03/budget-tracker/backend/internal/apierr"
)

// Password limits (plan: 8–128 characters, upper, lower, digit, symbol).
const (
	PasswordMinLen = 8
	PasswordMaxLen = 128
	EmailMaxLen    = 254
)

// CheckPassword applies the password policy. field is the request field the errors
// point at ("password" or "newPassword"). username and email may be empty.
// It returns nil when the password is acceptable.
func CheckPassword(field, password, username, email string) []apierr.FieldError {
	var errs []apierr.FieldError
	add := func(code, msg string) { errs = append(errs, apierr.Field(field, code, msg)) }

	n := utf8.RuneCountInString(password)
	switch {
	case n < PasswordMinLen:
		add("too_short", "Use at least 8 characters.")
	case n > PasswordMaxLen:
		add("too_long", "Use at most 128 characters.")
	}
	var upper, lower, digit, symbol bool
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsLower(r):
			lower = true
		case unicode.IsDigit(r):
			digit = true
		case unicode.IsSpace(r):
			// Spaces are allowed but don't count as a symbol.
		default:
			symbol = true
		}
	}
	if !upper {
		add("missing_uppercase", "Add an uppercase letter.")
	}
	if !lower {
		add("missing_lowercase", "Add a lowercase letter.")
	}
	if !digit {
		add("missing_digit", "Add a number.")
	}
	if !symbol {
		add("missing_symbol", "Add a symbol, like ! or #.")
	}

	lp := strings.ToLower(strings.TrimSpace(password))
	same := false
	if u := NormalizeUsername(username); u != "" && lp == u {
		same = true
	}
	if e := NormalizeEmail(email); e != "" {
		local, _, _ := strings.Cut(e, "@")
		if lp == e || (local != "" && lp == local) {
			same = true
		}
	}
	if same {
		add("same_as_username", "Pick something different from your username and email.")
	}
	return errs
}

// NormalizeEmail lowercases and trims an email address, as it is stored.
func NormalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// ValidEmail reports whether a normalized email looks like an address we can send to.
func ValidEmail(email string) bool {
	if email == "" || len(email) > EmailMaxLen || strings.ContainsAny(email, " \t\r\n<>,;\"") {
		return false
	}
	local, domain, ok := strings.Cut(email, "@")
	if !ok || local == "" || domain == "" || strings.Contains(domain, "@") ||
		!strings.Contains(domain, ".") || strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return false
	}
	a, err := mail.ParseAddress(email)
	return err == nil && a.Address == email
}

// NormalizeUsername lowercases and trims a username, as it is stored.
func NormalizeUsername(username string) string { return strings.ToLower(strings.TrimSpace(username)) }

var usernamePattern = regexp.MustCompile(`^[a-z0-9._-]{3,30}$`)

// reservedUsernames can't be taken by anyone: they'd look official or clash with routes.
var reservedUsernames = map[string]bool{
	"admin": true, "administrator": true, "root": true, "support": true, "help": true,
	"api": true, "www": true, "mail": true, "email": true, "system": true, "me": true,
	"settings": true, "null": true, "undefined": true, "budget-tracker": true,
	"budgettracker": true, "budget": true, "official": true, "staff": true, "team": true,
	"security": true, "billing": true, "info": true, "contact": true, "noreply": true,
	"no-reply": true, "postmaster": true, "webmaster": true, "hostmaster": true,
	"abuse": true, "account": true, "accounts": true, "login": true, "logout": true,
	"signin": true, "signup": true, "register": true, "auth": true, "user": true,
	"users": true, "anonymous": true, "moderator": true, "owner": true, "status": true,
}

// Username problems, also used as UsernameAvailability reasons.
const (
	UsernameInvalid  = "invalid"
	UsernameReserved = "reserved"
)

// CheckUsername returns "" for a usable normalized username, else UsernameInvalid
// or UsernameReserved. It doesn't check whether the name is taken.
func CheckUsername(username string) string {
	if !usernamePattern.MatchString(username) {
		return UsernameInvalid
	}
	if reservedUsernames[username] {
		return UsernameReserved
	}
	return ""
}

// UsernameFieldError turns a CheckUsername problem into a field error ("" → nil).
func UsernameFieldError(field, problem string) *apierr.FieldError {
	switch problem {
	case UsernameInvalid:
		fe := apierr.Field(field, "invalid_format", "Use 3–30 letters, numbers, dots, dashes or underscores.")
		return &fe
	case UsernameReserved:
		fe := apierr.Field(field, "reserved", "This username isn’t available. Try another one.")
		return &fe
	}
	return nil
}
