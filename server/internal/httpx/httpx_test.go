package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORS(t *testing.T) {
	h := CORS([]string{"http://localhost:4200", "capacitor://localhost"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	t.Run("allowed origin gets headers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/notes", nil)
		req.Header.Set("Origin", "capacitor://localhost")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "capacitor://localhost" {
			t.Fatalf("allow-origin = %q", got)
		}
	})

	t.Run("unknown origin gets nothing", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/notes", nil)
		req.Header.Set("Origin", "https://evil.example")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Fatalf("allow-origin = %q", got)
		}
	})

	t.Run("preflight answered", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/notes", nil)
		req.Header.Set("Origin", "http://localhost:4200")
		req.Header.Set("Access-Control-Request-Method", "GET")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Methods") == "" {
			t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
		}
	})
}
