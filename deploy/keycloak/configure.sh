#!/usr/bin/env bash
# One-off Keycloak settings that realm.json import can't express safely.
# Run after `make up` (idempotent-ish: re-running re-applies the settings):
#
#   deploy/keycloak/configure.sh google-autolink   # First broker login links by verified email
#   deploy/keycloak/configure.sh org-ids           # organization claim carries org ids (TENANT_MODE)
#   deploy/keycloak/configure.sh signup            # self sign-up, approved in the app (realms imported before it)
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

login() {
  kc_exec sh -c \
    '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"' \
    >/dev/null
}

google_autolink() {
  local flow="first broker login - link by email"
  local path="authentication/flows/${flow// /%20}" # the alias goes in the URL, so encode its spaces
  if ! kcadm get "authentication/flows" -r app --fields alias --format csv --noquotes | grep -qx "$flow"; then
    kcadm create authentication/flows -r app -s "alias=$flow" -s providerId=basic-flow -s topLevel=true -s builtIn=false
  fi
  # Add whichever step is missing (also repairs a flow an earlier failed run left empty).
  local have
  have=$(kcadm get "$path/executions" -r app --fields providerId --format csv --noquotes)
  for provider in idp-create-user-if-unique idp-auto-link; do
    grep -qx "$provider" <<<"$have" || kcadm create "$path/executions/execution" -r app -s "provider=$provider"
  done
  # both steps ALTERNATIVE: create the user, or link to the existing one with the same (verified) email
  for id in $(kcadm get "$path/executions" -r app --fields id --format csv --noquotes); do
    kcadm update "$path/executions" -r app -b "{\"id\":\"$id\",\"requirement\":\"ALTERNATIVE\"}"
  done
  kcadm update identity-provider/instances/google -r app -s "firstBrokerLoginFlowAlias=$flow" -s trustEmail=true
  echo "google IdP now uses '$flow'. Enable the IdP and set its client id/secret in the admin console."
}

org_ids() {
  local scope mapper
  scope=$(kcadm get client-scopes -r app --fields id,name --format csv --noquotes | awk -F, '$2=="organization"{print $1}')
  [ -n "$scope" ] || { echo "no 'organization' client scope in realm app" >&2; exit 1; }
  mapper=$(kcadm get "client-scopes/$scope/protocol-mappers/models" -r app --fields id,protocolMapper --format csv --noquotes \
    | awk -F, '$2=="oidc-organization-membership-mapper"{print $1}' | head -1)
  [ -n "$mapper" ] || { echo "no organization membership mapper found" >&2; exit 1; }
  kcadm update "client-scopes/$scope/protocol-mappers/models/$mapper" -r app \
    -s 'config."addOrganizationId"=true' -s 'config."jsonType.label"=JSON'
  echo "organization claim now includes ids: {\"acme\": {\"id\": \"...\"}}"
}

# Sign-up with approval (also in realm.json, for new installs). Anyone can
# register; new accounts get no app role, so they can browse but not write
# until an admin approves them on the app's Approvals page, which grants
# "reader" through the rails-admin client's service account.
signup() {
  kcadm update realms/app -s registrationAllowed=true
  local client
  client=$(kcadm get clients -r app -q clientId=rails-admin --fields id --format csv --noquotes)
  [ -n "$client" ] || { echo "no rails-admin client in realm app" >&2; exit 1; }
  kcadm update "clients/$client" -r app -s serviceAccountsEnabled=true
  kcadm add-roles -r app --uusername service-account-rails-admin --cclientid realm-management     --rolename view-users --rolename manage-users
  # New accounts must not be approved automatically.
  kcadm remove-roles -r app --rname default-roles-app --rolename reader --rolename editor --rolename admin 2>/dev/null || true
  echo "registration on; rails-admin can approve (grant reader) and decline (disable) users."
}

login
case "${1:-}" in
  google-autolink) google_autolink ;;
  org-ids) org_ids ;;
  signup) signup ;;
  *) echo "usage: $0 google-autolink|org-ids|signup" >&2; exit 2 ;;
esac
