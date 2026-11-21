# Sign-up verification by email. A password sign-up proves its address with a
# six-digit code the write-api emails through SES (Google sign-ins arrive
# already verified and skip this). Only a digest of the code is stored, bound
# to the address it went to; see AccountRequest. The read-api's admin listing
# selects its own columns and never returns these.
class AddEmailVerificationToAccountRequests < ActiveRecord::Migration[8.1]
  def change
    change_table :account_requests, bulk: true do |t|
      t.string :code_digest
      t.string :code_email
      t.datetime :code_sent_at
      t.integer :code_attempts, null: false, default: 0
      # Codes sent since codes_window_started_at, capped per day.
      t.integer :codes_sent, null: false, default: 0
      t.datetime :codes_window_started_at
    end
  end
end
