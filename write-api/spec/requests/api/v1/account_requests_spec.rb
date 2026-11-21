require "rails_helper"

# Getting in: verified email, an emailed code, or an admin's approval.
# Keycloak is replaced by a double here; the real KeycloakAdmin calls were
# checked against a running Keycloak.
RSpec.describe "/api/v1/account-requests" do
  # A method, not a let: tokens are signed fresh, so they're valid after travel.
  def newcomer = auth_headers(sub: "new-sub", roles: [], name: "Nina New", email: "nina@example.test")
  let(:admin) { auth_headers(sub: "admin-sub", roles: %w[admin]) }
  let(:member) { auth_headers(sub: "member-sub", roles: %w[reader]) }
  let(:keycloak) { instance_double(KeycloakAdmin, grant_realm_role: nil, disable_user: nil, mark_email_verified: true) }

  before { KeycloakAdmin.current = keycloak }
  after { KeycloakAdmin.current = nil }

  # No email unless a spec turns it on (a local .env may set MAIL_FROM).
  around do |example|
    Rails.configuration.x.mail_from = nil
    ActionMailer::Base.deliveries.clear
    example.run
  ensure
    Rails.configuration.x.mail_from = ENV["MAIL_FROM"].presence
  end

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

    it "files a request when the email isn't verified, without calling Keycloak" do
      [ nil, false, "true" ].each do |claim|
        headers = auth_headers(sub: "new-sub", roles: [], email: "nina@example.test", email_verified: claim)
        post "/api/v1/account-requests", headers: headers
        expect(response.parsed_body).to include("status" => "pending")
      end

      expect(keycloak).not_to have_received(:grant_realm_role)
      expect(requests_as_admin.map(&:user_sub)).to eq([ "new-sub" ])
    end

    it "files a request for a verified claim with no email to go with it" do
      post "/api/v1/account-requests", headers: auth_headers(sub: "new-sub", roles: [], email: nil, email_verified: true)
      expect(response.parsed_body).to include("status" => "pending")
      expect(keycloak).not_to have_received(:grant_realm_role)
    end

    context "with a verified email" do
      let(:verified) { auth_headers(sub: "new-sub", roles: [], email: "nina@example.test", email_verified: true) }

      it "grants reader in Keycloak straight away and files nothing" do
        post "/api/v1/account-requests", headers: verified

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to eq("status" => "approved")
        expect(keycloak).to have_received(:grant_realm_role).with("new-sub", "reader")
        expect(requests_as_admin).to be_empty
      end

      it "drops the request filed before the email was verified" do
        file_request
        expect(requests_as_admin.size).to eq(1)

        post "/api/v1/account-requests", headers: verified

        expect(response.parsed_body).to eq("status" => "approved")
        expect(requests_as_admin).to be_empty
      end

      it "keeps things as they were when Keycloak fails" do
        file_request
        allow(keycloak).to receive(:grant_realm_role).and_raise(KeycloakAdmin::Error, "Keycloak unreachable")
        post "/api/v1/account-requests", headers: verified

        expect(response).to have_http_status(:bad_gateway)
        expect(requests_as_admin.map(&:user_sub)).to eq([ "new-sub" ])
      end
    end

    it "requires a token" do
      post "/api/v1/account-requests"
      expect(response).to have_http_status(:unauthorized)
    end

    it "waits for an admin when no email can be sent" do
      post "/api/v1/account-requests", headers: newcomer
      expect(response.parsed_body).to include("status" => "pending")
      expect(ActionMailer::Base.deliveries).to be_empty
    end
  end

  describe "email verification" do
    include ActiveSupport::Testing::TimeHelpers

    before { Rails.configuration.x.mail_from = "Recipe Box <no-reply@example.test>" }

    def emailed_code = ActionMailer::Base.deliveries.last.text_part.body.to_s[/\b\d{6}\b/]

    def verify(code, headers: newcomer)
      post "/api/v1/account-requests/verify", params: { code: code }, headers: headers, as: :json
    end

    it "emails a code on sign-in, once" do
      post "/api/v1/account-requests", headers: newcomer
      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to include("status" => "verify", "email" => "nina@example.test")
      expect(response.parsed_body["code_sent_at"]).to be_present

      mail = ActionMailer::Base.deliveries.sole
      expect(mail.to).to eq([ "nina@example.test" ])
      expect(mail.from).to eq([ "no-reply@example.test" ])
      expect(mail.subject).to eq("#{emailed_code} is your Recipe Box code")
      expect(mail.html_part.body.to_s).to include(emailed_code, "Hi Nina New")

      post "/api/v1/account-requests", headers: newcomer
      expect(ActionMailer::Base.deliveries.size).to eq(1)
    end

    it "never stores or returns the code itself" do
      post "/api/v1/account-requests", headers: newcomer
      expect(response.body).not_to include(emailed_code)
      expect(response.parsed_body["account_request"].keys).to contain_exactly("id", "email", "name", "created_at")
      expect(requests_as_admin.sole.attributes.values.map(&:to_s)).not_to include(emailed_code)
    end

    it "lets the account in with the right code: email verified, reader granted, request gone" do
      post "/api/v1/account-requests", headers: newcomer
      verify(emailed_code)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("status" => "approved")
      expect(keycloak).to have_received(:mark_email_verified).with("new-sub", "nina@example.test")
      expect(keycloak).to have_received(:grant_realm_role).with("new-sub", "reader")
      expect(requests_as_admin).to be_empty
    end

    it "accepts the code with spaces in it" do
      post "/api/v1/account-requests", headers: newcomer
      verify(" #{emailed_code[0, 3]} #{emailed_code[3, 3]} ")
      expect(response.parsed_body).to eq("status" => "approved")
    end

    it "turns away a wrong code, and kills the code after five tries" do
      post "/api/v1/account-requests", headers: newcomer
      right = emailed_code
      wrong = right == "000000" ? "111111" : "000000"

      5.times { verify(wrong) }
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["message"]).to match(/expired/)

      verify(right)
      expect(response).to have_http_status(:unprocessable_content)
      expect(keycloak).not_to have_received(:grant_realm_role)
      expect(requests_as_admin.size).to eq(1)
    end

    it "turns away a code after it expires" do
      post "/api/v1/account-requests", headers: newcomer
      code = emailed_code
      travel(AccountRequest::CODE_TTL + 1.minute) { verify(code) }
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "turns away a code sent to a different address than the account has now" do
      post "/api/v1/account-requests", headers: newcomer
      verify(emailed_code, headers: auth_headers(sub: "new-sub", roles: [], email: "someone-else@example.test"))
      expect(response).to have_http_status(:unprocessable_content)
      expect(keycloak).not_to have_received(:grant_realm_role)
    end

    it "doesn't let the account in if its Keycloak email changed meanwhile" do
      allow(keycloak).to receive(:mark_email_verified).and_return(false)
      post "/api/v1/account-requests", headers: newcomer
      verify(emailed_code)

      expect(response).to have_http_status(:conflict)
      expect(keycloak).not_to have_received(:grant_realm_role)
      expect(requests_as_admin.size).to eq(1)
    end

    it "keeps the code usable when Keycloak fails" do
      post "/api/v1/account-requests", headers: newcomer
      code = emailed_code
      allow(keycloak).to receive(:grant_realm_role).and_raise(KeycloakAdmin::Error, "Keycloak unreachable")
      verify(code)
      expect(response).to have_http_status(:bad_gateway)

      allow(keycloak).to receive(:grant_realm_role).and_return(nil)
      verify(code)
      expect(response.parsed_body).to eq("status" => "approved")
    end

    it "sends a new code on request, a minute apart and five a day at most" do
      post "/api/v1/account-requests", headers: newcomer
      first = emailed_code

      post "/api/v1/account-requests/code", headers: newcomer
      expect(response).to have_http_status(:too_many_requests)

      travel(2.minutes) do
        post "/api/v1/account-requests/code", headers: newcomer
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to include("status" => "verify")
      end
      expect(ActionMailer::Base.deliveries.size).to eq(2)

      # The old code is replaced (unless the new one happens to match it).
      if first != emailed_code
        verify(first)
        expect(response).to have_http_status(:unprocessable_content)
      end

      (3..5).each { |n| travel((2 * n).minutes) { post "/api/v1/account-requests/code", headers: newcomer } }
      expect(ActionMailer::Base.deliveries.size).to eq(5)
      travel(20.minutes) { post "/api/v1/account-requests/code", headers: newcomer }
      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body["message"]).to match(/tomorrow/)

      travel(25.hours) { post "/api/v1/account-requests/code", headers: newcomer }
      expect(response).to have_http_status(:ok)
    end

    it "reports a failed email, and lets the user ask again straight away" do
      allow_any_instance_of(ActionMailer::MessageDelivery).to receive(:deliver_now).and_raise(Net::OpenTimeout)
      post "/api/v1/account-requests/code", headers: newcomer
      expect(response).to have_http_status(:not_found) # nothing filed yet

      post "/api/v1/account-requests", headers: newcomer
      expect(response.parsed_body).to include("status" => "verify", "code_sent_at" => nil)

      post "/api/v1/account-requests/code", headers: newcomer
      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body["error"]).to eq("email")
    end

    it "answers approved for an account that is already in" do
      post "/api/v1/account-requests/verify", params: { code: "123456" }, headers: member, as: :json
      expect(response.parsed_body).to eq("status" => "approved")
      post "/api/v1/account-requests/code", headers: member
      expect(response.parsed_body).to eq("status" => "approved")
    end

    it "can't verify someone else's request" do
      post "/api/v1/account-requests", headers: newcomer
      verify(emailed_code, headers: auth_headers(sub: "other-sub", roles: [], email: "nina@example.test"))
      expect(response).to have_http_status(:not_found)
    end

    it "still lets an admin approve someone waiting for their code" do
      id = file_request
      post "/api/v1/account-requests/#{id}/approve", headers: admin
      expect(response).to have_http_status(:ok)
      expect(keycloak).to have_received(:grant_realm_role).with("new-sub", "reader")
      expect(requests_as_admin).to be_empty
    end

    it "keeps the code out of the log" do
      post "/api/v1/account-requests", headers: newcomer
      filter = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
      expect(filter.filter("code" => emailed_code)).to eq("code" => "[FILTERED]")
      expect(filter.filter("title" => "Barcode cookies")).to eq("title" => "Barcode cookies")
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
