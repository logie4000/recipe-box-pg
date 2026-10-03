module Tenancy
  # For migrations that add tenant-owned tables once tenancy is on:
  #
  #   include Tenancy::MigrationHelpers
  #   create_table :orders do |t|
  #     t.references :tenant, type: :uuid, null: false, foreign_key: true, index: false
  #     ...
  #   end
  #   add_index :orders, %i[tenant_id created_at]
  #   enable_tenant_rls :orders
  module MigrationHelpers
    TENANT_PREDICATE = "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid".freeze

    def enable_tenant_rls(table)
      execute <<~SQL
        ALTER TABLE #{table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE #{table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY #{table}_tenant_isolation ON #{table}
          USING (#{TENANT_PREDICATE})
          WITH CHECK (#{TENANT_PREDICATE});
      SQL
    end

    def disable_tenant_rls(table)
      execute <<~SQL
        DROP POLICY IF EXISTS #{table}_tenant_isolation ON #{table};
        ALTER TABLE #{table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE #{table} DISABLE ROW LEVEL SECURITY;
      SQL
    end
  end
end
