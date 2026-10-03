require "rails_helper"

# Row-level security: the test database role is the table owner, and the
# table uses FORCE ROW LEVEL SECURITY, so the policy applies here too.
RSpec.describe "/api/v1/private_notes (RLS example)" do
  let(:alice) { auth_headers(sub: "alice-sub") }
  let(:bob) { auth_headers(sub: "bob-sub") }

  it "lets the owner create and delete, and hides the row from everyone else" do
    post "/api/v1/private_notes", params: { private_note: { body: "secret" } }, headers: alice, as: :json
    expect(response).to have_http_status(:created)
    id = response.parsed_body["id"]

    delete "/api/v1/private_notes/#{id}", headers: bob, as: :json
    expect(response).to have_http_status(:not_found)

    delete "/api/v1/private_notes/#{id}", headers: alice, as: :json
    expect(response).to have_http_status(:ok)
  end

  it "refuses to write a row owned by someone else" do
    expect {
      DbContext.with(user_id: "bob-sub") { PrivateNote.create!(owner_sub: "alice-sub", body: "x") }
    }.to raise_error(ActiveRecord::StatementInvalid, /row-level security/)
  end
end
