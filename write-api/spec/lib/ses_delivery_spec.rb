require "rails_helper"
require "aws-sdk-sesv2"

RSpec.describe SesDelivery do
  it "sends the whole MIME message through SESv2" do
    client = Aws::SESV2::Client.new(region: "us-east-1", stub_responses: true)
    allow(Aws::SESV2::Client).to receive(:new).with(region: "us-east-1").and_return(client)
    mail = Mail.new(from: "no-reply@example.test", to: "nina@example.test", subject: "123456 is your code", body: "hi")

    described_class.new(region: "us-east-1").deliver!(mail)

    sent = client.api_requests.sole
    expect(sent[:operation_name]).to eq(:send_email)
    expect(sent[:params].dig(:content, :raw, :data)).to include("To: nina@example.test", "Subject: 123456 is your code")
  end

  it "is the production delivery method" do
    expect(ActionMailer::Base.delivery_methods).to include(ses: described_class)
  end
end
