package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/logie4000/webapp-template/server/internal/auth"
)

func testServer() http.Handler {
	s := &Server{
		Verifier:         auth.NewVerifier(context.Background(), "http://issuer.test/realms/app", "app-api", "http://127.0.0.1:1/certs"),
		Log:              slog.New(slog.NewTextHandler(io.Discard, nil)),
		MinClientVersion: "1.2.0",
		AppVersion:       "test",
	}
	return s.Routes()
}

func TestOnlyGETIsRouted(t *testing.T) {
	h := testServer()
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, "/api/v1/notes", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /api/v1/notes = %d, want 405", method, rec.Code)
		}
	}
}

func TestMetaIsPublic(t *testing.T) {
	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/meta", nil))
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("meta: %d %s", rec.Code, rec.Body.String())
	}
	if body["min_supported_version"] != "1.2.0" || body["api_version"] != "v1" {
		t.Fatalf("meta body = %v", body)
	}
}

func TestProtectedRoutesNeedToken(t *testing.T) {
	for _, path := range []string{"/api/v1/me", "/api/v1/notes", "/api/v1/notes/1", "/api/v1/private-notes"} {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s = %d, want 401", path, rec.Code)
		}
	}
}
