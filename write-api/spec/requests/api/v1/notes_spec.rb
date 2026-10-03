require "rails_helper"

RSpec.describe "POST/PATCH/DELETE /api/v1/notes" do
  let(:editor) { auth_headers(sub: "editor-1", roles: %w[reader editor]) }
  let(:reader) { auth_headers(sub: "reader-1", roles: %w[reader]) }

  it "rejects requests without a token" do
    post "/api/v1/notes", params: { note: { title: "x" } }, as: :json
    expect(response).to have_http_status(:unauthorized)
  end

  it "forbids readers from writing" do
    post "/api/v1/notes", params: { note: { title: "x" } }, headers: reader, as: :json
    expect(response).to have_http_status(:forbidden)
  end

  it "creates a note for editors and returns its id" do
    post "/api/v1/notes", params: { note: { title: "Hello", body: "World" } }, headers: editor, as: :json

    expect(response).to have_http_status(:created)
    id = response.parsed_body["id"]
    expect(Note.find(id)).to have_attributes(title: "Hello", author_sub: "editor-1")
  end

  it "returns validation errors" do
    post "/api/v1/notes", params: { note: { title: "" } }, headers: editor, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to have_key("title")
  end

  it "updates and deletes" do
    note = create(:note)

    patch "/api/v1/notes/#{note.id}", params: { note: { title: "Renamed" } }, headers: editor, as: :json
    expect(response).to have_http_status(:ok)
    expect(note.reload.title).to eq("Renamed")

    delete "/api/v1/notes/#{note.id}", headers: editor, as: :json
    expect(response.parsed_body).to eq("id" => note.id)
    expect(Note.exists?(note.id)).to be(false)
  end
end
