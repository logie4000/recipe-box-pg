# Size of the stored photo, for the per-user photo storage limit
# (RecipeImagesController). Null when there is no photo, and for photos
# uploaded before this column: those count as nothing until replaced. (A
# backfill would have to read every file as each owner, since recipes has
# FORCE ROW LEVEL SECURITY; web uploads are resized to ~2000px, so they are
# small anyway.)
class AddImageBytesToRecipes < ActiveRecord::Migration[8.1]
  def change
    add_column :recipes, :image_bytes, :integer
  end
end
