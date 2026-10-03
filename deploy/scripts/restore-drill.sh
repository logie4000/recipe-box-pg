#!/usr/bin/env bash
# Restore drill: prove last night's backup actually restores.
#
#   make restore-drill          (or deploy/scripts/restore-drill.sh [db])
#
# 1. finds the newest dump for the database in $BACKUP_S3_URI/<db>/
# 2. restores it into a scratch postgres container (never touches production)
# 3. prints row counts per table and fails if the restore errored or a
#    table listed in DRILL_REQUIRED_TABLES is empty
# Needs: docker, aws cli with read access to the bucket.
set -euo pipefail

db="${1:-${APP_DB_NAME:-app}}"
: "${BACKUP_S3_URI:?set BACKUP_S3_URI (e.g. in .env)}"
required="${DRILL_REQUIRED_TABLES:-schema_migrations}"
image="postgres:${POSTGRES_VERSION:-16}"
name="restore-drill-$db-$$"
workdir=$(mktemp -d)
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$workdir"' EXIT

latest=$(aws s3 ls "$BACKUP_S3_URI/$db/" | awk '{print $4}' | grep '\.dump$' | sort | tail -1)
[ -n "$latest" ] || { echo "no dumps under $BACKUP_S3_URI/$db/" >&2; exit 1; }
echo "restoring $BACKUP_S3_URI/$db/$latest"
aws s3 cp "$BACKUP_S3_URI/$db/$latest" "$workdir/latest.dump" --only-show-errors

docker run -d --name "$name" -e POSTGRES_PASSWORD=drill -v "$workdir:/drill:ro" "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

psql_s() { docker exec "$name" psql -U postgres -d drill -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }
docker exec "$name" createdb -U postgres drill
docker exec "$name" pg_restore -U postgres -d drill --no-owner --no-privileges --exit-on-error /drill/latest.dump

echo
echo "table                                   rows"
docker exec "$name" psql -U postgres -d drill -X -q -c "ANALYZE" >/dev/null
psql_s "SELECT format('%-40s', relname) || n_live_tup FROM pg_stat_user_tables ORDER BY relname" || true

status=0
for t in $required; do
  n=$(psql_s "SELECT count(*) FROM $t")
  if [ "$n" -gt 0 ]; then echo "ok   $t has $n rows"; else echo "FAIL $t is empty"; status=1; fi
done
[ $status -eq 0 ] && echo "restore drill PASSED ($latest)" || echo "restore drill FAILED ($latest)"
exit $status
