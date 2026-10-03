module Admin
  class SessionsController < BaseController
    SESSION_TTL = 8.hours

    skip_before_action :require_admin!
    # OmniAuth validates `state` on the callback; the login button POST is
    # CSRF-checked by omniauth-rails_csrf_protection.
    skip_forgery_protection only: :create

    def new; end

    def create
      auth = request.env.fetch("omniauth.auth")
      info = auth.extra&.raw_info.to_h.stringify_keys
      reset_session
      session[:admin] = {
        "sub" => auth.uid,
        "email" => auth.info.email,
        "name" => auth.info.name,
        "roles" => Array(info.dig("realm_access", "roles")),
        "id_token" => auth.credentials&.id_token,
        "expires_at" => SESSION_TTL.from_now.to_i
      }
      redirect_to admin_root_path
    end

    # Clears our cookie and ends the Keycloak SSO session too.
    def destroy
      id_token = session.dig(:admin, "id_token")
      reset_session
      oidc = Rails.configuration.x.oidc
      query = { client_id: oidc.admin_client_id, post_logout_redirect_uri: oidc.admin_post_logout_uri }
      query[:id_token_hint] = id_token if id_token
      redirect_to "#{oidc.issuer}/protocol/openid-connect/logout?#{query.to_query}", allow_other_host: true
    end

    def failure
      render plain: "Login failed: #{params[:message] || request.env['omniauth.error.type']}", status: :unauthorized
    end
  end
end
