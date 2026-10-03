package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const (
	acme   = "11111111-1111-4111-8111-111111111111"
	globex = "22222222-2222-4222-8222-222222222222"
)

var (
	alice  = &User{Subject: "alice", Organizations: []Organization{{ID: acme, Alias: "acme"}}}
	bob    = &User{Subject: "bob", Organizations: []Organization{{ID: globex, Alias: "globex"}}}
	carol  = &User{Subject: "carol", Organizations: []Organization{{ID: acme, Alias: "acme"}, {ID: globex, Alias: "globex"}}}
	nobody = &User{Subject: "nobody"}
)

func TestTenantResolver(t *testing.T) {
	cases := []struct {
		name       string
		user       *User
		header     string
		host       string
		subdomains bool
		wantStatus int
		wantTenant string
	}{
		{"single org is implied", alice, "", "app.example.com", false, 200, acme},
		{"header must be one of the user's orgs", bob, acme, "app.example.com", false, 403, ""},
		{"multi-org user must choose", carol, "", "app.example.com", false, 403, ""},
		{"multi-org user chooses", carol, globex, "app.example.com", false, 200, globex},
		{"no org is forbidden", nobody, "", "app.example.com", false, 403, ""},
		{"subdomain must match", alice, "", "globex.app.example.com", true, 403, ""},
		{"subdomain matches", alice, "", "acme.app.example.com", true, 200, acme},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			h := TenantResolver{Enabled: true, Subdomains: tc.subdomains}.Middleware(
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = TenantFrom(r.Context()) }),
			)
			req := httptest.NewRequest(http.MethodGet, "/api/v1/notes", nil)
			req.Host = tc.host
			if tc.header != "" {
				req.Header.Set("X-Tenant-Id", tc.header)
			}
			req = req.WithContext(WithUser(req.Context(), tc.user))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus || got != tc.wantTenant {
				t.Fatalf("status %d tenant %q, want %d %q", rec.Code, got, tc.wantStatus, tc.wantTenant)
			}
		})
	}
}

func TestTenantResolverDisabledIsPassThrough(t *testing.T) {
	called := false
	h := TenantResolver{}.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	if !called {
		t.Fatal("handler not called")
	}
}
