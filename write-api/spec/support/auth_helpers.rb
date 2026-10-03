# Signs test access tokens with a throwaway RSA key and points the verifier's
# JWKS loader at it, so specs exercise the real signature/iss/aud checks.
module AuthHelpers
  TEST_KEY = JWT::JWK.new(OpenSSL::PKey::RSA.new(2048), kid: "test-key")

  def self.jwks = { keys: [ TEST_KEY.export ] }

  def token_for(sub: "user-#{SecureRandom.hex(4)}", roles: %w[reader], **overrides)
    config = Rails.configuration.x.oidc
    claims = {
      iss: config.issuer,
      aud: [ config.audience, "account" ],
      sub: sub,
      exp: 5.minutes.from_now.to_i,
      iat: Time.now.to_i,
      realm_access: { roles: roles },
      email: "#{sub}@example.test"
    }.merge(overrides)
    JWT.encode(claims, TEST_KEY.signing_key, "RS256", kid: TEST_KEY[:kid])
  end

  def auth_headers(**kwargs)
    { "Authorization" => "Bearer #{token_for(**kwargs)}" }
  end
end

RSpec.configure do |config|
  config.before do
    allow(Oidc::Jwks).to receive(:instance).and_return(->(_opts = {}) { AuthHelpers.jwks })
  end
end
