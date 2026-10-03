module Oidc
  # Verifies a bearer access token: signature (JWKS), iss, aud, exp/nbf.
  # Returns the claims hash or raises JWT::DecodeError.
  class TokenVerifier
    ALGORITHMS = %w[RS256 RS384 RS512 ES256 PS256].freeze

    def self.verify(token, config: Rails.configuration.x.oidc, jwks: Jwks.instance)
      claims, _header = JWT.decode(
        token, nil, true,
        algorithms: ALGORITHMS,
        jwks: jwks,
        iss: config.issuer, verify_iss: true,
        aud: config.audience, verify_aud: true,
        required_claims: %w[sub exp],
        leeway: 30
      )
      claims
    end
  end
end
