package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeQueries struct{ err error }

func (f fakeQueries) CountAppMetadata(context.Context) (int64, error) { return 0, f.err }

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
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			router := NewRouter(NewServer(fakeQueries{err: tt.dbErr}, logger), logger, nil)

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
