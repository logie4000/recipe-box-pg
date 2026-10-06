# A signed-up user waiting for an admin to let them in. See the
# create_account_requests migration.
class AccountRequest < ApplicationRecord
  validates :user_sub, presence: true
  validates :email, length: { maximum: 255 }
  validates :name, length: { maximum: 255 }

  def as_json(*)
    super(only: %i[id email name created_at])
  end
end
