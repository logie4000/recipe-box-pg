#!/usr/bin/env bash
# Deploy on the EC2 host (run from the repo checkout):
#
#   IMAGE_TAG=<git sha> deploy/scripts/deploy.sh
#
# 1. .env from SSM Parameter Store   2. pull images from ECR
# 3. migrate as app_owner            4. restart services
# The Angular build is copied separately to the nginx web root (see README).
set -euo pipefail
cd "$(dirname "$0")/../.."

# Which SSM path to read: SSM_PREFIX, else /webapp/<COMPOSE_PROJECT_NAME>/
# using the project name from the last deploy's .env (the first deploy needs
# SSM_PREFIX or COMPOSE_PROJECT_NAME set; env-to-ssm.sh prints it).
if [ -z "${SSM_PREFIX:-}" ] && [ -z "${COMPOSE_PROJECT_NAME:-}" ] && [ -f .env ]; then
  COMPOSE_PROJECT_NAME=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -1)
  export COMPOSE_PROJECT_NAME
fi
deploy/scripts/env-from-ssm.sh > .env.new
[ -s .env.new ] || { echo "no parameters found in SSM (check SSM_PREFIX)" >&2; rm -f .env.new; exit 1; }
mv .env.new .env
set -a; . ./.env; set +a

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

dc=(docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml --env-file .env)
"${dc[@]}" pull write-api read-api keycloak backup
"${dc[@]}" up -d postgres
"${dc[@]}" run --rm write-api ./bin/rails db:migrate
"${dc[@]}" up -d --remove-orphans
"${dc[@]}" ps
