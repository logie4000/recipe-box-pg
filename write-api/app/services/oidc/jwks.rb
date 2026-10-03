require "net/http"

module Oidc
  # Fetches and caches the IdP's signing keys. Used as the `jwks:` loader for
  # the jwt gem, which calls it again with kid_not_found: true when a token is
  # signed with a key we have not seen yet (key rotation).
  class Jwks
    TTL = 10.minutes
    MIN_REFRESH_INTERVAL = 30.seconds

    def self.instance
      @instance ||= new(Rails.configuration.x.oidc.jwks_url)
    end

    def initialize(url)
      @url = url
      @mutex = Mutex.new
      @keys = nil
      @fetched_at = nil
    end

    def call(options = {})
      @mutex.synchronize do
        refresh! if stale? || (options[:kid_not_found] && refreshable?)
        @keys
      end
    end

    private
      def stale?
        @keys.nil? || @fetched_at < TTL.ago
      end

      def refreshable?
        @fetched_at.nil? || @fetched_at < MIN_REFRESH_INTERVAL.ago
      end

      def refresh!
        response = Net::HTTP.get_response(URI(@url))
        raise JWT::DecodeError, "JWKS fetch failed (HTTP #{response.code})" unless response.is_a?(Net::HTTPSuccess)

        @keys = JSON.parse(response.body)
        @fetched_at = Time.current
      rescue SocketError, SystemCallError, Net::OpenTimeout, Net::ReadTimeout => e
        raise JWT::DecodeError, "JWKS fetch failed (#{e.class})" if @keys.nil?

        Rails.logger.warn("JWKS refresh failed, keeping cached keys: #{e.message}")
      end
  end
end
