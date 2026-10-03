# write-api (Rails 8, API mode)

Handles every write and owns the database schema. Reads go to the Go
read-api; the two services never call each other. See the repo-root README
for setup; this is a map of the pieces.

| Concern | Where |
|---|---|
| Bearer token check (JWKS, iss, aud, exp) | `app/controllers/concerns/jwt_authentication.rb`, `app/services/oidc/` |
| Role-based authorization (reader / editor / admin) | `app/policies/` (Pundit), `app/models/auth_user.rb` |
| `app.user_id` / `app.tenant_id` for RLS, one txn per request | `app/controllers/concerns/database_request_context.rb`, `app/models/db_context.rb` |
| Example resource | `app/controllers/api/v1/notes_controller.rb` (POST/PATCH/DELETE `/api/v1/notes`) |
| RLS example | `private_notes` table + `app/controllers/api/v1/private_notes_controller.rb` |
| Admin cookie-login hook | `config/initializers/omniauth.rb`, `app/controllers/admin/` |
| Multi-tenancy (off by default) | `app/models/tenancy.rb`, `app/controllers/concerns/tenant_resolution.rb`, `bin/rails g tenancy` |
| CORS | `config/initializers/cors.rb` (`CORS_ALLOWED_ORIGINS`) |
| Roles, grants, default privileges | `db/migrate/20260929160001_create_app_roles.rb` |

## Database connections

`config/database.yml` defines two connections to the same database:
`primary` (role `app_writer`, the runtime) and `migrations` (role `app_owner`,
used only by `bin/rails db:migrate`, which also dumps `db/structure.sql`).

`db/structure.sql` is the schema artifact the Go read-api's sqlc reads. Commit
it with every migration; CI fails if it is stale.

No local `pg_dump`/`psql`? `lib/pg_tools/docker_shim.rb` runs them inside the
compose `postgres` container automatically (`PG_TOOLS_VIA_DOCKER=auto`).

## Commands

```bash
bin/rails db:migrate     # as app_owner; rewrites db/structure.sql
bin/rails db:seed        # as app_writer
bin/rails server         # :3000
bundle exec rspec        # needs the compose postgres (make up)
bin/rubocop
```
