require "rails_helper"

# Owner isolation and public/private. The test database role owns the table
# and recipes uses FORCE ROW LEVEL SECURITY, so the RLS policies apply here
# too: rows can only be created or changed with the owner's app.user_id set,
# and read by others only when is_public.
RSpec.describe "/api/v1/recipes" do
  let(:alice) { auth_headers(sub: "alice-sub") }
  let(:bob) { auth_headers(sub: "bob-sub") }

  def create_recipe(owner_sub, **attrs)
    DbContext.with(user_id: owner_sub) do
      Recipe.create!({ owner_sub: owner_sub, title: "Pancakes", ingredients: [ "2 eggs" ], directions: [ "Whisk" ] }.merge(attrs))
    end
  end

  UUID_FORMAT = /\A\h{8}-\h{4}-4\h{3}-[89ab]\h{3}-\h{12}\z/

  def as_owner(sub, &block) = DbContext.with(user_id: sub, &block)

  # What the read-api's public route does: no user at all.
  def as_anonymous(&block) = DbContext.with(user_id: nil, &block)

  describe "create" do
    it "stores the recipe for the caller, tidying the lists" do
      post "/api/v1/recipes", headers: alice, as: :json, params: {
        recipe: { title: "Soup", ingredients: [ " 1 onion ", "", "2 carrots" ], directions: [ "Chop", "  " ] }
      }

      expect(response).to have_http_status(:created)
      body = response.parsed_body["recipe"]
      expect(body).to include("title" => "Soup", "ingredients" => [ "1 onion", "2 carrots" ], "directions" => [ "Chop" ],
                              "is_public" => false, "image_key" => nil)
      expect(body).not_to have_key("owner_sub")
      expect(body["public_id"]).to match(UUID_FORMAT)
      expect(as_owner("alice-sub") { Recipe.find(body["id"]).owner_sub }).to eq("alice-sub")
    end

    it "ignores an owner_sub, image_key or public_id in the body" do
      chosen = "00000000-0000-4000-8000-000000000000"
      post "/api/v1/recipes", headers: alice, as: :json,
           params: { recipe: { title: "Soup", owner_sub: "bob-sub", image_key: "someone/else.jpg", public_id: chosen } }

      expect(response).to have_http_status(:created)
      recipe = as_owner("alice-sub") { Recipe.find(response.parsed_body["id"]) }
      expect([ recipe.owner_sub, recipe.image_key ]).to eq([ "alice-sub", nil ])
      expect(recipe.public_id).to match(UUID_FORMAT)
      expect(recipe.public_id).not_to eq(chosen)
    end

    it "gives every recipe its own random public_id" do
      ids = Array.new(3) { create_recipe("alice-sub").public_id }
      expect(ids.uniq.size).to eq(3)
      expect(ids).to all(match(UUID_FORMAT))
    end

    it "rejects a missing title (422) and a missing body (400)" do
      post "/api/v1/recipes", headers: alice, as: :json, params: { recipe: { title: "" } }
      expect(response).to have_http_status(:unprocessable_content)

      post "/api/v1/recipes", headers: alice, as: :json, params: {}
      expect(response).to have_http_status(:bad_request)
    end

    it "requires a token" do
      post "/api/v1/recipes", as: :json, params: { recipe: { title: "Soup" } }
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "owner isolation" do
    let!(:recipe) { create_recipe("alice-sub") }

    it "lets the owner update and delete" do
      patch "/api/v1/recipes/#{recipe.id}", headers: alice, as: :json,
            params: { recipe: { title: "Better pancakes", directions: [ "Whisk", "Fry" ] } }
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["recipe"]).to include("title" => "Better pancakes", "ingredients" => [ "2 eggs" ],
                                                        "directions" => [ "Whisk", "Fry" ])

      delete "/api/v1/recipes/#{recipe.id}", headers: alice, as: :json
      expect(response).to have_http_status(:ok)
      expect(as_owner("alice-sub") { Recipe.exists?(recipe.id) }).to be(false)
    end

    it "answers 404 to anyone else, for every write, and changes nothing" do
      patch "/api/v1/recipes/#{recipe.id}", headers: bob, as: :json, params: { recipe: { title: "Mine now" } }
      expect(response).to have_http_status(:not_found)

      delete "/api/v1/recipes/#{recipe.id}", headers: bob, as: :json
      expect(response).to have_http_status(:not_found)

      patch "/api/v1/recipes/#{recipe.id}", headers: bob, as: :json, params: { recipe: { is_public: true } }
      expect(response).to have_http_status(:not_found)

      fresh = as_owner("alice-sub") { Recipe.find(recipe.id) }
      expect([ fresh.title, fresh.is_public ]).to eq([ "Pancakes", false ])
    end

    it "hides other users' rows in the database itself (RLS), not just in the controller" do
      create_recipe("bob-sub", title: "Bob's chili")

      expect(as_owner("bob-sub") { Recipe.pluck(:title) }).to eq([ "Bob's chili" ])
      expect(as_owner("alice-sub") { Recipe.pluck(:title) }).to eq([ "Pancakes" ])
      expect(as_owner(nil) { Recipe.count }).to eq(0)
      expect { as_owner("bob-sub") { Recipe.find(recipe.id) } }.to raise_error(ActiveRecord::RecordNotFound)
      expect(as_owner("bob-sub") { Recipe.where(id: recipe.id).update_all(title: "x") }).to eq(0)
      expect(as_owner("bob-sub") { Recipe.where(id: recipe.id).delete_all }).to eq(0)
    end

    it "refuses to write a row owned by someone else" do
      expect {
        as_owner("bob-sub") { Recipe.create!(owner_sub: "alice-sub", title: "Planted") }
      }.to raise_error(ActiveRecord::StatementInvalid, /row-level security/)
    end
  end

  describe "public and private" do
    let!(:recipe) { create_recipe("alice-sub") }
    let!(:other) { create_recipe("alice-sub", title: "Still private") }

    def make_public!(value = true)
      patch "/api/v1/recipes/#{recipe.id}", headers: alice, as: :json, params: { recipe: { is_public: value } }
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["recipe"]["is_public"]).to be(value)
    end

    it "is private by default: no one else can read it, signed in or not" do
      expect(as_anonymous { Recipe.count }).to eq(0)
      expect(as_owner("bob-sub") { Recipe.count }).to eq(0)
    end

    it "once public, can be read without login by its public_id, and only that recipe" do
      make_public!

      expect(as_anonymous { Recipe.find_by(public_id: recipe.public_id)&.title }).to eq("Pancakes")
      expect(as_anonymous { Recipe.find_by(public_id: other.public_id) }).to be_nil
      expect(as_anonymous { Recipe.pluck(:id) }).to eq([ recipe.id ])
      expect(as_owner("bob-sub") { Recipe.pluck(:id) }).to eq([ recipe.id ])
    end

    it "keeps the same public_id across edits and visibility changes" do
      make_public!
      patch "/api/v1/recipes/#{recipe.id}", headers: alice, as: :json, params: { recipe: { title: "Renamed" } }
      make_public!(false)

      expect(response.parsed_body["recipe"]["public_id"]).to eq(recipe.public_id)
    end

    it "stays read-only for everyone but the owner" do
      make_public!

      expect(as_anonymous { Recipe.where(id: recipe.id).update_all(title: "Defaced") }).to eq(0)
      expect(as_owner("bob-sub") { Recipe.where(id: recipe.id).update_all(title: "Defaced") }).to eq(0)
      expect(as_owner("bob-sub") { Recipe.where(id: recipe.id).delete_all }).to eq(0)

      patch "/api/v1/recipes/#{recipe.id}", headers: bob, as: :json, params: { recipe: { title: "Defaced" } }
      expect(response).to have_http_status(:not_found)
      delete "/api/v1/recipes/#{recipe.id}", headers: bob, as: :json
      expect(response).to have_http_status(:not_found)

      expect(as_owner("alice-sub") { Recipe.find(recipe.id).title }).to eq("Pancakes")
    end

    it "does not appear in another user's own collection" do
      make_public!

      expect(as_owner("bob-sub") { Recipe.owned_by("bob-sub").count }).to eq(0)
    end

    it "can be made private again, which hides it at once" do
      make_public!
      make_public!(false)

      expect(as_anonymous { Recipe.count }).to eq(0)
    end

    it "rejects a null visibility" do
      patch "/api/v1/recipes/#{recipe.id}", headers: alice, as: :json, params: { recipe: { is_public: nil } }
      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
