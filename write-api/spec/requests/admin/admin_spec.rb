require "rails_helper"

RSpec.describe "/admin login hook" do
  before { OmniAuth.config.test_mode = true }
  after { OmniAuth.config.mock_auth[:keycloak] = nil }

  def sign_in(roles:)
    OmniAuth.config.mock_auth[:keycloak] = OmniAuth::AuthHash.new(
      provider: "keycloak", uid: "admin-sub",
      info: { email: "admin@example.test", name: "Ada Admin" },
      credentials: { id_token: "id.token.value" },
      extra: { raw_info: { realm_access: { roles: roles } } }
    )
    get "/admin/auth/keycloak/callback"
  end

  it "redirects anonymous visitors to the login page" do
    get "/admin"
    expect(response).to redirect_to("/admin/login")
  end

  it "shows who you are to admins" do
    sign_in(roles: %w[admin])
    get "/admin"
    expect(response).to have_http_status(:ok)
    expect(response.body).to include("Ada Admin", "admin-sub")
  end

  it "forbids signed-in users without the admin role" do
    sign_in(roles: %w[reader])
    get "/admin"
    expect(response).to have_http_status(:forbidden)
  end

  it "logs out through Keycloak's end-session endpoint" do
    sign_in(roles: %w[admin])
    delete "/admin/logout"
    expect(response.location).to start_with("#{Rails.configuration.x.oidc.issuer}/protocol/openid-connect/logout")
    expect(response.location).to include("id_token_hint=id.token.value")
  end
end
