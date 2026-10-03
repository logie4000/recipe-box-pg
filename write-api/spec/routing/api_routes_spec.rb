require "rails_helper"

# /api/v1/* is shared with the Go read-api and split by method: GET/HEAD go
# to Go, everything else comes here. A GET route in this app would never be
# reached in production, so none may exist.
RSpec.describe "API routes" do
  it "defines only write verbs under /api" do
    api_routes = Rails.application.routes.routes.select { |r| r.path.spec.to_s.start_with?("/api/") }

    expect(api_routes).not_to be_empty
    expect(api_routes.map(&:verb).uniq - %w[POST PUT PATCH DELETE]).to be_empty
  end
end
