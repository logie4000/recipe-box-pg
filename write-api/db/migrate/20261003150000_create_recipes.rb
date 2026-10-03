# Recipes: one owner each, isolated by Postgres row-level security (the same
# pattern as private_notes). A recipe is private by default; the owner can
# make it public, and then anyone with its URL can read it without login.
# The public URL uses public_id, a 12-character random alphanumeric code
# (about 71 random bits) that the Recipe model generates, never the
# sequential id, so public recipes can't be found by counting.
#
#   recipes_owner        owner sees and changes only their own rows
#   recipes_public_read  SELECT only: anyone may read rows with is_public.
#                        Writes still go through recipes_owner alone.
#
# NULLIF makes an unset or empty app.user_id match nothing (fails closed).
# image_key is a storage hook for the upload drop zone (later); nothing sets
# it through the API yet.
class CreateRecipes < ActiveRecord::Migration[8.1]
  def up
    create_table :recipes do |t|
      t.string :owner_sub, null: false
      t.string :title, null: false
      t.text :ingredients, array: true, null: false, default: []
      t.text :directions, array: true, null: false, default: []
      t.string :image_key
      t.boolean :is_public, null: false, default: false
      t.string :public_id, null: false
      t.timestamps
    end
    add_index :recipes, %i[owner_sub created_at]
    add_index :recipes, :public_id, unique: true

    execute <<~SQL
      ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
      CREATE POLICY recipes_owner ON recipes
        USING (owner_sub = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (owner_sub = NULLIF(current_setting('app.user_id', true), ''));
      CREATE POLICY recipes_public_read ON recipes FOR SELECT
        USING (is_public);
    SQL
  end

  def down
    drop_table :recipes
  end
end
