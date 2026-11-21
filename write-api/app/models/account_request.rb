# A signed-up user who isn't in yet. See the create_account_requests and
# add_email_verification_to_account_requests migrations.
#
# A password sign-up gets in by entering the six-digit code emailed to it
# (EmailCode: #issue_code! and #check_code!); an admin can still approve or
# decline anyone waiting on the Approvals page.
class AccountRequest < ApplicationRecord
  include EmailCode
  self.code_purpose = "account-request-code"

  validates :user_sub, presence: true
  validates :email, length: { maximum: 255 }
  validates :name, length: { maximum: 255 }

  def as_json(*)
    super(only: %i[id email name created_at])
  end
end
