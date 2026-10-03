require "rails_helper"

RSpec.describe Oidc::TokenVerifier do
  let(:jwks) { ->(_opts = {}) { AuthHelpers.jwks } }

  def verify(token) = described_class.verify(token, jwks: jwks)

  it "returns the claims of a valid token" do
    expect(verify(token_for(sub: "abc"))["sub"]).to eq("abc")
  end

  it "rejects the wrong audience" do
    expect { verify(token_for(aud: "someone-else")) }.to raise_error(JWT::InvalidAudError)
  end

  it "rejects the wrong issuer" do
    expect { verify(token_for(iss: "https://evil.example/realms/app")) }.to raise_error(JWT::InvalidIssuerError)
  end

  it "rejects expired tokens" do
    expect { verify(token_for(exp: 5.minutes.ago.to_i)) }.to raise_error(JWT::ExpiredSignature)
  end

  it "rejects tokens signed by another key" do
    other = JWT::JWK.new(OpenSSL::PKey::RSA.new(2048), kid: "test-key")
    token = JWT.encode({ sub: "x", exp: 1.minute.from_now.to_i }, other.signing_key, "RS256", kid: "test-key")
    expect { verify(token) }.to raise_error(JWT::VerificationError)
  end
end
