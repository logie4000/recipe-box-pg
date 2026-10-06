package httpx

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RateLimiter is an in-memory token bucket per key (a client IP). Each key
// may make Burst requests at once, refilled at PerMinute. A limiter with
// PerMinute <= 0 allows everything.
type RateLimiter struct {
	PerMinute int
	Burst     int

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastSweep time.Time
	now       func() time.Time // tests
}

type bucket struct {
	tokens float64
	seen   time.Time
}

func NewRateLimiter(perMinute, burst int) *RateLimiter {
	if burst < 1 {
		burst = 1
	}
	return &RateLimiter{PerMinute: perMinute, Burst: burst, buckets: map[string]*bucket{}, now: time.Now}
}

// Allow takes one token for key. When none is left it returns false and how
// long until the next one.
func (l *RateLimiter) Allow(key string) (bool, time.Duration) {
	if l.PerMinute <= 0 {
		return true, 0
	}
	perSecond := float64(l.PerMinute) / 60
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now, perSecond)

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(l.Burst)}
		l.buckets[key] = b
	} else {
		b.tokens = math.Min(float64(l.Burst), b.tokens+now.Sub(b.seen).Seconds()*perSecond)
	}
	b.seen = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / perSecond * float64(time.Second))
}

// sweep drops buckets idle long enough to be full again, once a minute, so
// the map holds only recent clients.
func (l *RateLimiter) sweep(now time.Time, perSecond float64) {
	if now.Sub(l.lastSweep) < time.Minute {
		return
	}
	l.lastSweep = now
	refill := time.Duration(float64(l.Burst) / perSecond * float64(time.Second))
	for k, b := range l.buckets {
		if now.Sub(b.seen) > refill {
			delete(l.buckets, k)
		}
	}
}

// RateLimit answers 429 with Retry-After once a client IP runs out. Requests
// carrying a bearer token use the signed-in limiter, the rest the anonymous
// one. The token isn't verified here: a forged one only earns a 401 on the
// protected routes, and nginx limits every client IP regardless.
func RateLimit(anonymous, signedIn *RateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/api/") {
				next.ServeHTTP(w, r)
				return
			}
			l := anonymous
			if strings.HasPrefix(strings.ToLower(r.Header.Get("Authorization")), "bearer ") {
				l = signedIn
			}
			if ok, wait := l.Allow(ClientIP(r)); !ok {
				w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
				Error(w, http.StatusTooManyRequests, "rate_limited", "Too many requests. Try again in a moment.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ClientIP is the peer address, or nginx's X-Real-IP when the peer is a
// loopback or private address: nginx on the host sets it to $remote_addr, and
// in docker the peer is the bridge gateway (172.x), not 127.0.0.1. The port
// is published on 127.0.0.1 only, so no outside client can be that peer.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if real := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(real) != nil {
			return real
		}
	}
	return host
}
