# Any signed-in user can save shared recipes. Which bookmarks they can touch
# is enforced by user scoping in the controller and the saved_recipes_owner
# row-level-security policy.
class SavedRecipePolicy < ApplicationPolicy
  def create? = user.reader?
  def destroy? = user.reader?
end
