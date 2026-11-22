# Shopping list: which recipes are on a user's list, and how many servings
# of each (a multiplier: 2 = double, 0.5 = half). One list per user. The
# consolidated ingredients are computed on every read by the read-api, so
# editing a recipe updates every list that includes it.
#
# Rows are private to the user whose list they are on (RLS, same pattern as
# saved_recipes). Deleting the recipe drops it from every list; foreign-key
# actions run as the table owner, so RLS doesn't block the cascade. A recipe
# that stops being shared drops out of other users' lists on read (the
# read-api joins on owner_sub = caller OR is_public).
class CreateShoppingListRecipes < ActiveRecord::Migration[8.1]
  def up
    create_table :shopping_list_recipes do |t|
      t.string :user_sub, null: false
      t.references :recipe, null: false, foreign_key: { on_delete: :cascade }, index: true
      t.decimal :servings, precision: 6, scale: 2, null: false, default: 1
      t.datetime :created_at, null: false
    end
    add_index :shopping_list_recipes, %i[user_sub recipe_id], unique: true

    execute <<~SQL
      ALTER TABLE shopping_list_recipes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE shopping_list_recipes FORCE ROW LEVEL SECURITY;
      CREATE POLICY shopping_list_recipes_owner ON shopping_list_recipes
        USING (user_sub = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_sub = NULLIF(current_setting('app.user_id', true), ''));
    SQL
  end

  def down
    drop_table :shopping_list_recipes
  end
end
