# webapp-template

A base for new web apps: PostgreSQL 16, Keycloak (OIDC), an Angular front end,
a **Go API that can only read** and a **Rails API that handles every write and
owns the schema**. Use it as a GitHub template repository and stamp out one
repo per app.

```
Browser (Angular SPA) ── OIDC Auth Code + PKCE ──> Keycloak
        │  Authorization: Bearer <access token, aud=app-api>
        ▼
nginx ─┬─ /                          Angular static files
       ├─ GET/HEAD /api/v1/*         read-api  (Go)    role app_reader: SELECT only, read-only txns
       └─ POST/PUT/PATCH/DELETE /api/v1/*, /admin
                                     write-api (Rails) role app_writer: DML only
                                     (migrations run as app_owner, deploy step only)
```

One REST URL space: `/api/v1/notes/7` is read with GET (Go) and changed with
PATCH or DELETE (Rails). nginx picks the service by HTTP method, and so does
`web/proxy.conf.mjs` under `ng serve`.

Both APIs verify tokens against Keycloak's JWKS (iss, aud, exp). Neither calls
the other. Rule of thumb: **business rules for writes in Rails, read queries in Go.**

## Layout

| Path | What |
|---|---|
| `web/` | Angular 21 (standalone, signals). `src/app/core/`: OIDC config, interceptor, guards. `src/app/features/notes/`: list via read-api, form via write-api. `proxy.conf.mjs` for `ng serve` (routes `/api/v1` by method, like nginx). |
| `server/` | Go read-api. `cmd/read-api/`, `internal/auth/` (JWT + tenant), `internal/db/` (pgx pool, `ReadTx`, generated sqlc), `internal/httpx/` (JSON, CORS, logging), `internal/api/` (routes), `queries/` (sqlc SELECTs). |
| `write-api/` | Rails 8 API app. JWT concern, Pundit policies, migrations, `db/structure.sql`, seeds, admin login hook. See `write-api/README.md`. |
| `deploy/` | `docker-compose.yml` (dev) + `docker-compose.prod.yml` (EC2), Postgres init, `keycloak/realm.json`, nginx site template, backup container, deploy/restore scripts. |
| `docs/multi-tenancy.md` | Optional `TENANT_MODE=on`. |
| `docs/recipes.md` | Recipe Box: `recipes` table, per-owner isolation (RLS), public or private recipes, photos, endpoints, web pages. |
| `docs/ssm.md` | Production settings in SSM Parameter Store: first-time setup, changing a setting. |
| `.github/workflows/ci.yml` | RSpec + RuboCop + schema check, go vet/test + sqlc diff, ng lint/test/build. |
| `.github/workflows/images.yml` | After CI passes on main: build the production images and push them to ECR (`docs/ecr.md`). |
| `Makefile`, `dev.ps1` | Dev commands (Git Bash / PowerShell). |

## Prerequisites

Docker Desktop, Git, Ruby 3.4 + Bundler, Go 1.24+, Node 22.12+ (Angular 21).

You don't need PostgreSQL client tools or sqlc installed. When `pg_dump`/`psql`
aren't on PATH, Rails runs them inside the compose `postgres` container
(`write-api/lib/pg_tools/docker_shim.rb`), and `make gen` falls back to the
`sqlc/sqlc` Docker image.

## Local development

**Windows:** either run `make` from **Git Bash** (GNU make, e.g. `choco install make`),
or use the PowerShell script, which has the same targets: `./dev.ps1 up`,
`./dev.ps1 migrate`, and so on. Both are tested on Windows 11. WSL works with
`make` as well.

```bash
make env        # .env from .env.example (dev passwords)
make up         # postgres + keycloak; realm "app" is imported on first start
make migrate    # db:migrate + db:seed as app_owner, then sqlc generate

# three terminals
make rails      # write-api  http://localhost:3000
make api        # read-api   http://localhost:8080
make web        # Angular    http://localhost:4200   <- open this
```

Setting up the Ruby and JS dependencies for the first time:
`cd write-api && bundle install`, then `cd web && npm ci`.

### Seeded Keycloak users (realm `app`)

The password for each user is the same as the username. These accounts are
for development only.

| User | Realm roles | Can |
|---|---|---|
| `alice` | reader | read notes |
| `editor` | editor (includes reader) | create, edit and delete notes |
| `admin` | admin (includes editor, reader) | all of that, and open `/admin` |
| `bob`, `carol` | editor | tenant demo (bob: globex, carol: acme + globex, alice: acme) |

The Keycloak admin console is at http://localhost:8081/admin. Its credentials
are `KC_BOOTSTRAP_ADMIN_*` in `.env`.

### Ports and health checks

| Service | URL | Health |
|---|---|---|
| Angular | http://localhost:4200 | |
| read-api | http://localhost:8080 | `GET /healthz`, `GET /readyz` (DB ping), `GET /api/v1/meta` |
| write-api | http://localhost:3000 | `GET /up` |
| Keycloak | http://localhost:8081 | management port 9000 inside the container |
| Postgres | localhost:5432 | |

### Tests and checks

```bash
make test       # rspec (needs `make up`), go test, ng test
make lint       # rubocop, gofmt + go vet, ng lint, SELECT-only query check
make verify-roles   # reader can't write; writer can't change the schema
```

The Go database test (`server/internal/db/db_integration_test.go`) starts
Postgres with testcontainers. It skips itself when Docker isn't running.

## How the read-only guarantee works

1. **Role:** `app_reader` has CONNECT, USAGE and SELECT only. Default
   privileges (`ALTER DEFAULT PRIVILEGES FOR ROLE app_owner`) cover every future
   table automatically. It has no ownership and no BYPASSRLS.
