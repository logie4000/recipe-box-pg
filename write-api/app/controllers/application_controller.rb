# Base for the token-authenticated JSON API (/api/v1/*).
# Admin pages use Admin::BaseController (cookie session) instead.
class ApplicationController < ActionController::API
  include JwtAuthentication
  include TenantResolution
  include DatabaseRequestContext
  include Pundit::Authorization

  after_action :verify_authorized

  # Writes per signed-in user, across every API controller. Counted after
  # authentication, so a missing or bad token is still a plain 401. Memory
  # is per Puma process; one process in production (WEB_CONCURRENCY unset).
  RATE_LIMIT_STORE = ActiveSupport::Cache::MemoryStore.new
  rate_limit to: Rails.configuration.x.rate_limit_writes_per_minute, within: 1.minute,
    scope: "api-writes", by: -> { current_user_sub }, with: :render_rate_limited, store: RATE_LIMIT_STORE

  rescue_from Pundit::NotAuthorizedError do
    render json: { error: "forbidden" }, status: :forbidden
  end

  rescue_from ActiveRecord::RecordNotFound do
    render json: { error: "not_found" }, status: :not_found
  end

  rescue_from ActionController::ParameterMissing do |e|
    render json: { error: "bad_request", message: e.message }, status: :bad_request
  end

  private
    def render_rate_limited
      response.headers["Retry-After"] = "60"
      render json: { error: "rate_limited", message: "Too many changes at once. Try again in a minute." },
        status: :too_many_requests
    end

    # Serializes the caller's requests that check a per-user limit (recipe
    # count, photo storage) until the request's transaction ends, so two at
    # once can't both squeeze under it.
    def lock_current_user!
      ActiveRecord::Base.connection.select_value(
        ActiveRecord::Base.sanitize_sql_array([ "SELECT pg_advisory_xact_lock(hashtext(?))", "user:#{current_user_sub}" ])
      )
    end

    def render_errors(record)
      render json: { error: "invalid", errors: record.errors.to_hash(true) }, status: :unprocessable_content
    end
end
