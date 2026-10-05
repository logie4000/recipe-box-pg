require "rails_helper"

# Saving (bookmarking) other people's shared recipes. saved_recipes uses
# FORCE ROW LEVEL SECURITY, so rows are only visible with their user's
# app.user_id set, here as in production.
RSpec.describe "/api/v1/saved-recipes" do
  let(:bob) { auth_headers(sub: "bob-sub") }

  def create_recipe(owner_sub, **attrs)
    DbContext.with(user_id: owner_sub) do
      Recipe.create!({ owner_sub: owner_sub, title: "Soup" }.merge(attrs))
    end
  end

  def saved_by(sub) = DbContext.with(user_id: sub) { SavedRecipe.pluck(:recipe_id) }

  let!(:soup) { create_recipe("alice-sub", is_public: true) }

  it "saves someone else's shared recipe, once, however often it's asked" do
    2.times do
      post "/api/v1/saved-recipes", headers: bob, as: :json, params: { public_id: soup.public_id }
      expect(response).to have_http_status(:created)
    end
    expect(response.parsed_body).to include("public_id" => soup.public_id, "saved" => true)
    expect(saved_by("bob-sub")).to eq([ soup.id ])
  end

  it "answers 404 for private and unknown recipes, and saves nothing" do
    private_one = create_recipe("alice-sub")
    [ private_one.public_id, "NoSuchRecipe" ].each do |code|
      post "/api/v1/saved-recipes", headers: bob, as: :json, params: { public_id: code }
      expect(response).to have_http_status(:not_found)
    end
    expect(saved_by("bob-sub")).to be_empty
  end

  it "won't save the caller's own recipe" do
    post "/api/v1/saved-recipes", headers: auth_headers(sub: "alice-sub"), as: :json, params: { public_id: soup.public_id }
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "unsaves only the caller's bookmark" do
    [ "bob-sub", "carol-sub" ].each do |sub|
      post "/api/v1/saved-recipes", headers: auth_headers(sub: sub), as: :json, params: { public_id: soup.public_id }
    end

    delete "/api/v1/saved-recipes/#{soup.public_id}", headers: bob
    expect(response).to have_http_status(:ok)
    expect(saved_by("bob-sub")).to be_empty
    expect(saved_by("carol-sub")).to eq([ soup.id ])
  end

  it "keeps each user's bookmarks hidden from everyone else (RLS)" do
    post "/api/v1/saved-recipes", headers: bob, as: :json, params: { public_id: soup.public_id }
    expect(DbContext.with(user_id: "carol-sub") { SavedRecipe.count }).to eq(0)
    expect(DbContext.with(user_id: nil) { SavedRecipe.count }).to eq(0)
  end

  it "goes away with the recipe" do
    post "/api/v1/saved-recipes", headers: bob, as: :json, params: { public_id: soup.public_id }
    delete "/api/v1/recipes/#{soup.id}", headers: auth_headers(sub: "alice-sub")
    expect(response).to have_http_status(:ok)
    expect(saved_by("bob-sub")).to be_empty
  end

  it "requires a token" do
    post "/api/v1/saved-recipes", as: :json, params: { public_id: soup.public_id }
    expect(response).to have_http_status(:unauthorized)
  end
end
