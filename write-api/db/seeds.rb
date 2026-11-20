# Development seed data. Runs as the runtime role (app_writer), so it goes
# through the same grants and RLS policies as the app itself. Idempotent.
#
# Users live in Keycloak (deploy/keycloak/realm.json): alice (reader),
# editor (reader+editor), admin (all roles), bob and carol (tenant demo).

TENANTS = [
  # ids must match the organization ids in deploy/keycloak/realm.json
  { id: "11111111-1111-4111-8111-111111111111", name: "Acme Corp", slug: "acme" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Globex", slug: "globex" }
].freeze

if Tenancy.enabled?
  TENANTS.each do |attrs|
    tenant = Tenant.find_or_initialize_by(id: attrs[:id])
    tenant.update!(attrs.merge(status: "active"))
  end
end
