# Only used when TENANT_MODE=on and the tenancy migration has run
# (`bin/rails generate tenancy`).
class Tenant < ApplicationRecord
  STATUSES = %w[active suspended].freeze

  validates :name, :slug, presence: true
  validates :status, inclusion: { in: STATUSES }

  scope :active, -> { where(status: "active") }
end
