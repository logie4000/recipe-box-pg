#!/usr/bin/env bash
# Prints a .env built from SSM Parameter Store: every parameter under
# $SSM_PREFIX (default /webapp/<COMPOSE_PROJECT_NAME>/) becomes KEY=value,
# using the last path segment as KEY. Store secrets as SecureString.
#
#   aws ssm put-parameter --name /webapp/myapp/APP_WRITER_PASSWORD --type SecureString --value ...
#   deploy/scripts/env-from-ssm.sh > .env
set -euo pipefail
# Git Bash on Windows would otherwise turn /webapp/... into a Windows path.
export MSYS_NO_PATHCONV=1

prefix="${SSM_PREFIX:-/webapp/${COMPOSE_PROJECT_NAME:-webapp}/}"
aws ssm get-parameters-by-path --path "$prefix" --recursive --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text \
  | while IFS=$'\t' read -r name value; do
      printf '%s=%s\n' "${name##*/}" "$value"
    done
