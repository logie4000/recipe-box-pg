# Any signed-in user has a shopping list. Which rows they can touch is
# enforced by user scoping in the controller and the
# shopping_list_recipes_owner row-level-security policy.
class ShoppingListRecipePolicy < ApplicationPolicy
  def create? = user.reader?
  def update? = user.reader?
  def destroy? = user.reader?
  def clear? = user.reader?
end
