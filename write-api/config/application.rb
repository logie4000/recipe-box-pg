require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_mailer/railtie"
require "action_view/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

# Development/test read the shared repo-root .env (the same file docker compose,
# the Go read-api and the Makefile use). Real environment variables win.
if %w[development test].include?(ENV.fetch("RAILS_ENV", "development"))
  begin
    require "dotenv"
    Dotenv.load(File.expand_path("../../.env", __dir__))
  rescue LoadError
    nil
  end
end

module WriteApi
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    config.autoload_lib(ignore: %w[assets tasks generators pg_tools])

    # API-only app: token auth for /api/v1. /admin re-adds cookies/sessions
    # below, scoped by Admin::BaseController.
    config.api_only = true

    # Cookie session middleware exists only so the /admin login hook works.
    # API controllers never read it (ActionController::API has no session helpers).
    config.session_store :cookie_store,
      key: "_admin_session",
      secure: Rails.env.production?,
      httponly: true,
      same_site: :lax,
      expire_after: 8.hours
    config.middleware.use ActionDispatch::Cookies
    config.middleware.use config.session_store, config.session_options

    # Schema artifact is db/structure.sql (read by sqlc for the Go read-api).
    config.active_record.schema_format = :sql

    # Background jobs: Solid Queue in the same Postgres (no Redis).
    config.active_job.queue_adapter = :solid_queue

    # One JSON line per request.
    config.lograge.enabled = true
    config.lograge.formatter = Lograge::Formatters::Json.new
    config.lograge.custom_payload do |controller|
      {
        request_id: controller.request.request_id,
        client_version: controller.request.headers["X-Client-Version"],
        user_sub: controller.try(:current_user_sub)
      }.compact
    end

    config.x.tenant_mode = ENV.fetch("TENANT_MODE", "off") == "on"

    # Recipe photos (app/services/image_store.rb). The read-api serves them
    # from the same directory; in dev both default to <repo>/storage/images.
    config.x.image_storage_dir = ENV["IMAGE_STORAGE_DIR"].presence ||
      (Rails.env.test? ? Rails.root.join("tmp/test-images") : Rails.root.join("../storage/images")).to_s

    # Per-user write limits (ApplicationController, RecipeImagesController).
    # The read-api limits reads per client IP.
    config.x.rate_limit_writes_per_minute = Integer(ENV.fetch("RATE_LIMIT_WRITES_PER_MINUTE", "120"))
    config.x.rate_limit_uploads_per_minute = Integer(ENV.fetch("RATE_LIMIT_UPLOADS_PER_MINUTE", "20"))

    # Per-user storage: total photo size (RecipeImagesController) and number
    # of recipes (RecipesController#create).
    config.x.photo_storage_per_user = Integer(ENV.fetch("PHOTO_STORAGE_MB_PER_USER", "250")).megabytes
    config.x.max_recipes_per_user = Integer(ENV.fetch("MAX_RECIPES_PER_USER", "2000"))
  end
end
