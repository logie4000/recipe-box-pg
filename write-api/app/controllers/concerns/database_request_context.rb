# Runs each API request inside one transaction with app.user_id (and
# app.tenant_id in tenant mode, app.is_admin for admins) set, so RLS
# policies see who is calling.
module DatabaseRequestContext
  extend ActiveSupport::Concern

  included do
    around_action :with_database_context
  end

  private
    def with_database_context(&block)
      ActiveRecord::Base.transaction do
        DbContext.apply!(user_id: current_user_sub, tenant_id: try(:current_tenant)&.id, admin: current_user&.admin?)
        block.call
      end
    end
end
