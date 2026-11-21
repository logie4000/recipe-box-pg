#!/usr/bin/env bash
# One-off Keycloak settings that realm.json import can't express safely.
# Run after `make up` (idempotent-ish: re-running re-applies the settings):
#
#   deploy/keycloak/configure.sh google-autolink   # First broker login links by verified email
#   deploy/keycloak/configure.sh org-ids           # organization claim carries org ids (TENANT_MODE)
#   deploy/keycloak/configure.sh signup            # self sign-up, approved in the app (realms imported before it)
#   deploy/keycloak/configure.sh rename-realm      # one-off: rename the old realm "app" to "recipe-box"
#   deploy/keycloak/configure.sh theme             # Recipe Box sign-in page look (themes/recipe-box)
#
# Uses kcadm.sh inside the running keycloak container.
set -euo pipefail

# On a host where Keycloak belongs to another compose project (PLATFORM_PROJECT
# in .env, e.g. infra-core on Denali), it runs there instead, signing in with
# KC_BOOTSTRAP_ADMIN_* from .env.
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/../docker-compose.yml")
[ -f "$here/../../.env" ] && compose+=(--env-file "$here/../../.env")
platform=$(sed -n 's/^PLATFORM_PROJECT=//p' "$here/../../.env" 2>/dev/null | tail -1)

if [ -n "$platform" ]; then
  kc=$(docker ps -q --filter "label=com.docker.compose.project=$platform" --filter label=com.docker.compose.service=keycloak | head -1)
  [ -n "$kc" ] || { echo "no running keycloak container in compose project $platform" >&2; exit 1; }
  admin_user=$(sed -n 's/^KC_BOOTSTRAP_ADMIN_USERNAME=//p' "$here/../../.env" | tail -1)
  admin_pw=$(sed -n 's/^KC_BOOTSTRAP_ADMIN_PASSWORD=//p' "$here/../../.env" | tail -1)
  kc_exec() { docker exec -i -e KC_BOOTSTRAP_ADMIN_USERNAME="${admin_user:-admin}" -e KC_BOOTSTRAP_ADMIN_PASSWORD="$admin_pw" "$kc" "$@"; }
else
  kc_exec() { "${compose[@]}" exec -T keycloak "$@"; }
fi

kcadm() { kc_exec /opt/keycloak/bin/kcadm.sh "$@"; }

# This app's realm. It used to be "app" (the template's name); rename-realm
# moves an existing one over.
realm=recipe-box
old_realm=app

login() {
  kc_exec sh -c \
    '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"' \
    >/dev/null
}

google_autolink() {
  local flow="first broker login - link by email"
  local path="authentication/flows/${flow// /%20}" # the alias goes in the URL, so encode its spaces
  if ! kcadm get "authentication/flows" -r "$realm" --fields alias --format csv --noquotes | grep -qx "$flow"; then
    kcadm create authentication/flows -r "$realm" -s "alias=$flow" -s providerId=basic-flow -s topLevel=true -s builtIn=false
  fi
  # Add whichever step is missing (also repairs a flow an earlier failed run left empty).
  local have
  have=$(kcadm get "$path/executions" -r "$realm" --fields providerId --format csv --noquotes)
  for provider in idp-create-user-if-unique idp-auto-link; do
    grep -qx "$provider" <<<"$have" || kcadm create "$path/executions/execution" -r "$realm" -s "provider=$provider"
  done
  # both steps ALTERNATIVE: create the user, or link to the existing one with the same (verified) email
  for id in $(kcadm get "$path/executions" -r "$realm" --fields id --format csv --noquotes); do
    kcadm update "$path/executions" -r "$realm" -b "{\"id\":\"$id\",\"requirement\":\"ALTERNATIVE\"}"
  done
  kcadm update identity-provider/instances/google -r "$realm" -s "firstBrokerLoginFlowAlias=$flow" -s trustEmail=true
  echo "google IdP now uses '$flow'. Enable the IdP and set its client id/secret in the admin console."
}

