require "rails/generators"
require "rails/generators/active_record"

# Turns on the multi-tenant schema (docs/multi-tenancy.md):
#
#   bin/rails generate tenancy                 # tenants table + notes
#   bin/rails generate tenancy orders invoices # also scope these tables
#
# Then set TENANT_MODE=on and run `make migrate`.
class TenancyGenerator < Rails::Generators::Base
  include ActiveRecord::Generators::Migration
  source_root File.expand_path("templates", __dir__)

  argument :tables, type: :array, default: [], banner: "table table..."

  def create_migration_file
    @tenant_tables = ([ "notes" ] + tables).uniq
    migration_template "enable_tenancy.rb.tt", "db/migrate/enable_tenancy.rb"
  end

  def self.next_migration_number(dirname)
    ActiveRecord::Generators::Base.next_migration_number(dirname)
  end
end
