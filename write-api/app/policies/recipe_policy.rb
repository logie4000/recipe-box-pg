# Anyone signed in keeps their own recipes. Which rows they can touch is
# enforced by owner scoping in the controller and the recipes_owner
# row-level-security policy, not here.
class RecipePolicy < ApplicationPolicy
  def create? = user.reader?
  def update? = user.reader?
  def destroy? = user.reader?
end
