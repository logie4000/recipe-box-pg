require "rails_helper"

# Owner isolation and share links. The test database role owns the table and
# recipes uses FORCE ROW LEVEL SECURITY, so the RLS policies apply here too:
# rows can only be created or read with app.user_id (or app.share_token) set.
RSpec.describe "/api/w/v1/recipes" do
  let(:alice) { auth_headers(sub: "alice-sub") }
  let(:bob) { auth_headers(sub: "bob-sub") }

  def create_recipe(owner_sub, **attrs)
    DbContext.with(user_id: owner_sub) do
      Recipe.create!({ owner_sub: owner_sub, title: "Pancakes", ingredients: [ "2 eggs" ], directions: [ "Whisk" ] }.merge(attrs))
    end
  end

  def as_owner(sub, &block) = DbContext.with(user_id: sub, &block)

  # What the read-api's public share route does: no user, only the token.
  def as_share_viewer(token)
    ActiveRecord::Base.transaction do
      ActiveRecord::Base.connection.select_all(ActiveRecord::Base.sanitize_sql_array([
        "SELECT set_config('app.user_id', '', true), set_config('app.share_token', ?, true)", token.to_s
      ]))
      yield
    end
  end

  describe "create" do
    it "stores the recipe for the caller, tidying the lists" do
      post "/api/w/v1/recipes", headers: alice, as: :json, params: {
        recipe: { title: "Soup", ingredients: [ " 1 onion ", "", "2 carrots" ], directions: [ "Chop", "  " ] }
      }

      expect(response).to have_http_status(:created)
      body = response.parsed_body["recipe"]
      expect(body).to include("title" => "Soup", "ingredients" => [ "1 onion", "2 carrots" ], "directions" => [ "Chop" ],
                              "share_token" => nil, "image_key" => nil)
      expect(body).not_to have_key("owner_sub")
      expect(as_owner("alice-sub") { Recipe.find(body["id"]).owner_sub }).to eq("alice-sub")
    end

    it "ignores an owner_sub or image_key in the body" do
      post "/api/w/v1/recipes", headers: alice, as: :json,
           params: { recipe: { title: "Soup", owner_sub: "bob-sub", image_key: "someone/else.jpg" } }

      expect(response).to have_http_status(:created)
      recipe = as_owner("alice-sub") { Recipe.find(response.parsed_body["id"]) }
      expect([ recipe.owner_sub, recipe.image_key ]).to eq([ "alice-sub", nil ])
    end

    it "rejects a missing title (422) and a missing body (400)" do
      post "/api/w/v1/recipes", headers: alice, as: :json, params: { recipe: { title: "" } }
      expect(response).to have_http_status(:unprocessable_content)

      post "/api/w/v1/recipes", headers: alice, as: :json, params: {}
      expect(response).to have_http_status(:bad_request)
    end

    it "requires a token" do
      post "/api/w/v1/recipes", as: :json, params: { recipe: { title: "Soup" } }
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "owner isolation" do
    let!(:recipe) { create_recipe("alice-sub") }

    it "lets the owner update and delete" do
      patch "/api/w/v1/recipes/#{recipe.id}", headers: alice, as: :json,
            params: { recipe: { title: "Better pancakes", directions: [ "Whisk", "Fry" ] } }
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["recipe"]).to include("title" => "Better pancakes", "ingredients" => [ "2 eggs" ],
                                                        "directions" => [ "Whisk", "Fry" ])

      delete "/api/w/v1/recipes/#{recipe.id}", headers: alice, as: :json
      expect(response).to have_http_status(:ok)
      expect(as_owner("alice-sub") { Recipe.exists?(recipe.id) }).to be(false)
    end

    it "answers 404 to anyone else, for every write, and changes nothing" do
      patch "/api/w/v1/recipes/#{recipe.id}", headers: bob, as: :json, params: { recipe: { title: "Mine now" } }
      expect(response).to have_http_status(:not_found)

      delete "/api/w/v1/recipes/#{recipe.id}", headers: bob, as: :json
      expect(response).to have_http_status(:not_found)

      post "/api/w/v1/recipes/#{recipe.id}/share", headers: bob, as: :json
      expect(response).to have_http_status(:not_found)

      delete "/api/w/v1/recipes/#{recipe.id}/share", headers: bob, as: :json
      expect(response).to have_http_status(:not_found)

      fresh = as_owner("alice-sub") { Recipe.find(recipe.id) }
      expect([ fresh.title, fresh.share_token ]).to eq([ "Pancakes", nil ])
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

  describe "share links" do
    let!(:recipe) { create_recipe("alice-sub") }
    let!(:other) { create_recipe("alice-sub", title: "Not shared") }

    def share!
      post "/api/w/v1/recipes/#{recipe.id}/share", headers: alice, as: :json
      expect(response).to have_http_status(:created)
      response.parsed_body["share_token"]
    end

    it "creates an unguessable token that reads exactly that recipe without login" do
      token = share!
      expect(token).to match(/\A[A-Za-z0-9_-]{43}\z/)

      expect(as_share_viewer(token) { Recipe.pluck(:id) }).to eq([ recipe.id ])
      expect(as_share_viewer("not-the-token") { Recipe.count }).to eq(0)
      expect(as_share_viewer("") { Recipe.count }).to eq(0)
    end

    it "is read-only: the token does not allow changes" do
      token = share!

      expect(as_share_viewer(token) { Recipe.where(id: recipe.id).update_all(title: "Defaced") }).to eq(0)
      expect(as_share_viewer(token) { Recipe.where(id: recipe.id).delete_all }).to eq(0)
      expect(as_owner("alice-sub") { Recipe.find(recipe.id).title }).to eq("Pancakes")
    end

    it "regenerating replaces the token, so the old link stops working" do
      old_token = share!
      new_token = share!

      expect(new_token).not_to eq(old_token)
      expect(as_share_viewer(old_token) { Recipe.count }).to eq(0)
      expect(as_share_viewer(new_token) { Recipe.pluck(:id) }).to eq([ recipe.id ])
    end

    it "revoking clears the token" do
      token = share!

      delete "/api/w/v1/recipes/#{recipe.id}/share", headers: alice, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["share_token"]).to be_nil
      expect(as_share_viewer(token) { Recipe.count }).to eq(0)
    end

    it "is never honoured by the write-api (DbContext clears app.share_token)" do
      token = share!

      found = as_share_viewer(token) do
        DbContext.apply!(user_id: "bob-sub")
        Recipe.where(share_token: token).count
      end
      expect(found).to eq(0)
    end
  end
end