org_ids() {
  local scope mapper
  scope=$(kcadm get client-scopes -r "$realm" --fields id,name --format csv --noquotes | awk -F, '$2=="organization"{print $1}')
  [ -n "$scope" ] || { echo "no 'organization' client scope in realm $realm" >&2; exit 1; }
  mapper=$(kcadm get "client-scopes/$scope/protocol-mappers/models" -r "$realm" --fields id,protocolMapper --format csv --noquotes \
    | awk -F, '$2=="oidc-organization-membership-mapper"{print $1}' | head -1)
  [ -n "$mapper" ] || { echo "no organization membership mapper found" >&2; exit 1; }
  kcadm update "client-scopes/$scope/protocol-mappers/models/$mapper" -r "$realm" \
    -s 'config."addOrganizationId"=true' -s 'config."jsonType.label"=JSON'
  echo "organization claim now includes ids: {\"acme\": {\"id\": \"...\"}}"
}

# Self sign-up (also in realm.json, for new installs). Anyone can register;
# new accounts get no app role from Keycloak. The app grants "reader" through
# the rails-admin client's service account: by itself for accounts with a
# verified email (Google sign-ins, or password sign-ups that enter the code
# the app emails them), otherwise when an admin approves them on the app's
# Approvals page.
signup() {
  kcadm update "realms/$realm" -s registrationAllowed=true
  local client
  client=$(kcadm get clients -r "$realm" -q clientId=rails-admin --fields id --format csv --noquotes)
  [ -n "$client" ] || { echo "no rails-admin client in realm $realm" >&2; exit 1; }
  kcadm update "clients/$client" -r "$realm" -s serviceAccountsEnabled=true
  kcadm add-roles -r "$realm" --uusername service-account-rails-admin --cclientid realm-management     --rolename view-users --rolename manage-users
  # "reader" comes from the app (above), never from the default role.
  kcadm remove-roles -r "$realm" --rname "default-roles-$realm" --rolename reader --rolename editor --rolename admin 2>/dev/null || true
  echo "registration on; rails-admin can approve (grant reader) and decline (disable) users."
}

# Renames realm "app" to "recipe-box" in place. Users (with their ids, which
# the app's database stores as owners), passwords, roles, Google links,
# clients and settings all stay; only the URLs change
# (/realms/recipe-box/...), so everyone signs in once more. Run it right
# before starting the app with the new realm name (deploy.sh would otherwise
# create an empty "recipe-box" realm next to the old one).
rename_realm() {
  if kcadm get "realms/$realm" --fields realm >/dev/null 2>&1; then
    echo "realm $realm already exists, nothing to rename"
  else
    kcadm get "realms/$old_realm" --fields realm >/dev/null || { echo "no realm $old_realm to rename" >&2; exit 1; }
    kcadm update "realms/$old_realm" -s "realm=$realm"
    echo "realm $old_realm renamed to $realm"
  fi
  # Keycloak keeps the default role's old name; give it the one realm.json uses.
  if kcadm get "roles/default-roles-$old_realm" -r "$realm" --fields name >/dev/null 2>&1; then
    kcadm update "roles/default-roles-$old_realm" -r "$realm" -s "name=default-roles-$realm"
    echo "role default-roles-$old_realm renamed to default-roles-$realm"
  fi
  echo "Google sign-in: add https://<auth host>/realms/$realm/broker/google/endpoint to the OAuth client's redirect URIs."
}

# The sign-in pages' look (also in realm.json, for new installs). The theme
# files must already be in Keycloak: mounted in local dev, baked into the
# standalone image, copied by shared-platform.sh on a shared host.
theme() {
  kcadm update "realms/$realm" -s loginTheme=recipe-box -s "displayName=Recipe Box"
  echo "realm $realm now uses the recipe-box sign-in theme."
}

login
case "${1:-}" in
  google-autolink) google_autolink ;;
  org-ids) org_ids ;;
  signup) signup ;;
  rename-realm) rename_realm ;;
  theme) theme ;;
  *) echo "usage: $0 google-autolink|org-ids|signup|rename-realm|theme" >&2; exit 2 ;;
esac
