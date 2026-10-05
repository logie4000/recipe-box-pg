package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const (
	testIssuer   = "http://keycloak.test/realms/app"
	testAudience = "app-api"
)

type testIdP struct {
	key    *rsa.PrivateKey
	server *httptest.Server
}

func newTestIdP(t *testing.T) *testIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(srv.Close)
	return &testIdP{key: key, server: srv}
}

func (p *testIdP) token(t *testing.T, claims map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: p.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	base := map[string]any{
		"iss":          testIssuer,
		"aud":          []string{testAudience, "account"},
		"sub":          "user-1",
		"exp":          time.Now().Add(5 * time.Minute).Unix(),
		"iat":          time.Now().Unix(),
		"realm_access": map[string]any{"roles": []string{"reader", "editor"}},
	}
	for k, v := range claims {
		base[k] = v
	}
	raw, err := jwt.Signed(signer).Claims(base).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (p *testIdP) verifier() *Verifier {
	return NewVerifier(context.Background(), testIssuer, testAudience, p.server.URL)
}

func TestVerifyAcceptsValidToken(t *testing.T) {
	idp := newTestIdP(t)
	u, err := idp.verifier().Verify(context.Background(), idp.token(t, map[string]any{
		"email":        "a@example.test",
		"organization": map[string]any{"acme": map[string]string{"id": "11111111-1111-4111-8111-111111111111"}},
	}))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if u.Subject != "user-1" || !u.HasRole("editor") || u.Email != "a@example.test" {
		t.Fatalf("unexpected user %+v", u)
	}
	if len(u.Organizations) != 1 || u.Organizations[0].Alias != "acme" || u.Organizations[0].ID == "" {
		t.Fatalf("organizations not parsed: %+v", u.Organizations)
	}
}

func TestVerifyRejectsBadTokens(t *testing.T) {
	idp := newTestIdP(t)
	cases := map[string]map[string]any{
		"wrong audience": {"aud": "someone-else"},
		"wrong issuer":   {"iss": "https://evil.example/realms/app"},
		"expired":        {"exp": time.Now().Add(-10 * time.Minute).Unix()},
	}
	for name, claims := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := idp.verifier().Verify(context.Background(), idp.token(t, claims)); err == nil {
				t.Fatal("expected an error")
			}
		})
	}

	t.Run("signed by another key", func(t *testing.T) {
		other := newTestIdP(t)
		if _, err := idp.verifier().Verify(context.Background(), other.token(t, nil)); err == nil {
			t.Fatal("expected an error")
		}
	})
}

func TestRequireMiddleware(t *testing.T) {
	idp := newTestIdP(t)
	h := idp.verifier().Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(UserFrom(r.Context()).Subject))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/notes", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token: got %d", rec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/notes", nil)
	req.Header.Set("Authorization", "Bearer "+idp.token(t, nil))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "user-1" {
		t.Fatalf("valid token: got %d %q", rec.Code, rec.Body.String())
	}
}

func TestOptionalMiddleware(t *testing.T) {
	idp := newTestIdP(t)
	h := idp.verifier().Optional(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u := UserFrom(r.Context()); u != nil {
			_, _ = w.Write([]byte(u.Subject))
			return
		}
		_, _ = w.Write([]byte("anonymous"))
	}))

	cases := []struct {
		name, header string
		code         int
		body         string
	}{
		{"no token", "", http.StatusOK, "anonymous"},
		{"valid token", "Bearer " + idp.token(t, nil), http.StatusOK, "user-1"},
		{"invalid token", "Bearer not-a-jwt", http.StatusUnauthorized, ""},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/shared-recipes", nil)
		if c.header != "" {
			req.Header.Set("Authorization", c.header)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.code || (c.body != "" && rec.Body.String() != c.body) {
			t.Fatalf("%s: got %d %q", c.name, rec.Code, rec.Body.String())
		}
	}
}

func TestParseOrganizationsAliasOnly(t *testing.T) {
	orgs := parseOrganizations(json.RawMessage(`["acme","globex"]`))
	if len(orgs) != 2 || orgs[0].Alias != "acme" || orgs[0].ID != "" {
		t.Fatalf("got %+v", orgs)
	}
}
