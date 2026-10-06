require "rails_helper"

# Per-user write limits. Rather than send 120 requests, each example fills the
# caller's counter up to the limit, the way Rails' rate_limit keys it.
RSpec.describe "API write rate limits" do
  let(:alice) { auth_headers(sub: "alice-sub") }
  let(:bob) { auth_headers(sub: "bob-sub") }
  let(:store) { ApplicationController::RATE_LIMIT_STORE }

  def use_up(key, limit) = store.increment(key, limit, expires_in: 1.minute)

  it "refuses a user's writes past the limit with 429 and Retry-After, and leaves other users alone" do
    use_up("rate-limit:api-writes:alice-sub", Rails.configuration.x.rate_limit_writes_per_minute)

    post "/api/v1/recipes", headers: alice, as: :json, params: { recipe: { title: "Soup" } }
    expect(response).to have_http_status(:too_many_requests)
    expect(response.headers["Retry-After"]).to eq("60")
    expect(response.parsed_body["error"]).to eq("rate_limited")
    expect(DbContext.with(user_id: "alice-sub") { Recipe.count }).to eq(0)

    post "/api/v1/recipes", headers: bob, as: :json, params: { recipe: { title: "Soup" } }
    expect(response).to have_http_status(:created)
  end

  it "still answers a missing token with 401, not 429" do
    post "/api/v1/recipes", as: :json, params: { recipe: { title: "Soup" } }
    expect(response).to have_http_status(:unauthorized)
  end

  it "limits photo uploads separately and more tightly than other writes" do
    recipe = DbContext.with(user_id: "alice-sub") { Recipe.create!(owner_sub: "alice-sub", title: "Pancakes") }
    use_up("rate-limit:api/v1/recipe_images:uploads:alice-sub", Rails.configuration.x.rate_limit_uploads_per_minute)

    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: { image: "x" }
    expect(response).to have_http_status(:too_many_requests)

    delete "/api/v1/recipes/#{recipe.id}/image", headers: alice
    expect(response).to have_http_status(:ok)
  end
end
