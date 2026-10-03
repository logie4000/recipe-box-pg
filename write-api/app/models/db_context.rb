# Per-transaction Postgres settings read by row-level-security policies:
#
#   app.user_id    the caller's token `sub`
#   app.tenant_id  the current tenant (TENANT_MODE=on only)
#
# set_config(..., true) is transaction-local, so the values can never leak to
# the next request that reuses the pooled connection.
module DbContext
  module_function

  def apply!(user_id:, tenant_id: nil)
    sql = ActiveRecord::Base.sanitize_sql_array([
      "SELECT set_config('app.user_id', ?, true), set_config('app.tenant_id', ?, true)",
      user_id.to_s, tenant_id.to_s
    ])
    ActiveRecord::Base.connection.select_all(sql)
  end

  # For jobs, console tasks and seeds:
  #   DbContext.with(user_id: sub, tenant: tenant) { ... }
  def with(user_id: nil, tenant: nil, &block)
    ActiveRecord::Base.transaction do
      apply!(user_id: user_id, tenant_id: tenant&.id)
      tenant && Tenancy.enabled? ? ActsAsTenant.with_tenant(tenant, &block) : yield
    end
  end
end
