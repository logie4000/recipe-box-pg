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

SEED_AUTHOR = "seed"

def seed_notes(prefix)
  [
    { title: "#{prefix}Welcome", body: "This note came from db/seeds.rb and is served by the Go read-api." },
    { title: "#{prefix}How writes work", body: "The Angular form POSTs to /api/w/v1/notes (Rails), then re-reads through /api/v1/notes (Go)." }
  ].each do |attrs|
    Note.find_or_create_by!(title: attrs[:title]) do |note|
      note.body = attrs[:body]
      note.author_sub = SEED_AUTHOR
    end
  end
end

if Tenancy.enabled?
  TENANTS.each do |attrs|
    tenant = Tenant.find_or_initialize_by(id: attrs[:id])
    tenant.update!(attrs.merge(status: "active"))
    DbContext.with(tenant: tenant) { seed_notes("[#{tenant.slug}] ") }
  end
else
  seed_notes("")
end
