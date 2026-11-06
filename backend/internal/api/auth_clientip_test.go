package api

import (
	"net/http/httptest"
	"testing"
)

func TestAuthClientIPUsesTheProxysHop(t *testing.T) {
	r := httptest.NewRequest("POST", "/auth/login", nil)
	r.RemoteAddr = "10.0.0.2:5555"
	// The client sent a made-up first hop; our proxy appended the real address last.
	r.Header.Add("X-Forwarded-For", "1.2.3.4, 9.9.9.9")
	r.Header.Add("X-Forwarded-For", "203.0.113.7")

	if ip, _ := authClientIP(r, true); ip.String() != "203.0.113.7" {
		t.Fatalf("behind a proxy: %s, want the last hop 203.0.113.7", ip)
	}
	if ip, _ := authClientIP(r, false); ip.String() != "10.0.0.2" {
		t.Fatalf("without a trusted proxy: %s, want the connection's address", ip)
	}
}
