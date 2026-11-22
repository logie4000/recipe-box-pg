# One recipe on a user's shopping list, with a servings multiplier (2 =
# double, 0.5 = half). Visible only to the list's owner
# (shopping_list_recipes_owner RLS policy). The read-api joins these to
# recipes the caller may still read and consolidates the ingredients.
class ShoppingListRecipe < ApplicationRecord
  MAX_PER_USER = 50
  SERVINGS_RANGE = (0.25..20)

  belongs_to :recipe

  validates :user_sub, presence: true
  validates :servings, numericality: { greater_than_or_equal_to: SERVINGS_RANGE.min, less_than_or_equal_to: SERVINGS_RANGE.max }
  validate :list_within_limit, on: :create

  private
    # Counts through RLS too, so only the owner's rows are ever seen. The
    # controller takes the per-user lock first, so two adds at once can't
    # both squeeze under the limit.
    def list_within_limit
      return if self.class.where(user_sub: user_sub).count < MAX_PER_USER

      errors.add(:base, "Your shopping list can hold at most #{MAX_PER_USER} recipes. Remove some to add more.")
    end
end
