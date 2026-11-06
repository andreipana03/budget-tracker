// Command api runs the Budget Tracker HTTP server.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // household time zones work even without the OS zone database

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/api"
	"github.com/andreipana03/budget-tracker/backend/internal/auth"
	"github.com/andreipana03/budget-tracker/backend/internal/clock"
	"github.com/andreipana03/budget-tracker/backend/internal/config"
	"github.com/andreipana03/budget-tracker/backend/internal/mail"
)

const shutdownTimeout = 10 * time.Second

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// The pool connects lazily, so the API still starts and reports "degraded"
	// through /health when the database is down.
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("create database pool: %w", err)
	}
	defer pool.Close()

	deps := api.Deps{Pool: pool, Logger: logger, Clock: clock.Real{}, Config: cfg, Mailer: newMailer(cfg, logger)}
	if len(cfg.GoogleClientIDs) > 0 {
		// The key set fetches Google's signing keys with this context, so it lives as
		// long as the process (not the signal context, which ends at shutdown).
		deps.Google = auth.NewGoogleVerifier(context.Background(), cfg.GoogleClientIDs)
	} else {
		logger.Info("Google sign-in disabled: GOOGLE_CLIENT_IDS is empty")
	}
	server := api.NewServer(deps)
	httpServer := &http.Server{
		Addr: net.JoinHostPort("", cfg.Port),
		Handler: api.NewRouter(server, logger, api.RouterOptions{
			AllowedOrigins: cfg.CORSAllowedOrigins,
			Authenticator:  server.Authenticator(),
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("server listening", "port", cfg.Port)
		serveErr <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("shut down server: %w", err)
	}
	return nil
}

// newMailer picks the email sender for MAIL_DRIVER.
func newMailer(cfg config.Config, logger *slog.Logger) mail.Sender {
	if cfg.MailDriver == "log" {
		return mail.Log{Logger: logger}
	}
	return mail.SMTP{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword, From: cfg.MailFrom}
}
