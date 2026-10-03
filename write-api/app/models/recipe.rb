# A user's recipe. Every query is scoped to the owner twice: in Ruby
# (Recipe.owned_by) and by the recipes_owner row-level-security policy, so
# another user's id is simply not found (404).
#
# share_token, when set, gives read-only access to this one recipe without
# login through the read-api (GET /api/v1/shared/recipes/:token). It is 256
# random bits, URL-safe; regenerating replaces it and revoking clears it, so
# old links stop working immediately.
class Recipe < ApplicationRecord
  MAX_ITEMS = 200
  MAX_ITEM_LENGTH = 2_000
  SHARE_TOKEN_BYTES = 32 # 43 URL-safe base64 characters

  scope :owned_by, ->(sub) { where(owner_sub: sub) }

  before_validation :tidy_lists

  validates :owner_sub, presence: true
  validates :title, presence: true, length: { maximum: 200 }
  validate :lists_within_limits

  def self.generate_share_token = SecureRandom.urlsafe_base64(SHARE_TOKEN_BYTES)

  def regenerate_share_token!
    update!(share_token: self.class.generate_share_token)
  end

  def revoke_share_token!
    update!(share_token: nil)
  end

  def as_json(*)
    super(only: %i[id title ingredients directions image_key share_token created_at updated_at])
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
