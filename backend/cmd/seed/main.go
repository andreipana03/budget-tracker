// Command seed creates the admin-test account with demo data ending today.
// Run it with `make db-seed` (after `make migrate`). Never in production.
package main

import (
	"log/slog"
	"os"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	logger.Warn("the admin-test seed is not implemented yet")
}
