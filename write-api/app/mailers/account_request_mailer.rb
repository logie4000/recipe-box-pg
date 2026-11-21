# The six-digit code a password sign-up enters to prove its email address.
class AccountRequestMailer < ApplicationMailer
  def verification_code(email:, name:, code:)
    @name = name.presence
    @code = code
    @minutes = AccountRequest::CODE_TTL.in_minutes.to_i
    mail(to: email, subject: "#{code} is your Recipe Box code")
  end
end
