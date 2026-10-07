#!/usr/bin/env bash
# Uploads a KEY=value file to SSM Parameter Store, the reverse of
# env-from-ssm.sh. Each line becomes $SSM_PREFIX<KEY>, overwriting any value
# already there; keys containing PASSWORD or SECRET are SecureString.
#
#   deploy/scripts/env-to-ssm.sh .env.production            upload
#   DRY_RUN=1 deploy/scripts/env-to-ssm.sh .env.production  show what it would do
#
# The prefix defaults to /webapp/<COMPOSE_PROJECT_NAME from the file>/.
# Values are never printed. Lines whose value is CHANGE_ME stop the upload.
# Needs AWS CLI v2 (v1 would fetch values that look like URLs).
set -euo pipefail
# Git Bash on Windows would otherwise turn /webapp/... into a Windows path.
export MSYS_NO_PATHCONV=1

file="${1:?usage: $0 <env file>}"
[ -f "$file" ] || { echo "$file not found" >&2; exit 1; }

# KEY=value lines only, like env-from-ssm.sh writes and docker compose reads.
lines=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" || true)
[ -n "$lines" ] || { echo "no KEY=value lines in $file" >&2; exit 1; }

if bad=$(printf '%s\n' "$lines" | grep -E '^[^=]+=CHANGE_ME$'); then
  echo "replace these CHANGE_ME values first:" >&2
  printf '%s\n' "$bad" | cut -d= -f1 | sed 's/^/  /' >&2
  exit 1
fi

project=$(printf '%s\n' "$lines" | sed -n 's/^COMPOSE_PROJECT_NAME=//p' | tail -1)
prefix="${SSM_PREFIX:-/webapp/${project:-webapp}/}"
echo "uploading to $prefix"

printf '%s\n' "$lines" | while IFS= read -r line; do
  key=${line%%=*}
  value=${line#*=}
  # Optional surrounding quotes, as in .env files.
  value=${value#\"}; value=${value%\"}
  value=${value#\'}; value=${value%\'}
  case "$key" in
    *PASSWORD*|*SECRET*) type=SecureString ;;
    *) type=String ;;
  esac
  # SSM rejects empty values; an unset key falls back to the compose default.
  if [ -z "$value" ]; then
    echo "  skip $key (empty)"
    continue
  fi
  echo "  $type $prefix$key"
  if [ -z "${DRY_RUN:-}" ]; then
    aws ssm put-parameter --name "$prefix$key" --type "$type" --value "$value" --overwrite >/dev/null
  fi
done

echo "on the server: SSM_PREFIX=$prefix deploy/scripts/deploy.sh (only needed the first time)"
