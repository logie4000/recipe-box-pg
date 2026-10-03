# Settings shared by the API token check (JwtAuthentication) and the /admin
# cookie-login hook (config/initializers/omniauth.rb).
issuer = ENV.fetch("OIDC_ISSUER", "http://localhost:8081/realms/app")

Rails.application.config.x.oidc = ActiveSupport::OrderedOptions.new.merge!(
  issuer: issuer,
  # Access tokens must carry this audience (Keycloak audience mapper on the SPA client).
  audience: ENV.fetch("OIDC_AUDIENCE", "app-api"),
  # Override when the API can't reach the public issuer URL (e.g. inside docker:
  # http://keycloak:8080/realms/app/protocol/openid-connect/certs).
  jwks_url: ENV["OIDC_JWKS_URL"].presence || "#{issuer}/protocol/openid-connect/certs",
  admin_client_id: ENV.fetch("OIDC_ADMIN_CLIENT_ID", "rails-admin"),
  admin_client_secret: ENV["OIDC_ADMIN_CLIENT_SECRET"],
  admin_redirect_uri: ENV.fetch("ADMIN_REDIRECT_URI", "http://localhost:3000/admin/auth/keycloak/callback"),
  admin_post_logout_uri: ENV.fetch("ADMIN_POST_LOGOUT_URI", "http://localhost:3000/admin/login"),
  admin_role: ENV.fetch("ADMIN_ROLE", "admin")
)
