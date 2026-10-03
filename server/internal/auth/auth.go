// Package auth verifies Keycloak access tokens (signature via cached JWKS,
// iss, aud, exp) and puts the caller into the request context.
package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/logie4000/webapp-template/server/internal/httpx"
)

// User is the caller as described by a verified access token.
type User struct {
	Subject       string
	Email         string
	Roles         []string
	Organizations []Organization
}

func (u *User) HasRole(role string) bool { return slices.Contains(u.Roles, role) }

type Organization struct {
	ID    string // Keycloak organization id == tenants.id (empty if the mapper omits ids)
	Alias string
}

type ctxKey int

const userKey ctxKey = iota

func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

// UserFrom returns the authenticated caller, or nil on public routes.
func UserFrom(ctx context.Context) *User {
	u, _ := ctx.Value(userKey).(*User)
	return u
}

type Verifier struct {
	verifier *oidc.IDTokenVerifier
	audience string
}

// NewVerifier builds a verifier that fetches signing keys from jwksURL lazily
// (first request) and caches them; unknown key ids trigger a refetch, which
// covers Keycloak key rotation. No network call happens at startup.
func NewVerifier(ctx context.Context, issuer, audience, jwksURL string) *Verifier {
	keySet := oidc.NewRemoteKeySet(ctx, jwksURL)
	return &Verifier{
		verifier: oidc.NewVerifier(issuer, keySet, &oidc.Config{
			ClientID:             audience, // checked against the aud claim
			SupportedSigningAlgs: []string{oidc.RS256, oidc.RS384, oidc.RS512, oidc.ES256, oidc.PS256},
		}),
		audience: audience,
	}
}

type tokenClaims struct {
	Email       string `json:"email"`
	RealmAccess struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
	ResourceAccess map[string]struct {
		Roles []string `json:"roles"`
	} `json:"resource_access"`
	Organization json.RawMessage `json:"organization"`
}

func (v *Verifier) Verify(ctx context.Context, rawToken string) (*User, error) {
	tok, err := v.verifier.Verify(ctx, rawToken)
	if err != nil {
		return nil, err
	}
	var c tokenClaims
	if err := tok.Claims(&c); err != nil {
		return nil, err
	}
	roles := append([]string{}, c.RealmAccess.Roles...)
	if client, ok := c.ResourceAccess[v.audience]; ok {
		roles = append(roles, client.Roles...)
	}
	return &User{
		Subject:       tok.Subject,
		Email:         c.Email,
		Roles:         roles,
		Organizations: parseOrganizations(c.Organization),
	}, nil
}

// parseOrganizations accepts both shapes of Keycloak's organization claim:
// ["acme"] or {"acme": {"id": "..."}}.
func parseOrganizations(raw json.RawMessage) []Organization {
	if len(raw) == 0 {
		return nil
	}
	var aliases []string
	if err := json.Unmarshal(raw, &aliases); err == nil {
		out := make([]Organization, 0, len(aliases))
		for _, a := range aliases {
			out = append(out, Organization{Alias: a})
		}
		return out
	}
	var byAlias map[string]struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &byAlias); err == nil {
		out := make([]Organization, 0, len(byAlias))
		for a, attrs := range byAlias {
			out = append(out, Organization{ID: attrs.ID, Alias: a})
		}
		slices.SortFunc(out, func(x, y Organization) int { return strings.Compare(x.Alias, y.Alias) })
		return out
	}
	return nil
}

// Require rejects requests without a valid bearer token (401).
func (v *Verifier) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := bearerToken(r)
		if !ok {
			unauthorized(w, "missing bearer token")
			return
		}
		user, err := v.Verify(r.Context(), raw)
		if err != nil {
			unauthorized(w, "invalid token")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), user)))
	})
}

func bearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	scheme, token, ok := strings.Cut(h, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
		return "", false
	}
	return strings.TrimSpace(token), true
}

func unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
	httpx.Error(w, http.StatusUnauthorized, "unauthorized", msg)
}
