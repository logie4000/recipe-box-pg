# A six-digit code emailed to prove an address, for AccountRequest (sign-up).
# Needs the columns code_digest, code_email, code_sent_at, code_attempts,
# codes_sent and codes_window_started_at, plus user_sub. (Sweat Equity shares
# it with its profile changes; Recipe Box has only sign-ups.)
#
# Only an HMAC of the code is stored, keyed per model (code_purpose), and it
# is good for one address, CODE_TTL and MAX_ATTEMPTS guesses.
module EmailCode
  extend ActiveSupport::Concern

  CODE_TTL = 15.minutes
  RESEND_AFTER = 1.minute
  MAX_ATTEMPTS = 5
  # Codes per account per day, so the form can't be used to flood an inbox.
  MAX_CODES_PER_DAY = 5

  # Raised by issue_code!; #message says what to tell the user.
  class TooSoon < StandardError; end

  included do
    # The key generator purpose for the HMAC, different for each model.
    class_attribute :code_purpose, instance_writer: false
  end

  # Starts a new code for `email` and returns it (to be emailed, never
  # stored). Saves any other changes to the record too.
  def issue_code!(email, now: Time.current)
    if code_sent_at && code_sent_at > now - RESEND_AFTER
      raise TooSoon, "We just sent a code. Wait a minute before asking for another."
    end
    if codes_window_started_at.nil? || codes_window_started_at < now - 1.day
      self.codes_window_started_at = now
      self.codes_sent = 0
    end
    raise TooSoon, "That's a lot of codes for one day. Try again tomorrow." if codes_sent >= MAX_CODES_PER_DAY

    code = format("%06d", SecureRandom.random_number(1_000_000))
    update!(code_digest: code_digest_for(code), code_email: email, code_sent_at: now, code_attempts: 0, codes_sent: codes_sent + 1)
    code
  end

  def code_live?(now: Time.current) = code_digest.present? && code_sent_at > now - CODE_TTL

  def attempts_left = [ MAX_ATTEMPTS - code_attempts, 0 ].max

  # True when `code` is the live code and `email` is still the address it was
  # sent to. Every try counts; after MAX_ATTEMPTS the code is dead.
  def check_code!(code, email, now: Time.current)
    return false unless code_live?(now:) && attempts_left.positive?

    increment!(:code_attempts)
    code_email.to_s.casecmp?(email.to_s) &&
      ActiveSupport::SecurityUtils.secure_compare(code_digest_for(code.to_s.gsub(/\s/, "")), code_digest)
  end

  # What to tell the user after check_code! says no.
  def code_rejection
    if code_live? && attempts_left.positive?
      "That code didn't work. Check it and try again."
    else
      "That code has expired. Send a new one."
    end
  end

  private
    def code_digest_for(code)
      key = Rails.application.key_generator.generate_key(code_purpose)
      OpenSSL::HMAC.hexdigest("SHA256", key, "#{user_sub}:#{code}")
    end
end
