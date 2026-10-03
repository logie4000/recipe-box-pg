# Base for the token-authenticated JSON API (/api/v1/*).
# Admin pages use Admin::BaseController (cookie session) instead.
class ApplicationController < ActionController::API
  include JwtAuthentication
  include TenantResolution
  include DatabaseRequestContext
  include Pundit::Authorization

  after_action :verify_authorized

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
    def render_errors(record)
      render json: { error: "invalid", errors: record.errors.to_hash(true) }, status: :unprocessable_content
    end
end
