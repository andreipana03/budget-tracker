package auth

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
)

// The demo user's hash in backend/db/seed/dev_seed.sql.
const demoHash = "$argon2id$v=19$m=65536,t=3,p=2$HGvjAyqjq8l+6HsY1sB3kg$bXEAhQ7w+ycWiaZI/U/S24vmfW/liSvQXWzjI0SwpCI"

func TestVerifyPasswordDemoVector(t *testing.T) {
	ok, err := VerifyPassword("budget-demo-2026", demoHash)
	if err != nil || !ok {
		t.Fatalf("demo password: ok=%v err=%v", ok, err)
	}
	if ok, _ := VerifyPassword("budget-demo-2025", demoHash); ok {
		t.Fatal("wrong password accepted")
	}
}

func TestHashPasswordRoundTrip(t *testing.T) {
	h, err := HashPassword("Correct-Horse-9")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Fatalf("hash = %q", h)
	}
	parts := strings.Split(h, "$")
	if len(parts[4]) != 22 || len(parts[5]) != 43 { // 16 and 32 bytes, unpadded base64
		t.Fatalf("salt/key lengths: %d %d", len(parts[4]), len(parts[5]))
	}
	if ok, err := VerifyPassword("Correct-Horse-9", h); !ok || err != nil {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if ok, _ := VerifyPassword("correct-horse-9", h); ok {
		t.Fatal("case-changed password accepted")
	}
	h2, _ := HashPassword("Correct-Horse-9")
	if h == h2 {
		t.Fatal("two hashes of the same password are equal: salt not random")
	}
}

