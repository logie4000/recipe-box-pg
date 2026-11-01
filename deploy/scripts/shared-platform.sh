#!/usr/bin/env bash
# Makes sure this app's database, roles and Keycloak realm exist in another
# compose project's Postgres and Keycloak on the same host
# (docker-compose.shared.yml; on Denali, specialbrew-infra-core). Only adds:
# it never changes another app's database, roles or realm, and leaves this
# app's realm alone once it exists. Safe to re-run; deploy.sh runs it on every
# deploy when PLATFORM_PROJECT is set.
#
#   set -a; . ./.env; set +a; deploy/scripts/shared-platform.sh
#
# PLATFORM_PROJECT          compose project that owns postgres + keycloak (infra-core)
# APP_DB_NAME, APP_OWNER_PASSWORD, APP_PLATFORM_PASSWORD
# KEYCLOAK_REALM            this app's realm (default app)
# KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD
#                           a master-realm admin of that Keycloak (only used
#                           to add the realm the first time)
# APP_HOST, APP_PATH, OIDC_ADMIN_CLIENT_SECRET   realm.json placeholders
#
# Realm settings after that (sign-up, Google) are made with
# deploy/keycloak/configure.sh, which also works against the shared Keycloak.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PLATFORM_PROJECT:?set PLATFORM_PROJECT (the compose project that runs postgres and keycloak)}"
: "${APP_DB_NAME:=app}" "${APP_OWNER_PASSWORD:?}" "${APP_PLATFORM_PASSWORD:?}"
: "${KEYCLOAK_REALM:=app}"
export APP_DB_NAME

container() {
  local id
  id=$(docker ps -q --filter "label=com.docker.compose.project=$PLATFORM_PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -1)
  [ -n "$id" ] || { echo "no running $1 container in compose project $PLATFORM_PROJECT" >&2; exit 1; }
  echo "$id"
}
pg=$(container postgres)
kc=$(container keycloak)

# 1. Database and owner/platform roles, as the superuser over the container's
#    local socket. KEYCLOAK_DB_PASSWORD is blanked (the platform container has
#    it in its environment for its own init) so the keycloak database
#    and role are never touched. app_reader/app_writer come from db:migrate.
echo "postgres: database $APP_DB_NAME and roles ${APP_OWNER_USER:-app_owner}, ${APP_PLATFORM_USER:-app_platform}"
docker exec -i \
  -e APP_DB_NAME -e APP_OWNER_USER -e APP_PLATFORM_USER -e KEYCLOAK_DB_PASSWORD= \
  -e APP_OWNER_PASSWORD -e APP_PLATFORM_PASSWORD \
  "$pg" bash -s < deploy/postgres/init/01-roles.sh

# 2. Realm, only when it doesn't exist yet (a new host). On Denali realm "app"
#    already exists, so this leaves it exactly as it is.
kcadm() {
  docker exec -i -e KC_ADMIN_USER -e KC_ADMIN_PASSWORD "$kc" bash -c '
    cfg=/tmp/kcadm-$$.config
    trap "rm -f $cfg" EXIT
    /opt/keycloak/bin/kcadm.sh config credentials --config "$cfg" --server http://localhost:8080 \
      --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
    /opt/keycloak/bin/kcadm.sh "$@" --config "$cfg"' kcadm "$@"
}
export KC_ADMIN_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" KC_ADMIN_PASSWORD="${KC_BOOTSTRAP_ADMIN_PASSWORD:?set KC_BOOTSTRAP_ADMIN_PASSWORD (an admin of the shared Keycloak)}"

if kcadm get "realms/$KEYCLOAK_REALM" --fields realm >/dev/null 2>&1; then
  echo "keycloak: realm $KEYCLOAK_REALM already exists, leaving it alone"
else
  [ "$KEYCLOAK_REALM" = app ] || { echo "realm.json defines realm 'app'; KEYCLOAK_REALM=$KEYCLOAK_REALM isn't supported" >&2; exit 1; }
  echo "keycloak: creating realm $KEYCLOAK_REALM (then run deploy/keycloak/configure.sh signup)"
  python3 deploy/keycloak/render-realm.py | kcadm create realms -f -
fi
