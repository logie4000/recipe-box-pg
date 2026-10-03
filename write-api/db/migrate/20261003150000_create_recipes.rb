# Recipes: one owner each, isolated by Postgres row-level security (the same
# pattern as private_notes), plus an optional share token for read-only
# access by URL without login.
#
#   recipes_owner        owner sees and changes only their own rows
#   recipes_shared_read  SELECT only, for the one row whose share_token equals
#                        app.share_token. Only the read-api's public share
#                        route sets it; the write-api always clears it.
#
# NULLIF makes an unset or empty setting match nothing (fails closed).
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
      t.string :share_token
      t.timestamps
    end
    add_index :recipes, %i[owner_sub created_at]
    add_index :recipes, :share_token, unique: true

    execute <<~SQL
      ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
      CREATE POLICY recipes_owner ON recipes
        USING (owner_sub = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (owner_sub = NULLIF(current_setting('app.user_id', true), ''));
      CREATE POLICY recipes_shared_read ON recipes FOR SELECT
        USING (share_token = NULLIF(current_setting('app.share_token', true), ''));
    SQL
  end

  def down
    drop_table :recipes
  end
end
