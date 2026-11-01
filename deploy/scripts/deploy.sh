#!/usr/bin/env bash
# Deploy on the EC2 host (run from the repo checkout):
#
#   IMAGE_TAG=<git sha> deploy/scripts/deploy.sh
#
# The tag is a full commit SHA from main that the Images workflow built (its
# run summary lists them), or omit IMAGE_TAG for the newest build ("latest").
#
# 1. .env from SSM Parameter Store   2. pull images from ECR
#    (with PLATFORM_PROJECT set: Postgres and Keycloak are that project's,
#    on Denali specialbrew-infra-core's; this app's database, roles and realm
#    are checked there first, deploy/scripts/shared-platform.sh)
# 3. migrate as app_owner            4. restart services
# 5. copy the web build (the <project>-web image) to the nginx web root:
#    $WEB_DIR, default /srv/www<APP_PATH>, or /srv/www/<APP_NAME> without a
#    path (the same place deploy/nginx/render.sh points nginx at). The deploy
#    user needs write access to it.
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
# The tag asked for on the command line wins over any IMAGE_TAG in SSM.
requested_tag="${IMAGE_TAG:-}"
set -a; . ./.env; set +a
export IMAGE_TAG="${requested_tag:-${IMAGE_TAG:-latest}}"
echo "deploying images tagged $IMAGE_TAG"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

dc=(docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml)
if [ -n "${PLATFORM_PROJECT:-}" ]; then
  # Postgres and Keycloak are PLATFORM_PROJECT's (docker-compose.shared.yml).
  dc+=(-f deploy/docker-compose.shared.yml --env-file .env)
  deploy/scripts/shared-platform.sh
  "${dc[@]}" pull write-api read-api backup
else
  dc+=(--env-file .env)
  "${dc[@]}" pull write-api read-api keycloak backup
  "${dc[@]}" up -d postgres
fi
"${dc[@]}" run --rm write-api ./bin/rails db:migrate
"${dc[@]}" up -d --remove-orphans
"${dc[@]}" ps

# New files are copied over the old ones and index.html goes last, so a page
# loaded before the deploy can still fetch its (differently named) old chunks.
web_image="$ECR_REGISTRY/${COMPOSE_PROJECT_NAME:-webapp}-web:${IMAGE_TAG:-latest}"
web_dir="${WEB_DIR:-/srv/www${APP_PATH:-/${APP_NAME:-app}}}"
docker pull --quiet "$web_image" >/dev/null
staging=$(mktemp -d)
container=$(docker create "$web_image")
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$staging"' EXIT
docker cp "$container:/site/." "$staging/"
mkdir -p "$web_dir"
(cd "$staging" && find . -type f ! -name index.html -exec cp --parents -t "$web_dir" {} +)
cp "$staging/index.html" "$web_dir/index.html"
echo "web build $IMAGE_TAG installed in $web_dir"
