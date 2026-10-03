# Example of per-user rows enforced by Postgres row-level security: the
# policy only exposes rows whose owner_sub = current_setting('app.user_id').
class PrivateNote < ApplicationRecord
  validates :body, presence: true, length: { maximum: 20_000 }
  validates :owner_sub, presence: true

  def as_json(*)
    super(only: %i[id body created_at updated_at])
  end
end
