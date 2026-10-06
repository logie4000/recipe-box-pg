package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimiterBurstThenRefill(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := NewRateLimiter(60, 3) // one token a second
	l.now = func() time.Time { return now }

	for i := range 3 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("request %d refused inside the burst", i+1)
		}
	}
	ok, wait := l.Allow("a")
	if ok || wait != time.Second {
		t.Fatalf("4th request = %v, wait %v; want refused, 1s", ok, wait)
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("another client shares the first one's bucket")
	}

	now = now.Add(time.Second)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("no token after a second")
	}
	if ok, _ := l.Allow("a"); ok {
		t.Fatal("more than one token after a second")
	}
}

func TestRateLimiterSweepsIdleClients(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := NewRateLimiter(60, 3)
	l.now = func() time.Time { return now }
	l.Allow("a")
	now = now.Add(2 * time.Minute)
	l.Allow("b")
	if _, ok := l.buckets["a"]; ok || len(l.buckets) != 1 {
		t.Fatalf("buckets = %v, want only b", l.buckets)
	}
}

func TestRateLimiterOff(t *testing.T) {
	l := NewRateLimiter(0, 1)
	for range 100 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatal("a limit of 0 refused a request")
		}
	}
}

func TestRateLimitMiddleware(t *testing.T) {
	anon, user := NewRateLimiter(60, 1), NewRateLimiter(60, 2)
	h := RateLimit(anon, user)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	get := func(path, authz string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "203.0.113.7:5555"
		if authz != "" {
			req.Header.Set("Authorization", authz)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	if rec := get("/api/v1/shared-recipes", ""); rec.Code != http.StatusOK {
		t.Fatalf("first anonymous request = %d", rec.Code)
	}
	rec := get("/api/v1/shared-recipes", "")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("second anonymous request = %d, Retry-After %q; want 429, 1", rec.Code, rec.Header().Get("Retry-After"))
	}
	// Signed-in requests draw from their own, larger bucket.
	for i := range 2 {
		if rec := get("/api/v1/recipes", "Bearer x"); rec.Code != http.StatusOK {
			t.Fatalf("signed-in request %d = %d", i+1, rec.Code)
		}
	}
	if rec := get("/api/v1/recipes", "Bearer x"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("third signed-in request = %d, want 429", rec.Code)
	}
	// Health checks are never limited.
	if rec := get("/healthz", ""); rec.Code != http.StatusOK {
		t.Fatalf("healthz = %d", rec.Code)
	}
}

func TestClientIP(t *testing.T) {
	for _, tc := range []struct{ remote, realIP, want string }{
		{"203.0.113.7:5555", "", "203.0.113.7"},
		{"203.0.113.7:5555", "198.51.100.1", "203.0.113.7"}, // outside peer can't pick its IP
		{"127.0.0.1:5555", "198.51.100.1", "198.51.100.1"},  // nginx on the host
		{"172.18.0.1:5555", "198.51.100.1", "198.51.100.1"}, // nginx via the docker bridge
		{"[::1]:5555", "2001:db8::1", "2001:db8::1"},
		{"127.0.0.1:5555", "not-an-ip", "127.0.0.1"},
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = tc.remote
		if tc.realIP != "" {
			req.Header.Set("X-Real-IP", tc.realIP)
		}
		if got := ClientIP(req); got != tc.want {
			t.Errorf("ClientIP(%s, X-Real-IP %q) = %q, want %q", tc.remote, tc.realIP, got, tc.want)
		}
	}
}
