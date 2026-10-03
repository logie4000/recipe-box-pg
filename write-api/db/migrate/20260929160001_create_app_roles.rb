# Creates app_reader/app_writer and applies grants + default privileges.
# The logic lives in lib/db_roles.rb because it must also run after a schema
# load (fresh databases never run this migration; see lib/tasks/db_roles.rake).
class CreateAppRoles < ActiveRecord::Migration[8.1]
  def up
    DbRoles.apply!(connection)
  end

  def down
    DbRoles.revoke!(connection)
  end
end
