# The few Keycloak Admin REST calls the approval flow needs, made as the
# rails-admin client's service account (realm-management view-users and
# manage-users; `deploy/keycloak/configure.sh signup` sets that up).
#
# Keycloak is reached the same way as for the JWKS (OIDC_JWKS_URL), so
# inside docker it's http://keycloak:8080 rather than the public URL.
class KeycloakAdmin
  class Error < StandardError; end

  class << self
    def current = @current ||= new
    attr_writer :current
  end

  def initialize(config = Rails.configuration.x.oidc)
    jwks = URI(config.jwks_url)
    @base = "#{jwks.scheme}://#{jwks.host}:#{jwks.port}"
    @realm = URI(config.issuer).path.split("/").last
    @client_id = config.admin_client_id
    @client_secret = config.admin_client_secret
  end

  # Lets the user in: grants the realm role that app writes need. Looked up
  # among the roles the user doesn't have yet (reading realm roles directly
  # would need view-realm); not there means they already have it.
  def grant_realm_role(user_id, role_name)
    available = request(:get, "users/#{user_id}/role-mappings/realm/available")
    role = available.find { |r| r["name"] == role_name }
    request(:post, "users/#{user_id}/role-mappings/realm", [ role.slice("id", "name") ]) if role
  end

  # Turns a declined user away: they can't sign in again, and open sessions
  # end. Reversible in the Keycloak console.
  def disable_user(user_id)
    request(:put, "users/#{user_id}", { enabled: false })
    request(:post, "users/#{user_id}/logout")
  end

  private
    def request(method, path, body = nil)
      uri = URI("#{@base}/admin/realms/#{@realm}/#{path}")
      req = Net::HTTP.const_get(method.to_s.capitalize).new(uri)
      req["Authorization"] = "Bearer #{token}"
      if body
        req["Content-Type"] = "application/json"
        req.body = body.to_json
      end
      res = http(uri) { |h| h.request(req) }
      raise Error, "Keycloak #{method.upcase} #{path}: #{res.code}" unless res.is_a?(Net::HTTPSuccess)

      res.body.present? ? JSON.parse(res.body) : nil
    end

    def token
      uri = URI("#{@base}/realms/#{@realm}/protocol/openid-connect/token")
      req = Net::HTTP::Post.new(uri)
      req.set_form_data(grant_type: "client_credentials", client_id: @client_id, client_secret: @client_secret)
      res = http(uri) { |h| h.request(req) }
      raise Error, "Keycloak token: #{res.code}" unless res.is_a?(Net::HTTPSuccess)

      JSON.parse(res.body).fetch("access_token")
    end

    def http(uri, &block)
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: 5, read_timeout: 10, &block)
    rescue SystemCallError, Timeout::Error, SocketError => e
      raise Error, "Keycloak unreachable: #{e.message}"
    end
end
