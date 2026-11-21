#!/usr/bin/env bash
# Prints a .env built from SSM Parameter Store: every parameter under
# $SSM_PREFIX (default /webapp/<COMPOSE_PROJECT_NAME>/) becomes KEY=value,
# using the last path segment as KEY. Store secrets as SecureString.
#
# deploy.sh both sources the file in bash and hands it to docker compose
# (--env-file), so a value with anything but plain characters (a space, <, $,
# #, ...) is written in single quotes, which both read literally. A single
# quote or a newline in a value can't be written that way and is refused.
#
#   aws ssm put-parameter --name /webapp/myapp/APP_WRITER_PASSWORD --type SecureString --value ...
#   deploy/scripts/env-from-ssm.sh > .env
set -euo pipefail
# Git Bash on Windows would otherwise turn /webapp/... into a Windows path.
export MSYS_NO_PATHCONV=1

prefix="${SSM_PREFIX:-/webapp/${COMPOSE_PROJECT_NAME:-webapp}/}"
aws ssm get-parameters-by-path --path "$prefix" --recursive --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text \
  | tr -d '\r' \
  | while IFS=$'\t' read -r name value; do
      key="${name##*/}"
      if [[ "$value" =~ ^[A-Za-z0-9_./:@%+,=-]*$ ]]; then
        printf '%s=%s\n' "$key" "$value"
      elif [[ "$value" == *"'"* ]]; then
        echo "env-from-ssm: $key contains a single quote, which .env can't hold; change it in SSM" >&2
        exit 1
      else
        printf "%s='%s'\n" "$key" "$value"
      fi
    done
