# frozen_string_literal: true

require "shellwords"

module PgTools
  # Rails shells out to `pg_dump` (db:migrate -> db/structure.sql) and `psql`
  # (db:test:prepare). On machines without the Postgres client tools (e.g. a
  # plain Windows box) this routes those calls through the compose `postgres`
  # container instead, so the version always matches the server too.
  #
  #   PG_TOOLS_VIA_DOCKER=auto  (default) use docker only when pg_dump is not on PATH
  #   PG_TOOLS_VIA_DOCKER=1     always use docker
  #   PG_TOOLS_VIA_DOCKER=0     never
  module DockerShim
    TOOLS = %w[pg_dump psql].freeze

    def self.enabled?
      case ENV.fetch("PG_TOOLS_VIA_DOCKER", "auto")
      when "1", "true", "on" then true
      when "0", "false", "off" then false
      else !on_path?("pg_dump")
      end
    end

    def self.on_path?(cmd)
      exts = Gem.win_platform? ? ENV.fetch("PATHEXT", ".EXE").split(";") : [ "" ]
      ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).any? do |dir|
        exts.any? { |ext| File.executable?(File.join(dir, "#{cmd}#{ext}")) }
      end
    end

    def self.compose_command
      root = File.expand_path("../../..", __dir__)
      cmd = [ "docker", "compose", "-f", File.join(root, "deploy", "docker-compose.yml") ]
      env_file = File.join(root, ".env")
      cmd += [ "--env-file", env_file ] if File.exist?(env_file)
      cmd
    end

    # Rewrites a local pg_dump/psql invocation into `docker compose exec`.
    # Files named with --file are streamed through stdin/stdout instead.
    def self.translate(env, cmd, args, opts)
      args = args.dup
      opts = opts.dup
      if (i = args.index("--file"))
        file = args.delete_at(i + 1)
        args.delete_at(i)
        cmd == "pg_dump" ? opts[:out] = file : opts[:in] = file
      end
      if (i = args.index("--output"))
        args[i + 1] = "/dev/null"
      end
      exec_env = env.slice("PGUSER", "PGPASSWORD").flat_map { |k, v| [ "-e", "#{k}=#{v}" ] }
      [ [ *compose_command, "exec", "-T", *exec_env, "postgres", cmd, *args ], opts ]
    end

    def run_cmd(cmd, *args, **opts)
      return super unless TOOLS.include?(cmd)

      argv, opts = DockerShim.translate(psql_env, cmd, args, opts)
      fail run_cmd_error(cmd, args) unless Kernel.system(*argv, **opts)
    end
  end
end
