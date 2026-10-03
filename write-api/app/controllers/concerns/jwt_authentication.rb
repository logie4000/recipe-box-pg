# Bearer-token authentication for the JSON API. Every request must carry a
# Keycloak access token; see Oidc::TokenVerifier for what is checked.
module JwtAuthentication
  extend ActiveSupport::Concern

  included do
    before_action :authenticate_request!
  end

  def current_claims = @current_claims
  def current_user = @current_user
  def current_user_sub = current_user&.sub
  def current_roles = current_user&.roles || []

  private
    def authenticate_request!
      token = request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
      return render_auth_error("missing bearer token") if token.blank?

      @current_claims = Oidc::TokenVerifier.verify(token)
      @current_user = AuthUser.new(@current_claims)
    rescue JWT::DecodeError => e
      render_auth_error(e.message)
    end

    def render_auth_error(message)
      response.headers["WWW-Authenticate"] = %(Bearer error="invalid_token")
      render json: { error: "unauthorized", message: message }, status: :unauthorized
    end
end
