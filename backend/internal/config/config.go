// Package config loads application settings from environment variables.
// Local defaults live in the root Makefile; override them in backend/.env.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// DevJWTSecret is the Makefile's local default. It is refused in production.
const DevJWTSecret = "dev-only-insecure-jwt-secret-change-me-0123456789"

// Config holds the settings the API needs to start.
type Config struct {
	// Env is "development", "test" or "production".
	Env                string
	DatabaseURL        string
	Port               string
	CORSAllowedOrigins []string

	// AppBaseURL is where the web app runs; email links point there.
	AppBaseURL string

	// JWTSecret signs access tokens (HS256). At least 32 bytes.
	JWTSecret      []byte
	AccessTokenTTL time.Duration
	// SessionTTL is how long a device stays signed in without being used.
	SessionTTL time.Duration
	// CookieSecure marks the refresh cookie Secure. Off locally: Safari drops Secure
	// cookies on http://localhost.
	CookieSecure bool
	CookieName   string

	// GoogleClientIDs are the OAuth client ids whose ID tokens we accept (web, iOS).
	// Empty disables Google sign-in.
	GoogleClientIDs []string

	// MailDriver is "smtp" (Mailpit locally) or "log" (print emails to the log).
	MailDriver   string
	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	MailFrom     string

	// JobsEnabled runs the BNR exchange-rate, subscription and cleanup jobs in-process.
	JobsEnabled bool
	// BNRBaseURL is where BNR publishes its XML files (https://curs.bnr.ro); tests point it at a fake server.
	BNRBaseURL string

	// TrustProxy reads the client IP from X-Forwarded-For (only behind a proxy you control).
	TrustProxy       bool
	RateLimitEnabled bool
}

// IsProduction reports whether the API runs in production.
func (c Config) IsProduction() bool { return c.Env == "production" }

// Load reads the configuration from the environment.
func Load() (Config, error) {
	cfg := Config{
		Env:                getenv("APP_ENV", "development"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		Port:               getenv("PORT", "8080"),
		CORSAllowedOrigins: list(os.Getenv("CORS_ALLOWED_ORIGINS")),
		AppBaseURL:         strings.TrimRight(getenv("APP_BASE_URL", "http://localhost:5173"), "/"),
		JWTSecret:          []byte(os.Getenv("JWT_SECRET")),
		CookieName:         getenv("COOKIE_NAME", "bt_refresh"),
		GoogleClientIDs:    list(os.Getenv("GOOGLE_CLIENT_IDS")),
		MailDriver:         getenv("MAIL_DRIVER", "smtp"),
		SMTPHost:           getenv("SMTP_HOST", "localhost"),
		SMTPUsername:       os.Getenv("SMTP_USERNAME"),
		SMTPPassword:       os.Getenv("SMTP_PASSWORD"),
		MailFrom:           getenv("MAIL_FROM", "Budget Tracker <no-reply@budget-tracker.test>"),
		BNRBaseURL:         strings.TrimRight(getenv("BNR_BASE_URL", "https://curs.bnr.ro"), "/"),
	}

	var errs []error
	var err error
	if cfg.AccessTokenTTL, err = duration("ACCESS_TOKEN_TTL", 15*time.Minute); err != nil {
		errs = append(errs, err)
	}
	if cfg.SessionTTL, err = duration("SESSION_TTL", 90*24*time.Hour); err != nil {
		errs = append(errs, err)
	}
	if cfg.SMTPPort, err = integer("SMTP_PORT", 1025); err != nil {
		errs = append(errs, err)
	}
	if cfg.CookieSecure, err = boolean("COOKIE_SECURE", cfg.Env == "production"); err != nil {
		errs = append(errs, err)
	}
	if cfg.JobsEnabled, err = boolean("JOBS_ENABLED", true); err != nil {
		errs = append(errs, err)
	}
	if cfg.TrustProxy, err = boolean("TRUST_PROXY", false); err != nil {
		errs = append(errs, err)
	}
	if cfg.RateLimitEnabled, err = boolean("RATE_LIMIT_ENABLED", true); err != nil {
		errs = append(errs, err)
	}

	if cfg.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	switch {
	case len(cfg.JWTSecret) < 32:
		errs = append(errs, errors.New("JWT_SECRET must be at least 32 bytes"))
	case cfg.IsProduction() && string(cfg.JWTSecret) == DevJWTSecret:
		errs = append(errs, errors.New("JWT_SECRET must not be the development default in production"))
	}
	if cfg.MailDriver != "smtp" && cfg.MailDriver != "log" {
		errs = append(errs, fmt.Errorf("MAIL_DRIVER must be smtp or log, got %q", cfg.MailDriver))
	}
	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func list(value string) []string {
	var out []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func duration(key string, fallback time.Duration) (time.Duration, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
}

func integer(key string, fallback int) (int, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func boolean(key string, fallback bool) (bool, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: %w", key, err)
	}
	return b, nil
}