2. **Session:** `ALTER ROLE app_reader SET default_transaction_read_only = on`.
   The pgx pool sets it on every connection again, and each request runs in a
   `pgx.ReadOnly` transaction.
3. **Code:** the read-api registers only GET routes (anything else gets 405),
   and nginx lets only GET/HEAD/OPTIONS through to it. Every query is a sqlc
   SELECT; a Go test and a CI step reject anything else in `server/queries/`.
4. **Tokens:** signature (JWKS, cached, refetched on unknown `kid`), `iss`,
   `aud=app-api` and `exp` are all verified.
5. **Row-level security (optional):** every request transaction sets
   `app.user_id` (and `app.tenant_id`). The `private_notes` table is the example.

## Schema changes

Only Rails migrations change the schema (`write-api/db/migrate/`).
`make migrate` rewrites `write-api/db/structure.sql`, and sqlc reads that file
to regenerate `server/internal/db/sqlc`. Commit both. CI fails when either is
stale.

Adding a read endpoint: write a SELECT in `server/queries/*.sql`, run
`make gen`, then add a handler in `server/internal/api/`.
Adding a write: add a migration if needed, then a model, a policy and a
controller under `Api::V1` (write verbs only; `spec/routing/api_routes_spec.rb`
fails on a GET route).

## Admin login hook

`/admin` (Rails) signs in with the confidential Keycloak client `rails-admin`
(Auth Code + PKCE) and keeps an encrypted, httponly cookie session that lasts
8 hours. The placeholder page shows who you are. Logging out also ends the
Keycloak session. An admin gem (Avo, Madmin, Administrate) can mount under
`/admin` later and reuse `current_admin` / `require_admin!`
(`Admin::BaseController`).

## Social login

Keycloak brokers Google. The `google` identity provider is in `realm.json`
but **disabled**. To use it, set `KC_GOOGLE_CLIENT_ID` / `KC_GOOGLE_CLIENT_SECRET`,
enable the provider in the admin console, and run
`deploy/keycloak/configure.sh google-autolink` so First Broker Login links
accounts by verified email. The SPA's "Sign in with Google" button passes
`kc_idp_hint=google`.

## API versioning and mobile

Routes are versioned: `/api/v1/*`, with GETs served by Go and writes by Rails. Clients send
`X-Client-Version`, and both APIs log it. `GET /api/v1/meta` returns
`min_supported_version` (`MIN_SUPPORTED_CLIENT_VERSION`). `CORS_ALLOWED_ORIGINS`
applies to both APIs; the default includes `capacitor://localhost` and
`https://localhost`. There is no mobile app scaffold.

## Production (one EC2 instance)

- Everything runs in Docker Compose (`deploy/docker-compose.yml` +
  `deploy/docker-compose.prod.yml`) on 127.0.0.1: Postgres 16 (pinned minor,
  data on an EBS volume at `/srv/pgdata`), Keycloak (`start --optimized`,
  `--proxy-headers xforwarded`), read-api, write-api (Solid Queue runs inside
  Puma), and a nightly backup container.
- Hostnames: the site at `https://<APP_HOST><APP_PATH>/` and Keycloak at
  `AUTH_HOST`, by default `app.<APP_DOMAIN>` (no path) and `auth.<APP_DOMAIN>`.
  Each host needs a DNS record and a TLS certificate, and `oidc.authority` in
  `web/src/environments/environment.ts` must be `https://<AUTH_HOST>/realms/app`.
  With `APP_PATH` (e.g. `/recipe-box`), the production `baseHref` in
  `web/angular.json` must be the same path plus `/`; pages, `/api/v1`,
  `/admin` and share links all move under it.
- Ports: the containers publish on 127.0.0.1 at `READ_API_PORT` (8080),
  `WRITE_API_PORT` (3000) and `KEYCLOAK_PORT` (8081). On a server shared with
  other sites, pick free ones in SSM and pass the same values to `render.sh`.
- Your nginx: `deploy/nginx/render.sh` renders `deploy/nginx/app.conf.template`
  and installs the app's locations as a snippet (pass the same `APP_DOMAIN`,
  `APP_HOST`, `AUTH_HOST` and `APP_PATH`). If nginx already serves `APP_HOST`
  for another site, use `APP_SERVER=existing` and include the snippet in that
  site's server block. It serves `web/dist/web/browser` from
  `/srv/www/<APP_PATH or app name>`.
- Secrets: SSM Parameter Store to `.env` (`deploy/scripts/env-from-ssm.sh`),
  with a separate password for each database role. Setup: `docs/ssm.md`
  (`.env.production.example`, `deploy/scripts/env-to-ssm.sh`).
- Deploy: `IMAGE_TAG=<sha> deploy/scripts/deploy.sh` pulls from ECR, runs
  `db:migrate` as app_owner, then `up -d`.
- Recipe photos: a private, versioned S3 bucket (`IMAGE_S3_BUCKET`), read and
  written with the instance role. Setup, IAM policy and moving existing photos:
  `docs/recipes.md` (Photos on S3).
- Backups: `pg_dump -Fc` of `app` and `keycloak` to S3 every night, plus daily
  EBS snapshots through DLM (set that up in AWS). Photos are covered by S3
  versioning. `make restore-drill` restores
  the newest dump into a scratch container and checks row counts.
- Logs: slog JSON (Go) and lograge JSON (Rails).

## Stamping out a new app

1. Create a repo from this template.
2. Set `COMPOSE_PROJECT_NAME`, `APP_NAME` and `APP_DOMAIN` in `.env`, and the
   production `oidc.authority` in `web/src/environments/environment.ts`.
3. Replace the notes example with your own resources, keeping the patterns.
4. Optional: `docs/multi-tenancy.md`.
