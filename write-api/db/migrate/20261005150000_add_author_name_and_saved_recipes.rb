# Public recipe browsing and "Saved" recipes.
#
# recipes.author_name: the owner's display name (token name, or username),
# copied on every create and update so the public list can group by author
# without a users table. Null until the owner next saves the recipe.
#
# saved_recipes: a user's bookmarks of other people's shared recipes. A
# bookmark, not a copy: the recipe stays the author's, and it drops out of
# the Saved list while it isn't shared (the read-api joins on is_public).
# Rows are private to the user who saved them (RLS, same pattern as
# recipes_owner). Deleting the recipe deletes its bookmarks; foreign-key
# actions run as the table owner, so RLS doesn't block the cascade.
class AddAuthorNameAndSavedRecipes < ActiveRecord::Migration[8.1]
  def up
    add_column :recipes, :author_name, :string

    create_table :saved_recipes do |t|
      t.string :user_sub, null: false
      t.references :recipe, null: false, foreign_key: { on_delete: :cascade }, index: true
      t.datetime :created_at, null: false
    end
    add_index :saved_recipes, %i[user_sub recipe_id], unique: true

    execute <<~SQL
      ALTER TABLE saved_recipes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE saved_recipes FORCE ROW LEVEL SECURITY;
      CREATE POLICY saved_recipes_owner ON saved_recipes
        USING (user_sub = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_sub = NULLIF(current_setting('app.user_id', true), ''));
    SQL
  end

  def down
    drop_table :saved_recipes
    remove_column :recipes, :author_name
  end
end
