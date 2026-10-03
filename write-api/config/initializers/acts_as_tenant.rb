# Inert unless TENANT_MODE=on (models only call acts_as_tenant in that mode).
ActsAsTenant.configure do |config|
  # Any query on a tenant-scoped model without a current tenant raises.
  config.require_tenant = -> { Tenancy.enabled? }
end
