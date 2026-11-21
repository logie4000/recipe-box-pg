# The caller, as described by a verified access token. Not an ActiveRecord
# model: users live in Keycloak, the app stores only their `sub`.
class AuthUser
  attr_reader :claims

  def initialize(claims)
    @claims = claims || {}
  end

  def sub = claims["sub"]
  def email = claims["email"]
  def name = claims["name"] || claims["preferred_username"]

  # Keycloak has checked the address: a Google sign-in (trustEmail on the IdP)
  # or a password account that clicked the verification link. Only a literal
  # JSON true counts, and there has to be an address to have verified.
  def email_verified? = claims["email_verified"] == true && email.present?

  # Realm roles plus client roles granted on the API audience.
  def roles
    @roles ||= begin
      realm = Array(claims.dig("realm_access", "roles"))
      client = Array(claims.dig("resource_access", Rails.configuration.x.oidc.audience, "roles"))
      (realm + client).uniq
    end
  end

  def role?(role) = roles.include?(role.to_s)
  def reader? = role?(:reader) || editor?
  def editor? = role?(:editor) || admin?
  def admin? = role?(Rails.configuration.x.oidc.admin_role)
end
