# /admin cookie login against the confidential Keycloak client "rails-admin"
# (Authorization Code + PKCE). Flow:
#   POST /admin/auth/keycloak            -> redirect to Keycloak
#   GET  /admin/auth/keycloak/callback   -> Admin::SessionsController#create
oidc = Rails.application.config.x.oidc

# Allow discovery over plain http for the local Keycloak (dev only).
if oidc.issuer.start_with?("http://")
  require "openid_connect"
  SWD.url_builder = URI::HTTP
  WebFinger.url_builder = URI::HTTP
end

OmniAuth.config.path_prefix = "/admin/auth"
OmniAuth.config.logger = Rails.logger
OmniAuth.config.on_failure = ->(env) { Admin::SessionsController.action(:failure).call(env) }

Rails.application.config.middleware.use OmniAuth::Builder do
  provider :openid_connect,
    name: :keycloak,
    issuer: oidc.issuer,
    discovery: true,
    scope: %i[openid email profile],
    response_type: :code,
    pkce: true,
    client_options: {
      identifier: oidc.admin_client_id,
      secret: oidc.admin_client_secret,
      redirect_uri: oidc.admin_redirect_uri
    }
end
