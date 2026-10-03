# bin/rails db:roles  - create app_reader/app_writer and (re)apply all grants.
#
# Also runs automatically after db:migrate, db:schema:load and db:prepare,
# because on an empty database Rails 8.1 loads db/structure.sql (which has no
# roles or grants) instead of running the migrations. See lib/db_roles.rb.
namespace :db do
  desc "Create app_reader/app_writer and apply grants + default privileges (idempotent)"
  task roles: :load_config do
    ActiveRecord::Base.configurations.configs_for(env_name: Rails.env).select(&:database_tasks?).each do |db_config|
      ActiveRecord::Tasks::DatabaseTasks.with_temporary_connection(db_config) do |conn|
        DbRoles.apply!(conn)
      end
    end
  end
end

%w[db:migrate db:schema:load db:prepare].each do |name|
  Rake::Task[name].enhance { Rake::Task["db:roles"].invoke }
end
