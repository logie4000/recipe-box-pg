# Email, used only for sign-up verification codes (AccountRequestMailer).
#
#   MAIL_FROM   the sender, e.g. "Recipe Box <no-reply@specialbrewsoftware.com>".
#               In production it must be on an identity verified in SES
#               (docs/email.md). Unset, no codes go out and new password
#               sign-ups wait for an admin.
#   AWS_REGION  the SES region (production delivers with :ses, below)
require_relative "../../lib/delivery/ses_delivery"

Rails.application.config.x.mail_from = ENV["MAIL_FROM"].presence

ActiveSupport.on_load(:action_mailer) do
  add_delivery_method :ses, SesDelivery, region: ENV.fetch("AWS_REGION", "us-east-1")
end
