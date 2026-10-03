# See lib/pg_tools/docker_shim.rb. Development and test only.
if Rails.env.local?
  require "pg_tools/docker_shim"
  require "active_record/tasks/postgresql_database_tasks"

  if PgTools::DockerShim.enabled?
    ActiveRecord::Tasks::PostgreSQLDatabaseTasks.prepend(PgTools::DockerShim)
  end
end
