# A user's recipe. Every query is scoped to the owner twice: in Ruby
# (Recipe.owned_by) and by the recipes_owner row-level-security policy, so
# another user's id is simply not found (404).
#
# Private by default. With is_public, the recipes_public_read policy lets
# anyone read it without login through the read-api at
# GET /api/v1/public/recipes/:public_id. public_id is a 12-character random
# alphanumeric code (about 71 bits), separate from the sequential id, so the
# public URL can't be guessed. It is set once, on create, and never changes.
# Only the owner can ever change the recipe.
class Recipe < ApplicationRecord
  MAX_ITEMS = 200
  MAX_ITEM_LENGTH = 2_000
  MAX_NOTES_LENGTH = 10_000
  PUBLIC_ID_LENGTH = 12
  PUBLIC_ID_FORMAT = /\A[A-Za-z0-9]{#{PUBLIC_ID_LENGTH}}\z/
  PUBLIC_ID_ATTEMPTS = 5

  scope :owned_by, ->(sub) { where(owner_sub: sub) }

  attr_readonly :public_id

  before_validation :tidy_lists
  before_validation -> { self.public_id ||= self.class.generate_public_id }, on: :create

  validates :owner_sub, presence: true
  validates :title, presence: true, length: { maximum: 200 }
  validates :notes, length: { maximum: MAX_NOTES_LENGTH }
  validates :is_public, inclusion: { in: [ true, false ] }
  validates :public_id, format: { with: PUBLIC_ID_FORMAT }
  validates :image_key, format: { with: ImageStore::KEY_FORMAT }, allow_nil: true
  validate :lists_within_limits

  # The photo file goes once the change is committed: the old one when it is
  # replaced or removed (Api::V1::RecipeImagesController), and the current one
  # when the recipe is deleted.
  after_update_commit -> { delete_image(image_key_before_last_save) }, if: :saved_change_to_image_key?
  after_destroy_commit -> { delete_image(image_key) }

  def self.generate_public_id = SecureRandom.alphanumeric(PUBLIC_ID_LENGTH)

  # save, but if the random public_id collides with an existing one (the
  # unique index says so), draw a new one and try again. A uniqueness
  # validation can't do this check: RLS hides other users' rows from the
  # query. The savepoint keeps the request transaction usable after the error.
  def save_with_unique_public_id
    attempts = 0
    begin
      self.class.transaction(requires_new: true) { save }
    rescue ActiveRecord::RecordNotUnique => e
      raise unless new_record? && e.message.include?("index_recipes_on_public_id") && (attempts += 1) < PUBLIC_ID_ATTEMPTS

      self.public_id = self.class.generate_public_id
      retry
    end
  end

  def as_json(*)
    super(only: %i[id title ingredients directions notes image_key is_public public_id created_at updated_at])
  end

  private
    def delete_image(key)
      ImageStore.current.delete(key) if key
    end

    # Strip whitespace and drop blank lines, so ["2 eggs", " "] stores ["2 eggs"].
    def tidy_lists
      self.ingredients = Array(ingredients).map { |s| s.to_s.strip }.compact_blank
      self.directions = Array(directions).map { |s| s.to_s.strip }.compact_blank
      self.notes = notes.to_s.strip
    end

    def lists_within_limits
      { ingredients: ingredients, directions: directions }.each do |attr, items|
        errors.add(attr, "has too many items (maximum is #{MAX_ITEMS})") if items.size > MAX_ITEMS
        errors.add(attr, "has an item longer than #{MAX_ITEM_LENGTH} characters") if items.any? { |s| s.length > MAX_ITEM_LENGTH }
      end
    end
end
