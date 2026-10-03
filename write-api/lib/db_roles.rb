# Runtime roles, grants and default privileges. Idempotent; runs as app_owner.
#
#   app_owner     owns every table; used only by db:* tasks. Not BYPASSRLS, so
#                 FORCE ROW LEVEL SECURITY applies to it too.
#   app_writer    Rails runtime: DML, no DDL
#   app_reader    Go read-api: SELECT only, read-only transactions
#   app_platform  platform/maintenance tasks: DML + BYPASSRLS
#
# app_owner and app_platform come from deploy/postgres/init/01-roles.sh (only a
# superuser may grant BYPASSRLS). This creates app_reader/app_writer and
# applies every grant.
#
# Why not only a migration: Rails 8.1 `db:migrate` on an empty database loads
# db/structure.sql instead of running migrations, and structure.sql carries no
# roles or grants. So lib/tasks/db_roles.rake runs this after db:migrate,
# db:schema:load and db:prepare as well (see `bin/rails db:roles`).
#
# Passwords come from APP_READER_PASSWORD / APP_WRITER_PASSWORD when set.
module DbRoles
  RUNTIME_ROLES = %w[app_reader app_writer].freeze

  module_function

  def apply!(conn)
    owner = conn.quote_table_name(conn.select_value("SELECT current_user"))
    database = conn.quote_table_name(conn.select_value("SELECT current_database()"))

    unless conn.select_value("SELECT 1 FROM pg_roles WHERE rolname = 'app_platform'")
      raise "Role app_platform is missing: run deploy/postgres/init/01-roles.sh as a superuser first"
    end

    RUNTIME_ROLES.each do |role|
      unless conn.select_value("SELECT 1 FROM pg_roles WHERE rolname = #{conn.quote(role)}")
        conn.execute("CREATE ROLE #{role} LOGIN")
      end
      password = ENV["#{role.upcase}_PASSWORD"]
      conn.execute("ALTER ROLE #{role} PASSWORD #{conn.quote(password)}") if password.present?
    end

    conn.execute(<<~SQL)
      ALTER ROLE app_reader SET default_transaction_read_only = on;

      REVOKE ALL ON DATABASE #{database} FROM PUBLIC;
      GRANT CONNECT, TEMPORARY ON DATABASE #{database} TO app_reader, app_writer, app_platform;

      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO app_reader, app_writer, app_platform;

      GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_reader;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_writer, app_platform;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_writer, app_platform;

      ALTER DEFAULT PRIVILEGES FOR ROLE #{owner} IN SCHEMA public
        GRANT SELECT ON TABLES TO app_reader;
      ALTER DEFAULT PRIVILEGES FOR ROLE #{owner} IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_writer, app_platform;
      ALTER DEFAULT PRIVILEGES FOR ROLE #{owner} IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO app_writer, app_platform;
      ALTER DEFAULT PRIVILEGES FOR ROLE #{owner} IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO app_reader, app_writer, app_platform;
    SQL

    # The Go read-api has no business reading job internals.
    hidden = conn.select_values(<<~SQL)
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'solid\\_queue\\_%'
    SQL
    conn.execute("REVOKE ALL ON #{hidden.map { |t| conn.quote_table_name(t) }.join(', ')} FROM app_reader") if hidden.any?
  end

  def revoke!(conn)
    owner = conn.quote_table_name(conn.select_value("SELECT current_user"))
    conn.execute(<<~SQL)
      ALTER DEFAULT PRIVILEGES FOR ROLE #{owner} IN SCHEMA public REVOKE ALL ON TABLES FROM app_reader, app_writer, app_platform;
      ALTER DEFAULT PRIVILEGES FOR ROLE #{owner} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_writer, app_platform;
      ALTER DEFAULT PRIVILEGES FOR ROLE #{owner} IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM app_reader, app_writer, app_platform;
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_reader, app_writer, app_platform;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_writer, app_platform;
      REVOKE ALL ON SCHEMA public FROM app_reader, app_writer, app_platform;
    SQL
    # Roles are cluster-wide and may be used by other databases; not dropped.
  end
end
