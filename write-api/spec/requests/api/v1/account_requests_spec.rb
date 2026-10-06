require "rails_helper"

# Sign-up with approval. Keycloak is replaced by a double here; the real
# KeycloakAdmin calls were checked against a running Keycloak.
RSpec.describe "/api/v1/account-requests" do
  let(:newcomer) { auth_headers(sub: "new-sub", roles: [], name: "Nina New", email: "nina@example.test") }
  let(:admin) { auth_headers(sub: "admin-sub", roles: %w[admin]) }
  let(:member) { auth_headers(sub: "member-sub", roles: %w[reader]) }
  let(:keycloak) { instance_double(KeycloakAdmin, grant_realm_role: nil, disable_user: nil) }

  before { KeycloakAdmin.current = keycloak }
  after { KeycloakAdmin.current = nil }

  def requests_as_admin = DbContext.with(user_id: "admin-sub", admin: true) { AccountRequest.order(:id).to_a }

  def file_request
    post "/api/v1/account-requests", headers: newcomer
    response.parsed_body.dig("account_request", "id")
  end

  describe "create" do
    it "files one request per account, with the name and email from the token" do
      post "/api/v1/account-requests", headers: newcomer
      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to include("status" => "pending")

      post "/api/v1/account-requests", headers: newcomer
      expect(response).to have_http_status(:ok)

      expect(requests_as_admin.map { |r| [ r.user_sub, r.name, r.email ] }).to eq([ [ "new-sub", "Nina New", "nina@example.test" ] ])
    end

    it "files nothing for an account that is already in" do
      post "/api/v1/account-requests", headers: member
      expect(response.parsed_body).to eq("status" => "approved")
      expect(requests_as_admin).to be_empty
    end

    it "requires a token" do
      post "/api/v1/account-requests"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "approve" do
    it "grants reader in Keycloak and drops the request" do
      id = file_request
      post "/api/v1/account-requests/#{id}/approve", headers: admin

      expect(response).to have_http_status(:ok)
      expect(keycloak).to have_received(:grant_realm_role).with("new-sub", "reader")
      expect(requests_as_admin).to be_empty
    end

    it "is for admins only: anyone else gets a 404 (RLS hides others' requests) or 403" do
      id = file_request
      post "/api/v1/account-requests/#{id}/approve", headers: member
      expect(response).to have_http_status(:not_found)

      # The newcomer can see their own request, but can't approve it.
      post "/api/v1/account-requests/#{id}/approve", headers: newcomer
      expect(response).to have_http_status(:forbidden)

      expect(keycloak).not_to have_received(:grant_realm_role)
      expect(requests_as_admin.size).to eq(1)
    end

    it "keeps the request when Keycloak fails" do
      id = file_request
      allow(keycloak).to receive(:grant_realm_role).and_raise(KeycloakAdmin::Error, "Keycloak unreachable")
      post "/api/v1/account-requests/#{id}/approve", headers: admin

      expect(response).to have_http_status(:bad_gateway)
      expect(requests_as_admin.size).to eq(1)
    end
  end

  describe "decline" do
    it "disables the account in Keycloak and drops the request" do
      id = file_request
      delete "/api/v1/account-requests/#{id}", headers: admin

      expect(response).to have_http_status(:ok)
      expect(keycloak).to have_received(:disable_user).with("new-sub")
      expect(requests_as_admin).to be_empty
    end

    it "is for admins only" do
      id = file_request
      delete "/api/v1/account-requests/#{id}", headers: newcomer
      expect(response).to have_http_status(:forbidden)
      expect(keycloak).not_to have_received(:disable_user)
    end
  end

  it "keeps requests private to their owner and admins at the database level" do
    file_request
    expect(DbContext.with(user_id: "member-sub") { AccountRequest.count }).to eq(0)
    expect(DbContext.with(user_id: "new-sub") { AccountRequest.count }).to eq(1)
    expect(DbContext.with(user_id: "admin-sub", admin: true) { AccountRequest.count }).to eq(1)
  end
end
