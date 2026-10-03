#!/usr/bin/env bash
# One-off Keycloak settings that realm.json import can't express safely.
# Run after `make up` (idempotent-ish: re-running re-applies the settings):
#
#   deploy/keycloak/configure.sh google-autolink   # First broker login links by verified email
#   deploy/keycloak/configure.sh org-ids           # organization claim carries org ids (TENANT_MODE)
#
# Uses kcadm.sh inside the running keycloak container.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/../docker-compose.yml")
[ -f "$here/../../.env" ] && compose+=(--env-file "$here/../../.env")

kcadm() { "${compose[@]}" exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }

login() {
  "${compose[@]}" exec -T keycloak sh -c \
    '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"' \
    >/dev/null
}

google_autolink() {
  local flow="first broker login - link by email"
  if ! kcadm get "authentication/flows" -r app --fields alias --format csv --noquotes | grep -qx "$flow"; then
    kcadm create authentication/flows -r app -s "alias=$flow" -s providerId=basic-flow -s topLevel=true -s builtIn=false
    kcadm create "authentication/flows/$flow/executions/execution" -r app -s provider=idp-create-user-if-unique
    kcadm create "authentication/flows/$flow/executions/execution" -r app -s provider=idp-auto-link
    # both steps ALTERNATIVE: create the user, or link to the existing one with the same (verified) email
    for id in $(kcadm get "authentication/flows/$flow/executions" -r app --fields id --format csv --noquotes); do
      kcadm update "authentication/flows/$flow/executions" -r app -b "{\"id\":\"$id\",\"requirement\":\"ALTERNATIVE\"}"
    done
  fi
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

login
case "${1:-}" in
  google-autolink) google_autolink ;;
  org-ids) org_ids ;;
  *) echo "usage: $0 google-autolink|org-ids" >&2; exit 2 ;;
esac
