# Optional multi-tenancy (TENANT_MODE=on). See docs/multi-tenancy.md.
#
# Tenants are Keycloak Organizations; the organization id is tenants.id.
module Tenancy
  module_function

  def enabled? = Rails.configuration.x.tenant_mode

  # When on, the first host label (acme.app.example.com) must match the tenant slug.
  def subdomains? = ENV.fetch("TENANT_SUBDOMAINS", "off") == "on"

  # Keycloak's `organization` claim comes in two shapes depending on the
  # Organization Membership mapper settings:
  #   ["acme", "globex"]                                (aliases only)
  #   {"acme" => {"id" => "..."}, "globex" => {...}}    ("Add organization id" on)
  # Returns [{ id:, alias: }] with id nil when the token only has aliases.
  def organizations_from(claims)
    case (orgs = claims&.fetch("organization", nil))
    when Hash then orgs.map { |name, attrs| { id: attrs.is_a?(Hash) ? attrs["id"] : nil, alias: name } }
    when Array then orgs.map { |name| { id: nil, alias: name } }
    else []
    end
  end
end
