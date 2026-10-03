# Multi-tenancy (optional, off by default)

The template runs single-tenant. `TENANT_MODE=on` turns it into a shared-schema
multi-tenant app where Postgres row-level security keeps tenants apart even if
application code forgets a filter.

## Model

- **Tenants are Keycloak Organizations.** The organization id is `tenants.id`.
  Seeded demo orgs (`deploy/keycloak/realm.json`): **acme** (alice, carol) and
  **globex** (bob, carol).
- `tenants (id uuid, name, slug, status)`; `slug` = organization alias.
- Tenant-owned tables get `tenant_id uuid NOT NULL REFERENCES tenants`,
  `ENABLE` + `FORCE ROW LEVEL SECURITY` and the policy
  `USING / WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`.
  An unset or empty setting matches nothing, so it fails closed. (`NULLIF`
  covers the empty string a pooled connection reports after an earlier
  transaction-local `set_config`, which would otherwise be a cast error.)
- Indexes on tenant-owned tables lead with `tenant_id`.
- `app_reader` / `app_writer` own nothing and have no `BYPASSRLS`. Only
  `app_platform` bypasses RLS, for platform tasks such as cross-tenant reports
  and support fixes.

## Per request (both APIs)

1. Tenants come from the access token's `organization` claim.
2. If the user belongs to several, the `X-Tenant-Id` header chooses (it must be
   one of theirs). The Angular `TenantService` sets it through the interceptor.
3. With `TENANT_SUBDOMAINS=on`, the host's first label must equal the
   organization alias (`acme.app.example.com`).
4. No tenant means 403.
5. The request transaction sets `app.tenant_id` next to `app.user_id`:
   - Go: `internal/auth/tenant.go` then `db.ReadTx`
   - Rails: `TenantResolution` then `DatabaseRequestContext` (around_action), plus
     `ActsAsTenant.current_tenant` so models are scoped in Ruby too
   - Jobs: `DbContext.with(user_id:, tenant:) { ... }` (see ApplicationJob)

## Turning it on

```bash
cd write-api
bin/rails generate tenancy               # tenants table + tenant_id/RLS on notes
bin/rails generate tenancy orders items  # ...and on more tables
```

1. Review the generated `db/migrate/*_enable_tenancy.rb`. If the tables already
   hold rows, backfill `tenant_id` where the comment says, before the NOT NULL.
2. Set `TENANT_MODE=on` in `.env`, and `tenantMode: true` in
   `web/src/environments/*.ts`. The SPA then requests the `organization` scope.
3. `make migrate`. The seeds create the acme/globex tenants with notes for each.
4. Put the organization **id** in tokens (the Go API needs ids, not just aliases):
   `deploy/keycloak/configure.sh org-ids`, or in the admin console:
   Client scopes, organization, Mappers, organization, turn on *Add organization id*.
5. Go queries: add `WHERE tenant_id = sqlc.arg(tenant_id)` to tenant-owned
   queries in `server/queries/`, pass `auth.TenantFrom(ctx)`, then `make gen`.
   RLS already enforces isolation; the explicit filter documents intent and
   uses the `(tenant_id, ...)` indexes.
6. New tenant-owned tables later: `include Tenancy::MigrationHelpers` and call
   `enable_tenant_rls :table` (see `lib/tenancy/migration_helpers.rb`).

## Checks to add as tenants go live

- Cross-tenant request specs: alice (acme) cannot see or change globex rows
  (404, not 403); carol sees both, depending on `X-Tenant-Id`; a user with no
  organization gets 403.
- Go: the same through `/api/v1/notes` using testcontainers.

## Verify after setup

- The organization ids in `realm.json` are fixed so that `db/seeds.rb` can
  match them. If your Keycloak version ignores `id` on import, copy the real ids
  from the admin console into `db/seeds.rb`.
