//go:build tools

// Package deps pins the libraries v1 builds on, so `go mod tidy` keeps them and go.sum
// stays complete while the packages that import them are being written. Remove an
// entry once real code imports it.
package deps

import (
	_ "github.com/coreos/go-oidc/v3/oidc"
	_ "github.com/golang-jwt/jwt/v5"
	_ "github.com/google/uuid"
	_ "github.com/oapi-codegen/runtime"
	_ "golang.org/x/crypto/argon2"
	_ "golang.org/x/time/rate"
)
