// Package auth holds the building blocks of sign-in: password hashing and policy,
// username and email rules, access and refresh tokens, device names and the Google
// ID-token verifier. The HTTP handlers in package api put them together.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters for new hashes (DB doc § 4: m = 64 MiB, t = 3, p = 2).
const (
	argonMemoryKiB = 64 * 1024
	argonTime      = 3
	argonThreads   = 2
	argonSaltLen   = 16
	argonKeyLen    = 32
)

// ErrInvalidHash means a stored hash isn't an argon2id PHC string we can read.
var ErrInvalidHash = errors.New("auth: invalid argon2id hash")

// HashPassword returns an argon2id PHC string:
// $argon2id$v=19$m=65536,t=3,p=2$<salt>$<key> (unpadded standard base64).
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: read salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword reports whether password matches the PHC hash, whatever parameters
// the hash was made with. The comparison is constant-time.
func VerifyPassword(password, hash string) (bool, error) {
	p, err := parsePHC(hash)
	if err != nil {
		return false, err
	}
	key := argon2.IDKey([]byte(password), p.salt, p.time, p.memory, p.threads, uint32(len(p.key)))
	return subtle.ConstantTimeCompare(key, p.key) == 1, nil
}

type phc struct {
	memory  uint32
	time    uint32
	threads uint8
	salt    []byte
	key     []byte
}

func parsePHC(hash string) (phc, error) {
	// "", "argon2id", "v=19", "m=…,t=…,p=…", salt, key
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return phc{}, ErrInvalidHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return phc{}, ErrInvalidHash
	}
	var p phc
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return phc{}, ErrInvalidHash
	}
	// Refuse absurd parameters instead of allocating gigabytes for a corrupted row.
	if p.memory < 8 || p.memory > 1024*1024 || p.time < 1 || p.time > 20 || p.threads < 1 {
		return phc{}, ErrInvalidHash
	}
	var err error
	if p.salt, err = decodeB64(parts[4]); err != nil || len(p.salt) < 8 {
		return phc{}, ErrInvalidHash
	}
	if p.key, err = decodeB64(parts[5]); err != nil || len(p.key) < 16 || len(p.key) > 128 {
		return phc{}, ErrInvalidHash
	}
	return p, nil
}

// decodeB64 accepts unpadded standard base64 (the PHC format), and padded for leniency.
func decodeB64(s string) ([]byte, error) {
	return base64.RawStdEncoding.DecodeString(strings.TrimRight(s, "="))
}

var (
	dummyOnce sync.Once
	dummyHash string
)

// DummyVerify spends the same time as VerifyPassword against a real hash. Call it when
// there is no user (or no password) so response times don't reveal which accounts exist.
func DummyVerify(password string) {
	dummyOnce.Do(func() {
		h, err := HashPassword("dummy-password-for-timing")
		if err != nil {
			panic(err)
		}
		dummyHash = h
	})
	_, _ = VerifyPassword(password, dummyHash)
}
