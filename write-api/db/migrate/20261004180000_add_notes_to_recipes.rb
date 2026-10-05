# Free-form notes on a recipe (tips, substitutions, where it came from),
# shown under the share link. Plain text; empty when there are none.
class AddNotesToRecipes < ActiveRecord::Migration[8.1]
  def change
    add_column :recipes, :notes, :text, null: false, default: ""
  end
end
