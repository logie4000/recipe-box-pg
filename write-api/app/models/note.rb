# Example resource. Written here, read through the Go read-api.
class Note < ApplicationRecord
  acts_as_tenant(:tenant) if Tenancy.enabled?

  validates :title, presence: true, length: { maximum: 200 }
  validates :body, length: { maximum: 20_000 }
  validates :author_sub, presence: true

  def as_json(*)
    super(only: %i[id title body author_sub created_at updated_at])
  end
end
