# TENANT_MODE=on: picks the tenant for this request, or answers 403.
#
#  1. Tenants the caller belongs to come from the token's `organization` claim.
#  2. If they belong to several, X-Tenant-Id chooses (it must be one of them).
#  3. With TENANT_SUBDOMAINS=on the host's first label must equal the slug.
module TenantResolution
  extend ActiveSupport::Concern

  included do
    before_action :resolve_tenant!, if: -> { Tenancy.enabled? }
  end

  def current_tenant = @current_tenant

  private
    def resolve_tenant!
      memberships = Tenancy.organizations_from(current_claims)
      ids = memberships.filter_map { |m| m[:id] }
      aliases = memberships.map { |m| m[:alias] }
      candidates = Tenant.active.where(id: ids).or(Tenant.active.where(slug: aliases)).to_a

      requested = request.headers["X-Tenant-Id"].presence
      tenant =
        if requested
          candidates.find { |t| t.id == requested }
        elsif candidates.one?
          candidates.first
        end

      if tenant && Tenancy.subdomains?
        subdomain = request.subdomains.first
        tenant = nil if subdomain.present? && subdomain != tenant.slug
      end

      return render(json: { error: "forbidden", message: "no tenant for this request" }, status: :forbidden) unless tenant

      @current_tenant = tenant
      ActsAsTenant.current_tenant = tenant
    end
end
