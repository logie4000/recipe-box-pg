require "rails_helper"

# The shopping list's recipes. shopping_list_recipes uses FORCE ROW LEVEL
# SECURITY, so rows are only visible with their user's app.user_id set, here
# as in production.
RSpec.describe "/api/v1/shopping-list" do
  let(:bob) { auth_headers(sub: "bob-sub") }
  let(:carol) { auth_headers(sub: "carol-sub") }

  def create_recipe(owner_sub, **attrs)
    DbContext.with(user_id: owner_sub) do
      Recipe.create!({ owner_sub: owner_sub, title: "Soup" }.merge(attrs))
    end
  end

  def list_of(sub)
    DbContext.with(user_id: sub) { ShoppingListRecipe.order(:id).pluck(:recipe_id, :servings).map { |id, s| [ id, s.to_f ] } }
  end

  def add(headers, public_id, **body)
    post "/api/v1/shopping-list/recipes", headers: headers, as: :json, params: { public_id: public_id }.merge(body)
  end

  let!(:soup) { create_recipe("alice-sub", is_public: true) }

  it "adds a shared recipe with 1 serving by default" do
    add(bob, soup.public_id)
    expect(response).to have_http_status(:created)
    expect(response.parsed_body).to eq("public_id" => soup.public_id, "servings" => 1.0, "on_list" => true)
    expect(list_of("bob-sub")).to eq([ [ soup.id, 1.0 ] ])
  end

  it "adds the caller's own private recipe" do
    mine = create_recipe("bob-sub", title: "Bob's stew")
    add(bob, mine.public_id, servings: 0.5)
    expect(response).to have_http_status(:created)
    expect(list_of("bob-sub")).to eq([ [ mine.id, 0.5 ] ])
  end

  it "answers 404 for other people's private recipes and unknown ones, and adds nothing" do
    private_one = create_recipe("alice-sub")
    [ private_one.public_id, "NoSuchRecipe" ].each do |code|
      add(bob, code)
      expect(response).to have_http_status(:not_found)
    end
    expect(list_of("bob-sub")).to be_empty
  end

  it "updates the servings when the recipe is added again, keeping one row" do
    add(bob, soup.public_id, servings: 2)
    add(bob, soup.public_id, servings: 3.5)
    expect(response).to have_http_status(:created)
    expect(response.parsed_body["servings"]).to eq(3.5)
    add(bob, soup.public_id)
    expect(list_of("bob-sub")).to eq([ [ soup.id, 3.5 ] ])
  end

  it "changes servings with PATCH, and 404s for a recipe not on the list" do
    add(bob, soup.public_id)
    patch "/api/v1/shopping-list/recipes/#{soup.public_id}", headers: bob, as: :json, params: { servings: 2 }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("public_id" => soup.public_id, "servings" => 2.0, "on_list" => true)

    patch "/api/v1/shopping-list/recipes/#{soup.public_id}", headers: carol, as: :json, params: { servings: 2 }
    expect(response).to have_http_status(:not_found)
    expect(list_of("carol-sub")).to be_empty
  end

  it "rejects servings outside 0.25..20 or not a number with 422" do
    [ 0, 0.2, 20.5, -1, "lots", nil ].each do |servings|
      add(bob, soup.public_id, servings: servings)
      expect(response).to have_http_status(:unprocessable_content), "servings #{servings.inspect}: #{response.status}"
      expect(response.parsed_body).to include("error" => "invalid")
      expect(response.parsed_body["errors"]).to have_key("servings")
    end
    expect(list_of("bob-sub")).to be_empty

    add(bob, soup.public_id)
    patch "/api/v1/shopping-list/recipes/#{soup.public_id}", headers: bob, as: :json, params: { servings: 25 }
    expect(response).to have_http_status(:unprocessable_content)
    patch "/api/v1/shopping-list/recipes/#{soup.public_id}", headers: bob, as: :json, params: {}
    expect(response).to have_http_status(:unprocessable_content)
    expect(list_of("bob-sub")).to eq([ [ soup.id, 1.0 ] ])
  end

  it "accepts the edges of the servings range" do
    [ 0.25, 20 ].each do |servings|
      add(bob, soup.public_id, servings: servings)
      expect(response).to have_http_status(:created)
    end
  end

  it "holds at most #{ShoppingListRecipe::MAX_PER_USER} recipes" do
    recipes = DbContext.with(user_id: "bob-sub") do
      Array.new(ShoppingListRecipe::MAX_PER_USER + 1) { |i| Recipe.create!(owner_sub: "bob-sub", title: "R#{i}") }
    end
    DbContext.with(user_id: "bob-sub") do
      recipes.first(ShoppingListRecipe::MAX_PER_USER).each { |r| ShoppingListRecipe.create!(user_sub: "bob-sub", recipe: r) }
    end

    add(bob, recipes.last.public_id)
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to have_key("base")

    # Changing servings on a recipe already there is still fine.
    add(bob, recipes.first.public_id, servings: 2)
    expect(response).to have_http_status(:created)
  end

  it "removes only the caller's row, and removing again is fine" do
    [ bob, carol ].each { |h| add(h, soup.public_id) }

    2.times do
      delete "/api/v1/shopping-list/recipes/#{soup.public_id}", headers: bob
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("public_id" => soup.public_id, "on_list" => false)
    end
    delete "/api/v1/shopping-list/recipes/NoSuchRecipe", headers: bob
    expect(response).to have_http_status(:ok)

    expect(list_of("bob-sub")).to be_empty
    expect(list_of("carol-sub")).to eq([ [ soup.id, 1.0 ] ])
  end

  it "clears only the caller's list" do
    stew = create_recipe("alice-sub", title: "Stew", is_public: true)
    [ soup, stew ].each { |r| add(bob, r.public_id) }
    add(carol, soup.public_id)

    delete "/api/v1/shopping-list", headers: bob
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("cleared" => 2)
    expect(list_of("bob-sub")).to be_empty
    expect(list_of("carol-sub")).to eq([ [ soup.id, 1.0 ] ])

    delete "/api/v1/shopping-list", headers: bob
    expect(response.parsed_body).to eq("cleared" => 0)
  end

  it "keeps each user's list hidden from everyone else (RLS)" do
    add(bob, soup.public_id)
    expect(DbContext.with(user_id: "carol-sub") { ShoppingListRecipe.count }).to eq(0)
    expect(DbContext.with(user_id: nil) { ShoppingListRecipe.count }).to eq(0)
    expect(DbContext.with(user_id: "bob-sub") { ShoppingListRecipe.count }).to eq(1)
  end

  it "won't let RLS be sidestepped by writing a row for someone else" do
    expect {
      DbContext.with(user_id: "carol-sub") { ShoppingListRecipe.create!(user_sub: "bob-sub", recipe: soup) }
    }.to raise_error(ActiveRecord::StatementInvalid, /row-level security/)
  end

  it "goes away with the recipe" do
    add(bob, soup.public_id)
    delete "/api/v1/recipes/#{soup.id}", headers: auth_headers(sub: "alice-sub")
    expect(response).to have_http_status(:ok)
    expect(list_of("bob-sub")).to be_empty
  end

  it "requires a token" do
    add({}, soup.public_id)
    expect(response).to have_http_status(:unauthorized)
    delete "/api/v1/shopping-list"
    expect(response).to have_http_status(:unauthorized)
  end
end
