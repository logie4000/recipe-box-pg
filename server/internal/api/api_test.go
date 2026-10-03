package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/logie4000/webapp-template/server/internal/auth"
	"github.com/logie4000/webapp-template/server/internal/storage"
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
	for _, path := range []string{"/api/v1/me", "/api/v1/notes", "/api/v1/notes/1", "/api/v1/private-notes", "/api/v1/recipes", "/api/v1/recipes/1", "/api/v1/recipes/1/image"} {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s = %d, want 401", path, rec.Code)
		}
	}
}

// The public route needs no token. Anything that isn't a 12-character
// alphanumeric code, including a sequential table id, is a 404 before any database call (the test server
// has no pool), the same answer as a private recipe.
func TestPublicRecipeNeedsNoTokenAndIsReadOnly(t *testing.T) {
	for _, id := range []string{"abc", "1", "42", "k7Xq2mP9vR4", "k7Xq2mP9vR4tZ", "k7Xq2mP9-R4t", "00000000-0000-4000-8000-000000000000"} {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/public/recipes/"+id, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET public/recipes/%s = %d, want 404", id, rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("GET public/recipes/%s Cache-Control = %q, want no-store", id, got)
		}
	}

	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/public/recipes/k7Xq2mP9vR4t", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE public recipe = %d, want 405", rec.Code)
	}
}

// The public photo route follows the public recipe route: no token, 404 for
// anything that isn't a 12-character code, GET only.
func TestPublicRecipeImageNeedsNoTokenAndIsReadOnly(t *testing.T) {
	for _, id := range []string{"1", "k7Xq2mP9vR4", "k7Xq2mP9-R4t"} {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/public/recipes/"+id+"/image", nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET public/recipes/%s/image = %d, want 404", id, rec.Code)
		}
	}
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(method, "/api/v1/public/recipes/k7Xq2mP9vR4t/image", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s public recipe image = %d, want 405", method, rec.Code)
		}
	}
}

func TestServeImage(t *testing.T) {
	const key = "recipes/abcdefghijklmnopqrstuvwx.png"
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "recipes"), 0o755)
	os.WriteFile(filepath.Join(root, filepath.FromSlash(key)), []byte("PNG fake"), 0o644)
	s := &Server{Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Images: storage.LocalDisk{Root: root}}

	rec := httptest.NewRecorder()
	s.serveImage(rec, httptest.NewRequest(http.MethodGet, "/x", nil), pgtype.Text{String: key, Valid: true})
	if rec.Code != http.StatusOK || rec.Body.String() != "PNG fake" {
		t.Fatalf("serveImage = %d %q", rec.Code, rec.Body.String())
	}
	for header, want := range map[string]string{
		"Content-Type":            "image/png",
		"ETag":                    `"abcdefghijklmnopqrstuvwx.png"`,
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "default-src 'none'; sandbox",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}

	// Same key, same bytes: the browser's copy is still good.
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("If-None-Match", `"abcdefghijklmnopqrstuvwx.png"`)
	rec = httptest.NewRecorder()
	s.serveImage(rec, req, pgtype.Text{String: key, Valid: true})
	if rec.Code != http.StatusNotModified {
		t.Errorf("If-None-Match = %d, want 304", rec.Code)
	}

	// No photo, or a key whose file is gone: 404.
	for _, k := range []pgtype.Text{{}, {String: "recipes/zzzzzzzzzzzzzzzzzzzzzzzz.jpg", Valid: true}} {
		rec = httptest.NewRecorder()
		s.serveImage(rec, httptest.NewRequest(http.MethodGet, "/x", nil), k)
		if rec.Code != http.StatusNotFound {
			t.Errorf("serveImage(%v) = %d, want 404", k, rec.Code)
		}
	}
}
