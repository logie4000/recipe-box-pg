# A user's bookmark of someone else's shared recipe. Visible only to the user
# who saved it (saved_recipes_owner RLS policy). The read-api lists them,
# joined to recipes on is_public, so unshared recipes drop out of the list.
class SavedRecipe < ApplicationRecord
  belongs_to :recipe

  validates :user_sub, presence: true
end
