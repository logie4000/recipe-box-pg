# Action Mailer delivery method for Amazon SES (SESv2 SendEmail with the raw
# MIME message). Credentials come from the default AWS chain, which on Denali
# is the EC2 instance role, so there are no SMTP passwords to keep.
#
#   config.action_mailer.delivery_method = :ses   (config/initializers/mail.rb)
class SesDelivery
  attr_accessor :settings

  def initialize(settings)
    @settings = settings
  end

  def deliver!(mail)
    client.send_email(content: { raw: { data: mail.encoded } })
  end

  private
    def client
      require "aws-sdk-sesv2"
      @client ||= Aws::SESV2::Client.new(region: settings.fetch(:region))
    end
end
