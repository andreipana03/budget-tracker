package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"testing"
)

type fakeHealth struct{ err error }

func (f fakeHealth) CountAppMetadata(context.Context) (int64, error) { return 0, f.err }

func testRouter(t *testing.T, deps Deps, opts RouterOptions) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	deps.Logger = logger
	return NewRouter(NewServer(deps), logger, opts)
}

func TestGetHealth(t *testing.T) {
	tests := []struct {
		name         string
		dbErr        error
		wantCode     int
		wantStatus   string
		wantDatabase string
	}{
		{name: "database available", wantCode: http.StatusOK, wantStatus: "ok", wantDatabase: "up"},
		{name: "database unavailable", dbErr: errors.New("connection refused"), wantCode: http.StatusServiceUnavailable, wantStatus: "degraded", wantDatabase: "down"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := testRouter(t, Deps{Health: fakeHealth{err: tt.dbErr}}, RouterOptions{})

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))

			if recorder.Code != tt.wantCode {
				t.Fatalf("status code = %d, want %d", recorder.Code, tt.wantCode)
			}
			var body struct {
				Status   string `json:"status"`
				Database string `json:"database"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if body.Status != tt.wantStatus || body.Database != tt.wantDatabase {
				t.Fatalf("body = %+v, want status %q and database %q", body, tt.wantStatus, tt.wantDatabase)
			}
		})
	}
}

type rejectAll struct{ calls int }

func (r *rejectAll) Authenticate(context.Context, *http.Request) (Principal, error) {
	r.calls++
	return Principal{}, errors.New("no")
}

func TestProtectedOperationsAreDeniedByDefault(t *testing.T) {
	for _, auth := range []Authenticator{nil, &rejectAll{}} {
		router := testRouter(t, Deps{Health: fakeHealth{}}, RouterOptions{Authenticator: auth})
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/me", nil))
		if auth == nil && recorder.Code != http.StatusUnauthorized {
			t.Fatalf("without an authenticator: status = %d, want 401", recorder.Code)
		}
		if auth != nil && recorder.Code != http.StatusInternalServerError {
			// rejectAll returns a plain error, which is never leaked: it becomes a 500.
			t.Fatalf("with a failing authenticator: status = %d, want 500", recorder.Code)
		}
		var body struct{ Code string }
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || body.Code == "" {
			t.Fatalf("error body = %q, want JSON with a code", recorder.Body.String())
		}
	}
}

func TestUnknownRoutesAnswerJSON(t *testing.T) {
	router := testRouter(t, Deps{Health: fakeHealth{}}, RouterOptions{})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/nope", nil))
	if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), `"not_found"`) {
		t.Fatalf("got %d %s", recorder.Code, recorder.Body.String())
	}
}

// TestPublicOperationsMatchSpec keeps publicOperations equal to the operations that
// declare `security: []` in api/openapi.yaml, so nothing is accidentally left open.
func TestPublicOperationsMatchSpec(t *testing.T) {
	f, err := os.Open("../../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("open spec: %v", err)
	}
	defer f.Close()

	var public []string
	current := ""
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case strings.HasPrefix(line, "operationId:"):
			id := strings.TrimSpace(strings.TrimPrefix(line, "operationId:"))
			current = strings.ToUpper(id[:1]) + id[1:]
		case line == "security: []" && current != "":
			public = append(public, current)
		case strings.HasPrefix(line, "responses:"):
			current = "" // security must come before responses
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}

	var declared []string
	for op := range publicOperations {
		declared = append(declared, op)
	}
	sort.Strings(public)
	sort.Strings(declared)
	if strings.Join(public, ",") != strings.Join(declared, ",") {
		t.Fatalf("publicOperations = %v\nspec security: [] = %v", declared, public)
	}
}
