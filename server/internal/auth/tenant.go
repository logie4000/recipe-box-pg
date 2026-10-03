package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/logie4000/webapp-template/server/internal/httpx"
)

type tenantKey struct{}

// TenantFrom returns the tenant id chosen for this request ("" when
// TENANT_MODE is off).
func TenantFrom(ctx context.Context) string {
	t, _ := ctx.Value(tenantKey{}).(string)
	return t
}

// TenantResolver implements TENANT_MODE=on (docs/multi-tenancy.md):
//  1. the caller's tenants come from the token's organization claim;
//  2. with several, X-Tenant-Id picks one (it must be one of them);
//  3. with TENANT_SUBDOMAINS=on the host's first label must match the alias;
//  4. otherwise 403.
//
// The tenant id is then set as app.tenant_id in each request transaction, and
// row-level security does the rest. Use after Verifier.Require.
type TenantResolver struct {
	Enabled    bool
	Subdomains bool
}

func (t TenantResolver) Middleware(next http.Handler) http.Handler {
	if !t.Enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := UserFrom(r.Context())
		org, ok := t.resolve(user, r)
		if !ok {
			httpx.Error(w, http.StatusForbidden, "forbidden", "no tenant for this request")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tenantKey{}, org.ID)))
	})
}

func (t TenantResolver) resolve(user *User, r *http.Request) (Organization, bool) {
	if user == nil {
		return Organization{}, false
	}
	var orgs []Organization
	for _, o := range user.Organizations {
		if o.ID != "" { // RLS needs the id; configure the mapper to include it
			orgs = append(orgs, o)
		}
	}

	var chosen Organization
	if requested := r.Header.Get("X-Tenant-Id"); requested != "" {
		found := false
		for _, o := range orgs {
			if o.ID == requested {
				chosen, found = o, true
				break
			}
		}
		if !found {
			return Organization{}, false
		}
	} else if len(orgs) == 1 {
		chosen = orgs[0]
	} else {
		return Organization{}, false
	}

	if t.Subdomains {
		host, _, _ := strings.Cut(r.Host, ":")
		if label, _, hasDot := strings.Cut(host, "."); hasDot && label != chosen.Alias {
			return Organization{}, false
		}
	}
	return chosen, true
}
