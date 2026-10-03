#!/usr/bin/env bash
# Smoke test of the role model after `make migrate`: the reader can read but
# not write, and the writer cannot change the schema. Uses psql from PATH, or
# the compose postgres container when psql isn't installed.
# Env: DB_HOST DB_PORT APP_DB_NAME APP_READER_PASSWORD APP_WRITER_PASSWORD
set -uo pipefail

db="${APP_DB_NAME:-app}"
if command -v psql >/dev/null 2>&1; then
  run() { PGPASSWORD="$2" psql -X -q -t -A -v ON_ERROR_STOP=1 -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "$1" -d "$db" -c "$3"; }
else
  compose=(docker compose -f "$(dirname "$0")/../docker-compose.yml")
  [ -f "$(dirname "$0")/../../.env" ] && compose+=(--env-file "$(dirname "$0")/../../.env")
  run() { "${compose[@]}" exec -T -e PGPASSWORD="$2" postgres psql -X -q -t -A -v ON_ERROR_STOP=1 -h localhost -U "$1" -d "$db" -c "$3"; }
fi

fail=0
expect_ok()   { if out=$(run "$1" "$2" "$3" 2>&1); then echo "ok   $1: $3"; else echo "FAIL $1 should be allowed: $3"; echo "     $out"; fail=1; fi; }
# A refusal only counts if Postgres refused the statement itself; a failed
# login or connection is a failure of this check, not a pass.
expect_fail() {
  if out=$(run "$1" "$2" "$3" 2>&1); then
    echo "FAIL $1 should be refused: $3"; fail=1
  elif grep -qiE "permission denied|read-only transaction|must be owner" <<<"$out"; then
    echo "ok   $1 refused: $3"
  else
    echo "FAIL $1 errored for another reason: $3"; echo "     $out"; fail=1
  fi
}

R=app_reader; RP="${APP_READER_PASSWORD:-}"
W=app_writer; WP="${APP_WRITER_PASSWORD:-}"

expect_ok   $R "$RP" "SELECT count(*) FROM notes"
expect_fail $R "$RP" "INSERT INTO notes (title, body, author_sub, created_at, updated_at) VALUES ('x', '', 'x', now(), now())"
expect_fail $R "$RP" "SELECT count(*) FROM solid_queue_jobs"
[ "$(run $R "$RP" 'SHOW default_transaction_read_only')" = "on" ] && echo "ok   $R: default_transaction_read_only = on" || { echo "FAIL $R is not read-only by default"; fail=1; }

expect_ok   $W "$WP" "BEGIN; INSERT INTO notes (title, body, author_sub, created_at, updated_at) VALUES ('x', '', 'x', now(), now()); ROLLBACK"
expect_fail $W "$WP" "CREATE TABLE should_not_exist (id int)"
expect_fail $W "$WP" "ALTER TABLE notes ADD COLUMN nope int"

exit $fail
