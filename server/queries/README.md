# read-api queries (sqlc)

Every file here is compiled by sqlc (`make gen`) against
`write-api/db/structure.sql` into `internal/db/sqlc`.

- **SELECT only.** `internal/db/queries_readonly_test.go` and CI reject
  anything else. Writes belong in the Rails write-api.
- Keep comments out of these files: sqlc turns them into Go doc comments on
  the generated functions.
- `private_notes.sql`: row-level security returns only the caller's rows,
  because each request transaction sets `app.user_id` to the token's `sub`
  (`db.ReadTx` in `internal/db/db.go`). No WHERE clause is needed.
- `TENANT_MODE=on`: after `bin/rails generate tenancy`, add
  `WHERE tenant_id = sqlc.arg(tenant_id)` to tenant-owned queries. RLS already
  enforces isolation; the filter keeps the intent visible and lets Postgres use
  the `(tenant_id, ...)` indexes.
