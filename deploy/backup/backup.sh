#!/usr/bin/env bash
# backup.sh once   dump every database in BACKUP_DATABASES to S3 now
# backup.sh loop   do that every day at BACKUP_HOUR_UTC (default 3)
#
# Objects: $BACKUP_S3_URI/<db>/<db>-YYYYmmddTHHMMSSZ.dump (pg_dump -Fc).
# Expire old ones with an S3 lifecycle rule rather than here.
set -euo pipefail

: "${BACKUP_S3_URI:?}"
: "${BACKUP_DATABASES:=app keycloak}"
: "${BACKUP_HOUR_UTC:=3}"

once() {
  local stamp db key
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  for db in $BACKUP_DATABASES; do
    key="$BACKUP_S3_URI/$db/$db-$stamp.dump"
    echo "$(date -u +%FT%TZ) dumping $db -> $key"
    pg_dump -Fc --no-owner --dbname "$db" | aws s3 cp - "$key" --only-show-errors
  done
  echo "$(date -u +%FT%TZ) backup complete"
}

loop() {
  while true; do
    now=$(date -u +%s)
    next=$(date -u -d "today ${BACKUP_HOUR_UTC}:00" +%s)
    [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow ${BACKUP_HOUR_UTC}:00" +%s)
    echo "next backup at $(date -u -d "@$next" +%FT%TZ)"
    sleep $((next - now))
    once || echo "backup FAILED" >&2
  done
}

case "${1:-loop}" in
  once) once ;;
  loop) loop ;;
  *) echo "usage: $0 once|loop" >&2; exit 2 ;;
esac