func TestVerifyPasswordOtherParams(t *testing.T) {
	// A hash made with other parameters (and a 24-byte key) still verifies.
	salt := []byte("0123456789abcdef")
	key := argon2.IDKey([]byte("Other-Params-1"), salt, 2, 19456, 1, 24)
	h := fmt.Sprintf("$argon2id$v=19$m=19456,t=2,p=1$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
	if ok, err := VerifyPassword("Other-Params-1", h); !ok || err != nil {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if ok, _ := VerifyPassword("Other-Params-2", h); ok {
		t.Fatal("wrong password accepted")
	}
	for _, bad := range []string{"", "plain", "$argon2i$v=19$m=65536,t=3,p=2$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5",
		"$argon2id$v=18$m=65536,t=3,p=2$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5a2V5",
		"$argon2id$v=19$m=999999999,t=3,p=2$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5a2V5",
		"$argon2id$v=19$m=65536,t=3,p=2$!!!$a2V5a2V5a2V5a2V5a2V5a2V5"} {
		if _, err := VerifyPassword("x", bad); !errors.Is(err, ErrInvalidHash) {
			t.Errorf("VerifyPassword(%q) err = %v, want ErrInvalidHash", bad, err)
		}
	}
}

func TestDummyVerifyDoesNotPanic(t *testing.T) {
	DummyVerify("anything")
	DummyVerify("")
}

func TestCheckPassword(t *testing.T) {
	tests := []struct {
		pw, username, email string
		want                []string
	}{
		{"AdminTest@123", "admin-test", "admin-test@budget-tracker.test", nil},
		{"Ab1!", "", "", []string{"too_short"}},
		{strings.Repeat("Ab1!", 33), "", "", []string{"too_long"}},
		{"abcdefg1!", "", "", []string{"missing_uppercase"}},
		{"ABCDEFG1!", "", "", []string{"missing_lowercase"}},
		{"Abcdefgh!", "", "", []string{"missing_digit"}},
		{"Abcdefgh1", "", "", []string{"missing_symbol"}},
		{"Abcd fgh1", "", "", []string{"missing_symbol"}},
		{"abcdefgh", "", "", []string{"missing_uppercase", "missing_digit", "missing_symbol"}},
		{"Ana.Pop-2026", "ana.pop-2026", "", []string{"same_as_username"}},
		{"Ana.Pop-2026", "", "ANA.POP-2026@example.com", []string{"same_as_username"}},
		{"Ana@Pop.1x", "", "ana@pop.1x", []string{"same_as_username"}},
		{"Ana.Pop-2026", "ana", "ana@example.com", nil},
	}
	for _, tt := range tests {
		got := CheckPassword("password", tt.pw, tt.username, tt.email)
		var gotCodes []string
		for _, f := range got {
			if f.Field != "password" || f.Message == "" {
				t.Errorf("%q: bad field error %+v", tt.pw, f)
			}
			gotCodes = append(gotCodes, f.Code)
		}
		if strings.Join(gotCodes, ",") != strings.Join(tt.want, ",") {
			t.Errorf("CheckPassword(%q, %q, %q) = %v, want %v", tt.pw, tt.username, tt.email, gotCodes, tt.want)
		}
	}
	if fs := CheckPassword("newPassword", "x", "", ""); len(fs) == 0 || fs[0].Field != "newPassword" {
		t.Fatalf("field name not used: %+v", fs)
	}
}

func TestUsernameRules(t *testing.T) {
	if got := NormalizeUsername("  Ana.Pop  "); got != "ana.pop" {
		t.Fatalf("NormalizeUsername = %q", got)
	}
	tests := map[string]string{
		"ana": "", "admin-test": "", "a.b_c-1": "", strings.Repeat("a", 30): "",
		"ab": UsernameInvalid, strings.Repeat("a", 31): UsernameInvalid, "ana pop": UsernameInvalid,
		"Ana": UsernameInvalid, "ana+1": UsernameInvalid, "ăna": UsernameInvalid, "": UsernameInvalid,
		"admin": UsernameReserved, "root": UsernameReserved, "budget-tracker": UsernameReserved,
		"me":       UsernameInvalid, // too short beats reserved
		"settings": UsernameReserved, "undefined": UsernameReserved,
	}
	for in, want := range tests {
		if got := CheckUsername(in); got != want {
			t.Errorf("CheckUsername(%q) = %q, want %q", in, got, want)
		}
	}
	if UsernameFieldError("username", "") != nil {
		t.Fatal("no problem should give no field error")
	}
	if fe := UsernameFieldError("username", UsernameReserved); fe == nil || fe.Code != "reserved" {
		t.Fatalf("reserved field error = %+v", fe)
	}
}

func TestEmailRules(t *testing.T) {
	if got := NormalizeEmail("  Ana.Pop@Example.COM "); got != "ana.pop@example.com" {
		t.Fatalf("NormalizeEmail = %q", got)
	}
	good := []string{"ana@example.com", "ana.pop+x@sub.example.ro", "a@b.co"}
	bad := []string{"", "ana", "ana@", "@example.com", "ana@example", "ana pop@example.com", "Ana <ana@example.com>",
		"ana@@example.com", "ana@.com", "ana@example.com.", strings.Repeat("a", 250) + "@example.com"}
	for _, e := range good {
		if !ValidEmail(e) {
			t.Errorf("ValidEmail(%q) = false", e)
		}
	}
	for _, e := range bad {
		if ValidEmail(e) {
			t.Errorf("ValidEmail(%q) = true", e)
		}
	}
}

func TestAccessTokens(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	tk := NewTokens(secret, 15*time.Minute)
	uid, sid := uuid.New(), uuid.New()
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)

	tok, exp, err := tk.Issue(uid, sid, now)
	if err != nil {
		t.Fatal(err)
	}
	if !exp.Equal(now.Add(15 * time.Minute)) {
		t.Fatalf("exp = %v", exp)
	}
	c, err := tk.Parse(tok, now.Add(14*time.Minute))
	if err != nil || c.UserID != uid || c.SessionID != sid {
		t.Fatalf("parse: %+v %v", c, err)
	}
	if _, err := tk.Parse(tok, now.Add(16*time.Minute)); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("expired: err = %v", err)
	}
	if _, err := NewTokens([]byte("another-secret-another-secret-xx"), 0).Parse(tok, now); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("wrong secret: err = %v", err)
	}
	if _, err := tk.Parse("garbage", now); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("garbage: err = %v", err)
	}

	sign := func(method jwt.SigningMethod, key any, claims jwt.MapClaims) string {
		s, err := jwt.NewWithClaims(method, claims).SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	base := func() jwt.MapClaims {
		return jwt.MapClaims{"sub": uid.String(), "sid": sid.String(), "iss": Issuer,
			"iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
	}
	cases := map[string]string{
		"HS512":      sign(jwt.SigningMethodHS512, secret, base()),
		"none":       sign(jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, base()),
		"wrong iss":  sign(jwt.SigningMethodHS256, secret, func() jwt.MapClaims { c := base(); c["iss"] = "evil"; return c }()),
		"no exp":     sign(jwt.SigningMethodHS256, secret, func() jwt.MapClaims { c := base(); delete(c, "exp"); return c }()),
		"bad sub":    sign(jwt.SigningMethodHS256, secret, func() jwt.MapClaims { c := base(); c["sub"] = "x"; return c }()),
		"no sid":     sign(jwt.SigningMethodHS256, secret, func() jwt.MapClaims { c := base(); delete(c, "sid"); return c }()),
		"future iat": sign(jwt.SigningMethodHS256, secret, func() jwt.MapClaims { c := base(); c["iat"] = now.Add(time.Hour).Unix(); return c }()),
	}
	for name, tok := range cases {
		if _, err := tk.Parse(tok, now); !errors.Is(err, ErrTokenInvalid) {
			t.Errorf("%s: err = %v, want ErrTokenInvalid", name, err)
		}
	}
	if _, err := tk.Parse(sign(jwt.SigningMethodHS256, secret, base()), now); err != nil {
		t.Fatalf("hand-made valid token rejected: %v", err)
	}
}

func TestOpaqueTokens(t *testing.T) {
	raw, hash, err := NewOpaqueToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != 43 || strings.ContainsAny(raw, "+/=") {
		t.Fatalf("raw token %q is not 32 bytes of base64url", raw)
	}
	if len(hash) != 32 || string(HashToken(raw)) != string(hash) {
		t.Fatal("hash mismatch")
	}
	raw2, _, _ := NewOpaqueToken()
	if raw == raw2 {
		t.Fatal("tokens repeat")
	}
}

func TestDeviceName(t *testing.T) {
	tests := map[string]string{
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15":                   "Safari on macOS",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36":                         "Chrome on Windows",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0":           "Edge on Windows",
		"Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0":                                                                  "Firefox on Linux",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1": "Safari on iPhone",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1":  "Chrome on iPhone",
		"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36":                   "Chrome on Android",
		"curl/8.7.1": "curl",
		"":           "",
		"something":  "",
	}
	for ua, want := range tests {
		if got := DeviceName(ua); got != want {
			t.Errorf("DeviceName(%q) = %q, want %q", ua, got, want)
		}
	}
}
