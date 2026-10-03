# A user's recipe. Every query is scoped to the owner twice: in Ruby
# (Recipe.owned_by) and by the recipes_owner row-level-security policy, so
# another user's id is simply not found (404).
#
# Private by default. With is_public, the recipes_public_read policy lets
# anyone read it without login through the read-api at
# GET /api/v1/public/recipes/:public_id. public_id is a random UUID the
# database assigns, separate from the sequential id, so the public URL can't
# be guessed. Only the owner can ever change the recipe.
class Recipe < ApplicationRecord
  MAX_ITEMS = 200
  MAX_ITEM_LENGTH = 2_000

  scope :owned_by, ->(sub) { where(owner_sub: sub) }

  before_validation :tidy_lists

  validates :owner_sub, presence: true
  validates :title, presence: true, length: { maximum: 200 }
  validates :is_public, inclusion: { in: [ true, false ] }
  validate :lists_within_limits

  def as_json(*)
    super(only: %i[id title ingredients directions image_key is_public public_id created_at updated_at])
  end

  private
    # Strip whitespace and drop blank lines, so ["2 eggs", " "] stores ["2 eggs"].
    def tidy_lists
      self.ingredients = Array(ingredients).map { |s| s.to_s.strip }.compact_blank
      self.directions = Array(directions).map { |s| s.to_s.strip }.compact_blank
    end

    def lists_within_limits
      { ingredients: ingredients, directions: directions }.each do |attr, items|
        errors.add(attr, "has too many items (maximum is #{MAX_ITEMS})") if items.size > MAX_ITEMS
        errors.add(attr, "has an item longer than #{MAX_ITEM_LENGTH} characters") if items.any? { |s| s.length > MAX_ITEM_LENGTH }
      end
    end
end
