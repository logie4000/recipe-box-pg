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
# KEYCLOAK_REALM            this app's realm (default recipe-box)
# KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD
#                           a master-realm admin of that Keycloak (only used
#                           to add the realm the first time)
# APP_HOST, APP_PATH, OIDC_ADMIN_CLIENT_SECRET   realm.json placeholders
# KC_THEMES_DIR             where the shared Keycloak reads site themes from
#                           (default /srv/keycloak/themes, infra-core's)
# KC_GOOGLE_CLIENT_ID / KC_GOOGLE_CLIENT_SECRET
#                           optional: "Sign in with Google" for this realm,
#                           (re)applied on every run while they are set
#
# Realm settings after that (sign-up, Google) are made with
# deploy/keycloak/configure.sh, which also works against the shared Keycloak.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PLATFORM_PROJECT:?set PLATFORM_PROJECT (the compose project that runs postgres and keycloak)}"
: "${APP_DB_NAME:=app}" "${APP_OWNER_PASSWORD:?}" "${APP_PLATFORM_PASSWORD:?}"
: "${KEYCLOAK_REALM:=recipe-box}"
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

# 2. Realm, only when it doesn't exist yet (a new host). On Denali the realm
#    already exists, so this leaves it exactly as it is. A host that still has
#    the old realm "app" stops here: it has to be renamed first
#    (deploy/keycloak/configure.sh rename-realm), or its users would be left
#    behind in "app" and a new, empty realm created.
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
elif [ "$KEYCLOAK_REALM" = recipe-box ] && kcadm get realms/app --fields realm >/dev/null 2>&1; then
  echo "keycloak: realm 'app' still exists; rename it first: deploy/keycloak/configure.sh rename-realm" >&2
  exit 1
else
  [ "$KEYCLOAK_REALM" = recipe-box ] || { echo "realm.json defines realm 'recipe-box'; KEYCLOAK_REALM=$KEYCLOAK_REALM isn't supported" >&2; exit 1; }
  echo "keycloak: creating realm $KEYCLOAK_REALM (then run deploy/keycloak/configure.sh signup)"
  python3 deploy/keycloak/render-realm.py | kcadm create realms -f -
fi

# 3. Google sign-in, while KC_GOOGLE_CLIENT_ID is set (so changing the secret
#    in SSM and deploying again updates it). Google vouches for the email, so
#    the app approves new Google accounts by itself. Same as Sweat Equity's.
if [ -n "${KC_GOOGLE_CLIENT_ID:-}" ]; then
  : "${KC_GOOGLE_CLIENT_SECRET:?set KC_GOOGLE_CLIENT_SECRET with KC_GOOGLE_CLIENT_ID}"
  echo "keycloak: Google sign-in on for realm $KEYCLOAK_REALM"
  r=(-r "$KEYCLOAK_REALM")
  # First broker login that links a Google sign-in to the existing account
  # with the same (Google-verified) email, or creates one.
  flow="first broker login - link by email"
  flow_path="authentication/flows/${flow// /%20}"
  if ! kcadm get authentication/flows "${r[@]}" --fields alias --format csv --noquotes | grep -qx "$flow"; then
    kcadm create authentication/flows "${r[@]}" -s "alias=$flow" -s providerId=basic-flow -s topLevel=true -s builtIn=false
  fi
  have=$(kcadm get "$flow_path/executions" "${r[@]}" --fields providerId --format csv --noquotes)
  for provider in idp-create-user-if-unique idp-auto-link; do
    grep -qx "$provider" <<<"$have" || kcadm create "$flow_path/executions/execution" "${r[@]}" -s "provider=$provider"
  done
  for id in $(kcadm get "$flow_path/executions" "${r[@]}" --fields id --format csv --noquotes); do
    kcadm update "$flow_path/executions" "${r[@]}" -b "{\"id\":\"$id\",\"requirement\":\"ALTERNATIVE\"}"
  done

  if current=$(kcadm get identity-provider/instances/google "${r[@]}" 2>/dev/null); then
    printf '%s' "$current" | python3 deploy/keycloak/google-idp.py \
      | kcadm update identity-provider/instances/google "${r[@]}" -f -
  else
    python3 deploy/keycloak/google-idp.py </dev/null | kcadm create identity-provider/instances "${r[@]}" -f -
  fi
fi

# 4. Sign-in page theme (deploy/keycloak/themes/recipe-box), copied into the
#    directory the shared Keycloak mounts as /opt/keycloak/themes. Keycloak
#    caches themes, so it is restarted when the files changed: about half a
#    minute in which no site on this Keycloak can sign in. Nothing changed,
#    nothing restarts. The realm is pointed at the theme only once Keycloak
#    has it.
themes_dir="${KC_THEMES_DIR:-/srv/keycloak/themes}"
src=deploy/keycloak/themes/recipe-box
sudo_if_needed() { "$@" 2>/dev/null || sudo "$@"; }
if [ ! -d "$themes_dir" ]; then
  echo "keycloak: no theme directory $themes_dir (set KC_THEMES_DIR); sign-in page keeps its look" >&2
elif diff -rq "$src" "$themes_dir/recipe-box" >/dev/null 2>&1; then
  echo "keycloak: recipe-box theme up to date"
else
  echo "keycloak: installing recipe-box theme in $themes_dir, restarting keycloak"
  sudo_if_needed rm -rf "$themes_dir/recipe-box.new"
  sudo_if_needed cp -r "$src" "$themes_dir/recipe-box.new"
  sudo_if_needed chmod -R a+rX "$themes_dir/recipe-box.new"
  sudo_if_needed rm -rf "$themes_dir/recipe-box"
  sudo_if_needed mv "$themes_dir/recipe-box.new" "$themes_dir/recipe-box"
  docker restart "$kc" >/dev/null
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$kc")" = healthy ] && break
    sleep 3
  done
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$kc")" = healthy ] || { echo "keycloak didn't come back healthy" >&2; exit 1; }
fi
if [ -d "$themes_dir/recipe-box" ] &&
  [ "$(kcadm get "realms/$KEYCLOAK_REALM" --fields loginTheme,displayName --format csv --noquotes)" != "recipe-box,Recipe Box" ]; then
  kcadm update "realms/$KEYCLOAK_REALM" -s loginTheme=recipe-box -s "displayName=Recipe Box"
  echo "keycloak: realm $KEYCLOAK_REALM now uses the recipe-box sign-in theme"
fi
